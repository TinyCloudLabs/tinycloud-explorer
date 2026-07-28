import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TEST_WALLET_NAME = "TinyCloud E2E Wallet";
const TEST_SPACE_NAME = "public";
// The deterministic account's hosted public space is test-only infrastructure;
// records remain isolated under a dedicated per-run Explorer key prefix.
const TEST_RUN_ID =
  process.env.PW_TEST_RUN_ID ?? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const TEST_RESOURCE_PREFIX = "tinycloud-explorer-e2e";
const TEST_RECORD_RELATIVE_KEY = `e2e-${TEST_RUN_ID}/generated.json`;
const TEST_RECORD_KEY = `${TEST_RESOURCE_PREFIX}/${TEST_RECORD_RELATIVE_KEY}`;
const ETHERS_UMD_PATH = fileURLToPath(
  new URL("../node_modules/ethers/dist/ethers.umd.min.js", import.meta.url),
);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exposeTestShadowRoots() {
  return () => {
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return attachShadow.call(this, { ...init, mode: "open" });
    };
  };
}

function installTestWallet() {
  return ({
    address,
    privateKey,
    walletName,
  }: {
    address: string;
    privateKey: string;
    walletName: string;
  }) => {
    const ethers = (window as any).ethers;
    const wallet = new ethers.Wallet(privateKey);
    const signedMessages: string[] = [];
    (window as any).__tinycloudE2eSignedMessages = signedMessages;
    const provider = {
      isMetaMask: true,
      selectedAddress: address,
      chainId: "0x1",
      networkVersion: "1",
      async request({
        method,
        params = [],
      }: {
        method: string;
        params?: unknown[];
      }) {
        switch (method) {
          case "eth_requestAccounts":
          case "eth_accounts":
            return [address];
          case "eth_chainId":
            return "0x1";
          case "net_version":
            return "1";
          case "eth_getBalance":
            return "0x56bc75e2d63100000";
          case "eth_blockNumber":
            return "0x1";
          case "eth_getCode":
            return "0x";
          case "eth_call":
            return "0x";
          case "eth_estimateGas":
            return "0x5208";
          case "personal_sign": {
            const message = params[0];
            if (typeof message !== "string") throw new Error("missing message");
            signedMessages.push(
              message.startsWith("0x")
                ? ethers.utils.toUtf8String(ethers.utils.arrayify(message))
                : message,
            );
            return message.startsWith("0x")
              ? wallet.signMessage(ethers.utils.arrayify(message))
              : wallet.signMessage(message);
          }
          case "eth_signTypedData_v4":
            return wallet._signTypedData(
              JSON.parse(String(params[1])).domain,
              JSON.parse(String(params[1])).types,
              JSON.parse(String(params[1])).message,
            );
          case "wallet_getPermissions":
          case "wallet_requestPermissions":
            return [{ parentCapability: "eth_accounts" }];
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain":
            return null;
          default:
            return null;
        }
      },
      on: () => provider,
      removeListener: () => provider,
      isConnected: () => true,
      send(method: string, params?: unknown[]) {
        return provider.request({ method, params });
      },
      sendAsync(
        payload: { method: string; params?: unknown[] },
        callback: (error: Error | null, response?: { result?: unknown }) => void,
      ) {
        provider
          .request(payload)
          .then((result) => callback(null, { result }))
          .catch((error) => callback(error));
      },
    };

    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "8fd9b04a-e8a0-4c43-9d87-5af504aa1f0d",
              name: walletName,
              icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
              rdns: "xyz.tinycloud.e2e-wallet",
            },
            provider,
          },
        }),
      );

    Object.defineProperty(window, "ethereum", {
      value: provider,
      configurable: true,
    });
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  };
}

async function bootstrapTestAccount(page: Page) {
  const context = page.context();
  await context.addInitScript(exposeTestShadowRoots());
  await context.addInitScript({ path: ETHERS_UMD_PATH });
  await context.addInitScript(installTestWallet(), {
    address: TEST_ADDRESS,
    privateKey: TEST_PRIVATE_KEY,
    walletName: TEST_WALLET_NAME,
  });
}

