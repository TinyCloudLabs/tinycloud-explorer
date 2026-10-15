import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function connect(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("connect-tinycloud").click();
  await expect(page.getByText("SDK mock data ready")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "TinyCloud spaces" })).toContainText(
    "listen",
  );
}

test.describe("mock TinyCloud Explorer browser suite", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Desktop-only mock flow");

  test.beforeEach(async ({ page }) => {
    await connect(page);
  });

  test("opens the seeded SQL resource and runs a canned query", async ({
    page,
  }) => {
    await page.getByText("conversations", { exact: true }).first().click();
    await expect(page.getByTestId("inspector")).toContainText(
      "listen / conversations",
    );

    await page.getByTestId("canvas-open-table").click();
    const workspace = page.getByTestId("sql-workspace");
    await expect(workspace).toBeVisible();
    await expect(
      workspace.getByRole("heading", { name: "conversations", level: 1 }),
    ).toBeVisible();
    await expect(workspace.getByRole("table")).toContainText(
      "Infrastructure review",
    );

    await page.getByRole("tab", { name: "Query" }).click();
    await page.getByRole("button", { name: "Count by source" }).click();
    await page.getByTestId("run-query").click();
    await expect(page.getByRole("table")).toContainText("microphone");
    await expect(page.getByText("84 ms")).toBeVisible();
  });

  test("opens the seeded KV resource and shows encrypted metadata", async ({
    page,
  }) => {
    await page.getByText("audio/chunks", { exact: true }).first().click();
    await page.getByTestId("open-value").click();
    await expect(page.getByTestId("kv-workspace")).toBeVisible();
    await expect(page.getByTestId("kv-value")).toContainText(
      '"conversationId": "c_01HZX3Q7W8Y3"',
    );

    await page.getByRole("tab", { name: "Metadata" }).click();
    await expect(page.getByText("bafybeig7jgm7…kc2q")).toBeVisible();
    await expect(page.getByText("Encrypted", { exact: true })).toBeVisible();
  });

  test("requests access to a concealed resource before opening it", async ({
    page,
  }) => {
    await page.getByText("audit-log", { exact: true }).first().click();
    const inspector = page.getByTestId("inspector");

    await expect(inspector).toContainText("Needs additional permission");
    await expect(inspector).toContainText(
      "This resource exists, but the active session cannot read its contents yet.",
    );
    await expect(inspector.getByTestId("open-table")).toBeHidden();

    await inspector.getByTestId("grant-permission").click();
    await expect(page.getByText("Permission granted in SDK mock")).toBeVisible();
    await expect(inspector).toContainText("read only");
    await inspector.getByTestId("open-table").click();
    await expect(page.getByTestId("sql-workspace")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "audit-log", level: 1 }),
    ).toBeVisible();
  });

  test("grants discovery-only access for a space with no visible resources", async ({
    page,
  }) => {
    await page
      .getByRole("navigation", { name: "TinyCloud spaces" })
      .getByRole("button", { name: /archive/i })
      .click();

    await expect(
      page.getByRole("heading", { name: "Resources need additional permission" }),
    ).toBeVisible();
    await expect(
      page.getByText("Read and discovery only. Write access is not requested."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /write/i }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Grant discovery access" }).click();

    await expect(
      page.getByRole("heading", { name: "No resources found" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Grant discovery access" }),
    ).toHaveCount(0);
  });

  test("shows a copyable, redacted session debug log", async ({ page }) => {
    await page
      .getByRole("button", { name: /Open debug log with \d+ events/ })
      .click();

    const log = page.getByTestId("debug-log");
    await expect(log).toBeVisible();
    await expect(log).toContainText("SDK mock snapshot ready");
    await expect(log).toContainText("mock.snapshot");
    await expect(log).toContainText("sensitive fields redacted");

    await log.getByRole("button", { name: "Clear debug log" }).click();
    await expect(log).toContainText(
      "Connection, discovery, permission, and invocation events appear here.",
    );
  });

  test("searches across spaces and preserves evidence", async ({ page }) => {
    await page.getByRole("searchbox", { name: "Search TinyCloud" }).fill("issued");
    await page.getByRole("option", { name: /issued_credentials/ }).click();
    await expect(page.getByTestId("sql-workspace")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "credentials / issued_credentials",
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "View evidence" }).click();
    await expect(page.getByTestId("evidence-footer")).toContainText(
      "Resource access confirmed",
    );
  });

  test("has no automatically detectable serious accessibility violations", async ({
    page,
  }) => {
    const results = await new AxeBuilder({ page })
      .disableRules(["aria-prohibited-attr"])
      .analyze();
    const serious = results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(serious).toEqual([]);

    await page.getByRole("button", { name: "Use dark theme" }).click();
    const darkResults = await new AxeBuilder({ page })
      .disableRules(["aria-prohibited-attr"])
      .analyze();
    const darkSerious = darkResults.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(darkSerious).toEqual([]);
  });
});

test.describe("canvas control clearance", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.skip(({ isMobile }) => Boolean(isMobile), "Desktop canvas only");

  test("keeps zoom and fit targets clear of nodes at system and space levels", async ({
    page,
  }) => {
    await connect(page);
    for (const level of ["system", "space"] as const) {
      if (level === "space") {
        await page.getByRole("tab", { name: /space/i }).click();
      }
      for (const frame of ["default", "fit"] as const) {
        if (frame === "fit") {
          await page.locator(".react-flow__controls-fitview").click();
        }
        await expect.poll(() =>
          page.locator(".cartograph").evaluate((canvas) => {
            const controls = canvas.querySelector(".react-flow__controls")!.getBoundingClientRect();
            return [...canvas.querySelectorAll(".react-flow__node")]
              .filter((node) => {
                const box = node.getBoundingClientRect();
                return box.left < controls.right && box.right > controls.left &&
                  box.top < controls.bottom && box.bottom > controls.top;
              })
              .map((node) => node.getAttribute("aria-label"));
          }),
        ).toEqual([]);
      }
    }
    const controls = await page.locator(".react-flow__controls-button").first().boundingBox();
    expect(controls?.width).toBeGreaterThanOrEqual(44);
    expect(controls?.height).toBeGreaterThanOrEqual(44);
  });
});
