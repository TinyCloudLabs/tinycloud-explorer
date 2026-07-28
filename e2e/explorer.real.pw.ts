import { expect, test, type Page } from "@playwright/test";
import { buildSpaceUri } from "@tinycloud/sdk-core";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  REAL_FIXTURE_ADDRESS,
  REAL_FIXTURE_DID,
  REAL_FIXTURE_KV_CANARY,
  REAL_FIXTURE_PRIVATE_KEY,
  REAL_FIXTURE_PUBLIC_SPACE,
  REAL_FIXTURE_SECRETS_SPACE,
  REAL_FIXTURE_SQL_CANARY,
  REAL_FIXTURE_SECRET_NAMES,
  REAL_FIXTURE_VARIABLE_NAMES,
  realFixtureSecretValue,
} from "../src/data/realFixture";

const TEST_WALLET_NAME = "TinyCloud E2E Wallet";
const ETHERS_UMD_PATH = fileURLToPath(
  new URL("../node_modules/ethers/dist/ethers.umd.min.js", import.meta.url),
);
const REAL_FIXTURE_STATE_FILE = fileURLToPath(
  new URL("../../../../../.context/tinycloud-explorer-real-fixture.json", import.meta.url),
);

type FixtureState = {
  runSeed: string;
};

async function loadFixtureState(): Promise<FixtureState> {
  const parsed = JSON.parse(
    await readFile(REAL_FIXTURE_STATE_FILE, "utf8"),
  ) as { runSeed?: string };
  if (!parsed.runSeed) {
    throw new Error("Missing real fixture state runSeed.");
  }
  return { runSeed: parsed.runSeed };
}

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
    address: REAL_FIXTURE_ADDRESS,
    privateKey: REAL_FIXTURE_PRIVATE_KEY,
    walletName: TEST_WALLET_NAME,
  });
}

async function connectThroughOpenKey(page: Page) {
  await page.setViewportSize({ width: 390, height: 1000 });
  await bootstrapTestAccount(page);
  await page.goto("/");
  await page.getByTestId("connect-tinycloud").click();
  const openKeyFrame = page.frameLocator(
    'iframe[src*="openkey.so/widget/embed/connect"]',
  );
  const widgetButtons = openKeyFrame.getByRole("button");
  await expect(widgetButtons.first()).toBeVisible({ timeout: 30_000 });
  const buttonLabels = await widgetButtons.evaluateAll((nodes) =>
    nodes.map((node, index) => ({
      index,
      label: `${node.textContent ?? ""} ${node.getAttribute("aria-label") ?? ""}`.trim(),
    })),
  );
  const walletButtonIndex =
    buttonLabels.find(({ label }) => /wallet|metamask|browser|external/i.test(label))?.index ??
    0;
  await widgetButtons.nth(walletButtonIndex).click();
  await expect(page.getByRole("button", { name: TEST_WALLET_NAME })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: TEST_WALLET_NAME }).click();
  await expect(page.getByText("Real TinyCloud session ready")).toBeVisible({
    timeout: 180_000,
  });
}

