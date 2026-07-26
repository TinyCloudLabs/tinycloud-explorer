import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function connect(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("connect-tinycloud").click();
  await expect(page.getByText("Fixture data ready")).toBeVisible();
}

test.describe("desktop Cartograph walkthrough", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Desktop-only Cartograph flow");

  test.beforeEach(async ({ page }) => {
    await connect(page);
  });

  test("moves from the system map into SQL tables and queries", async ({
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

  test("inspects a key-value entry and its metadata", async ({ page }) => {
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

  test("searches across spaces and resources and preserves evidence", async ({
    page,
  }) => {
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

  test("supports semantic zoom keyboard shortcuts", async ({ page }) => {
    await page.getByText("conversations", { exact: true }).first().click();
    await page.keyboard.press("3");
    await expect(page.getByTestId("sql-workspace")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("cartograph-canvas")).toBeVisible();
    await page.keyboard.press("1");
    await expect(page.getByRole("tab", { name: /system/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("exports a JSON Canvas document with TinyCloud metadata", async ({
    page,
  }) => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export canvas" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("listen.canvas");

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const document = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    expect(document.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "file",
          file: "tc://listen/sql/conversations",
          tc: expect.objectContaining({ resourceType: "sql" }),
        }),
      ]),
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

test.describe("mobile ledger walkthrough", () => {
  test.skip(({ isMobile }) => !isMobile, "Mobile-only ledger flow");

  test("replaces the canvas with a touch-friendly resource ledger", async ({
    page,
  }) => {
    await connect(page);
    await expect(page.getByTestId("mobile-ledger")).toBeVisible();
    await expect(page.getByTestId("cartograph-canvas")).toBeHidden();

    await page.getByRole("button", { name: /conversations SQL/ }).click();
    await expect(page.getByTestId("sql-workspace")).toBeVisible();
    await expect(page.getByRole("table")).toContainText("Project kickoff");
  });
});