async function connectThroughOpenKey(page: Page) {
  await bootstrapTestAccount(page);
  await page.goto("/");
  await page.getByTestId("connect-tinycloud").click();
  const openKeyFrame = page.frameLocator(
    'iframe[src*="openkey.so/widget/embed/connect"]',
  );
  await expect(
    openKeyFrame.getByRole("button", {
      name: /or use an external wallet/i,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await openKeyFrame
    .getByRole("button", { name: /or use an external wallet/i })
    .click();
  const walletPicker = page.getByRole("button", { name: TEST_WALLET_NAME });
  await expect(walletPicker).toBeVisible({ timeout: 30_000 });
  await walletPicker.click();
  await expect(page.getByText("Real TinyCloud session ready")).toBeVisible({
    timeout: 180_000,
  });
}

function resourceNode(page: Page) {
  return page.locator(".canvas-node--resource").filter({
    has: page.getByText(TEST_RESOURCE_PREFIX, { exact: true }),
  }).first();
}

async function cleanupCreatedRecord(page: Page, recordKey: string) {
  const targetResource = resourceNode(page);

  if (await targetResource.isVisible().catch(() => false)) {
    await targetResource.click();
  }

  const workspace = page.getByTestId("kv-workspace");
  if (!(await workspace.isVisible().catch(() => false))) {
    const inspectValues = page.getByTestId("open-value");
    if (await inspectValues.isVisible().catch(() => false)) {
      await inspectValues.click();
    }
  }

  if (await workspace.isVisible().catch(() => false)) {
    const entryButton = workspace
      .getByRole("button", { name: new RegExp(escapeRegExp(recordKey)) })
      .first();
    if (await entryButton.isVisible().catch(() => false)) {
      await entryButton.click();
      await workspace.getByRole("button", { name: /^Delete$/ }).click();
    }
    await expect(
      workspace.getByRole("button", { name: new RegExp(escapeRegExp(recordKey)) }),
    ).toHaveCount(0, { timeout: 120_000 });
  }
}

test.describe("real TinyCloud Explorer integration", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Desktop-only real flow");
  test.describe.configure({ timeout: 480_000 });

  test("shows public, account, applications, and secrets when the node only lists public", async ({
    page,
  }) => {
    await connectThroughOpenKey(page);

    const spaceNavigation = page.getByRole("navigation", {
      name: "TinyCloud spaces",
    });
    await expect(
      spaceNavigation.getByRole("button", { name: /public/i }).first(),
    ).toBeVisible();
    await expect(
      spaceNavigation.getByRole("button", { name: /applications/i }).first(),
    ).toBeVisible();
    await expect(
      spaceNavigation.getByRole("button", { name: /account/i }).first(),
    ).toBeVisible();
    await expect(
      spaceNavigation.getByRole("button", { name: /secrets/i }).first(),
    ).toBeVisible();

    await page
      .getByRole("button", { name: /Open debug log with \d+ events/ })
      .click();
    const log = page.getByTestId("debug-log");
    await expect(log).toContainText("TinyCloud session established");
    await expect(log).toContainText("Explorer snapshot ready");
    await expect(log).toContainText("sensitive fields redacted");
  });

  test("grants discovery access and uses it without reconnecting", async ({
    page,
  }) => {
    await connectThroughOpenKey(page);
    const signaturesBefore = await page.evaluate(
      () => (window as any).__tinycloudE2eSignedMessages.length as number,
    );
    const accountInvocation = page.waitForResponse(
      (response) => response.url().endsWith("/invoke"),
    );

    await page
      .getByRole("navigation", { name: "TinyCloud spaces" })
      .getByRole("button", { name: /account/i })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Resources need additional permission" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Grant discovery access" }).click();
    await page.getByRole("button", { name: /^Approve$/ }).click();

    await expect(
      page.getByRole("button", { name: "Granting discovery access…" }),
    ).toHaveCount(0, { timeout: 120_000 });
    await expect(page.locator(".inline-error")).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "TinyCloud spaces" })
        .getByRole("button", {
          name: /account [1-9]\d* resources? read/i,
        }),
    ).toBeVisible();
    const invocationResponse = await accountInvocation;
    expect(await invocationResponse.text()).not.toContain("Unauthorized Action");

    const discoveryMessages = await page.evaluate(
      (start) =>
        ((window as any).__tinycloudE2eSignedMessages as string[]).slice(start),
      signaturesBefore,
    );
    const signedDiscovery = discoveryMessages.join("\n");
    expect(signedDiscovery).toContain(
      "'tinycloud.kv': 'get', 'list', 'metadata'",
    );
    expect(signedDiscovery).toContain("'tinycloud.sql': 'read'");
    expect(signedDiscovery).not.toContain("'put'");
    expect(signedDiscovery).not.toContain("'del'");
    expect(signedDiscovery).not.toContain("'tinycloud.sql': 'write'");
  });

  test("connects through OpenKey, discovers real data, writes, reads back, and cleans up", async ({
    page,
  }) => {
    const recordKey = TEST_RECORD_KEY;
    let recordNeedsCleanup = false;

    try {
      await connectThroughOpenKey(page);
      const signedMessages = await page.evaluate(
        () => (window as any).__tinycloudE2eSignedMessages as string[],
      );
      expect(
        signedMessages,
        "Explorer sign-in must use one capability-bearing SIWE signature.",
      ).toHaveLength(1);
      expect(
        signedMessages.some(
          (message) =>
            message.includes(`${TEST_SPACE_NAME}/kv`) &&
            message.includes("tinycloud.kv") &&
            (message.includes("'put'") || message.includes("tinycloud.kv/put")),
        ),
        "The real SIWE flow must include public-space KV write authority.",
      ).toBe(true);
      await expect(page.getByTestId("inspector")).toBeVisible();
      await expect(page.getByTestId("cartograph-canvas")).toBeVisible();

      const explorerSpace = page
        .getByRole("navigation", { name: "TinyCloud spaces" })
        .getByRole("button", { name: new RegExp(TEST_SPACE_NAME, "i") })
        .first();
      await expect(explorerSpace).toBeVisible();
      await explorerSpace.click();

      const kvWorkspace = page.getByTestId("kv-workspace");
      if (await page.getByText("No resources found").isVisible().catch(() => false)) {
        await expect(page.getByRole("button", { name: /write/i })).toHaveCount(0);
        return;
      }

      const targetResource = resourceNode(page);
      await expect(targetResource).toBeVisible({ timeout: 30_000 });
      await targetResource.click();
      await page.getByTestId("open-value").click();
      await expect(kvWorkspace).toBeVisible({ timeout: 30_000 });
      await kvWorkspace
        .getByPlaceholder("e2e/example.json")
        .fill(TEST_RECORD_RELATIVE_KEY);
      await kvWorkspace
        .getByPlaceholder('{"message":"hello"}')
        .fill('{"message":"hello"}');
      await kvWorkspace.getByRole("button", { name: /^Write entry$/ }).click();
      recordNeedsCleanup = true;
      await expect(
        kvWorkspace.getByRole("button", { name: /^Write entry$/ }),
      ).toBeVisible({ timeout: 120_000 });

      await expect(kvWorkspace).toBeVisible({ timeout: 30_000 });

      const valueEntryButton = kvWorkspace
        .getByRole("button", { name: new RegExp(escapeRegExp(recordKey)) })
        .first();
      await expect(valueEntryButton).toBeVisible({ timeout: 30_000 });
      await valueEntryButton.click();
      await expect(kvWorkspace.getByTestId("kv-value")).toContainText("hello");

      await kvWorkspace.getByRole("button", { name: /^Delete$/ }).click();
      await expect(
        kvWorkspace.getByRole("button", { name: new RegExp(escapeRegExp(recordKey)) }),
      ).toHaveCount(0, { timeout: 120_000 });
      recordNeedsCleanup = false;
    } finally {
      if (recordNeedsCleanup) {
        await cleanupCreatedRecord(page, recordKey);
      }
    }
  });
});