async function selectSpace(page: Page, spaceName: string) {
  const selector = page.locator(".ledger__space-picker select");
  await selector.evaluate((element, name) => {
    const select = element as HTMLSelectElement;
    const option = Array.from(select.options).find((candidate) =>
      candidate.textContent?.trim().startsWith(String(name)),
    );
    if (!option) {
      throw new Error(`Missing space option ${String(name)}`);
    }
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, spaceName);
}

async function grantDiscoveryIfNeeded(page: Page) {
  const prompt = page.getByRole("heading", {
    name: "Resources need additional permission",
  });
  if (!(await prompt.isVisible().catch(() => false))) {
    return;
  }
  await page.getByRole("button", { name: "Grant discovery access" }).click();
  await page.getByRole("button", { name: /^Approve$/ }).click();
  await expect(page.getByRole("button", { name: "Grant discovery access" })).toHaveCount(0, {
    timeout: 120_000,
  });
}

function resourceButton(page: Page, resourceName: string, kind: "SQL" | "KV") {
  return page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(resourceName)}\\s+${kind}\\b`, "i"),
  }).first();
}

async function openLedgerResource(
  page: Page,
  spaceName: string,
  resourceName: string,
  kind: "SQL" | "KV",
) {
  await selectSpace(page, spaceName);
  await grantDiscoveryIfNeeded(page);
  const button = resourceButton(page, resourceName, kind);
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
}

async function openSqlTable(page: Page, tableName: string) {
  const tableButton = page
    .getByRole("button", { name: new RegExp(`^${escapeRegExp(tableName)}\\b`, "i") })
    .first();
  await expect(tableButton).toBeVisible({ timeout: 30_000 });
  await tableButton.click();
}

test.describe("real TinyCloud Explorer integration", () => {
  test.describe.configure({ timeout: 480_000 });

  test("traverses the seeded public, applications, account, and secrets spaces", async ({
    page,
  }) => {
    const { runSeed } = await loadFixtureState();
    await connectThroughOpenKey(page);

    await selectSpace(page, REAL_FIXTURE_PUBLIC_SPACE);
    await expect(page.locator(".ledger__space-picker select")).toBeVisible();

    await openLedgerResource(page, REAL_FIXTURE_PUBLIC_SPACE, "notes", "KV");
    const publicKv = page.getByTestId("kv-workspace");
    await expect(publicKv).toContainText(`${REAL_FIXTURE_KV_CANARY}-public-notes`);
    await publicKv.getByRole("button", { name: /^notes\/welcome\.json$/ }).click();
    await expect(page.getByTestId("kv-value")).toContainText(`${REAL_FIXTURE_KV_CANARY}-public-notes`);
    await page.getByRole("button", { name: /^Back to public$/ }).click();
    await openLedgerResource(page, REAL_FIXTURE_PUBLIC_SPACE, "projects", "KV");
    const publicProjectsKv = page.getByTestId("kv-workspace");
    await expect(publicProjectsKv).toContainText(`${REAL_FIXTURE_KV_CANARY}-public-projects`);
    await publicProjectsKv.getByRole("button", { name: /^projects\/roadmap\.json$/ }).click();
    await expect(page.getByTestId("kv-value")).toContainText(`${REAL_FIXTURE_KV_CANARY}-public-projects`);
    await page.getByRole("button", { name: /^Back to public$/ }).click();

    await openLedgerResource(page, "applications", "default", "SQL");
    const applicationsSql = page.getByTestId("sql-workspace");
    await expect(applicationsSql).toContainText(`${REAL_FIXTURE_SQL_CANARY}-applications`);
    await openSqlTable(page, "application_catalog");
    await expect(applicationsSql).toContainText("TinyCloud Explorer");
    await page.getByRole("tab", { name: "Query" }).click();
    await page.getByLabel("SQL query").fill(
      'SELECT id, app_id, label, canary FROM application_catalog ORDER BY id;',
    );
    await applicationsSql.getByTestId("run-query").click();
    await expect(applicationsSql).toContainText(`${REAL_FIXTURE_SQL_CANARY}-applications`);
    await expect(applicationsSql).toContainText(`${REAL_FIXTURE_SQL_CANARY}-applications-2`);
    await page.getByRole("button", { name: /^Back to applications$/ }).click();

    await openLedgerResource(page, "account", "account", "SQL");
    const accountSql = page.getByTestId("sql-workspace");
    await openSqlTable(page, "space_registry");
    await expect(accountSql).toContainText(`${REAL_FIXTURE_SQL_CANARY}-account`);
    await page.getByRole("button", { name: /^Back to account$/ }).click();

    await openLedgerResource(page, REAL_FIXTURE_SECRETS_SPACE, "vault", "KV");
    const secretsKv = page.getByTestId("kv-workspace");
    await expect(secretsKv).toContainText(REAL_FIXTURE_SECRET_NAMES[0]);
    await expect(secretsKv).toContainText(REAL_FIXTURE_SECRET_NAMES[1]);
    await secretsKv.getByRole("button", { name: new RegExp(`^vault/secrets/${escapeRegExp(REAL_FIXTURE_SECRET_NAMES[0])}$`) }).click();
    const secretPlaintext = realFixtureSecretValue(REAL_FIXTURE_SECRET_NAMES[0], runSeed);
    await expect(page.getByTestId("kv-value")).toContainText("ciphertext");
    await expect(page.getByTestId("kv-value")).toContainText("networkId");
    await expect(page.getByTestId("kv-value")).not.toContainText(secretPlaintext);
    await page.getByRole("button", { name: /^Back to secrets$/ }).click();

    await openLedgerResource(page, REAL_FIXTURE_SECRETS_SPACE, "variables", "KV");
    const secretsVariables = page.getByTestId("kv-workspace");
    await expect(secretsVariables).toContainText(REAL_FIXTURE_VARIABLE_NAMES[0]);
    await expect(secretsVariables).toContainText(REAL_FIXTURE_VARIABLE_NAMES[1]);

    await page.getByRole("button", { name: /Open debug log with \d+ events/ }).click();
    const log = page.getByTestId("debug-log");
    await expect(log).toContainText("TinyCloud session established");
    await expect(log).toContainText("Explorer snapshot ready");
    await expect(log).not.toContainText(/not readable/i);
    await expect(log).not.toContainText(/request failed/i);
  });
});
