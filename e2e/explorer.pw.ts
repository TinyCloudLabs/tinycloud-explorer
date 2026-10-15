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

async function checkKvKeyFilter(page: import("@playwright/test").Page) {
  const workspace = page.getByTestId("kv-workspace");
  const entries = workspace.locator(".kv-keys li");
  const filter = workspace.getByRole("searchbox", { name: "Filter keys" });
  await expect(entries).toHaveCount(3);
  await filter.fill("no-match-audit-only");
  await expect(entries).toHaveCount(0);
  await expect(workspace.getByRole("heading", { name: "No matching keys" })).toBeVisible();
  await filter.fill("0001.opus");
  await expect(entries).toHaveCount(1);
  await expect(workspace.locator(".kv-header code")).toContainText("0001.opus");
  await filter.fill("");
  await expect(entries).toHaveCount(3);
}

async function checkSqlFilters(page: import("@playwright/test").Page, phone = false) {
  const workspace = page.getByTestId("sql-workspace");
  const choices = workspace.locator("aside[aria-label='SQL tables'] li");
  const rows = workspace.locator(".data-table tbody tr");
  await workspace.getByRole("button", { name: /utterances/ }).click();
  await expect(rows).toHaveCount(2);
  await expect(workspace.locator(".table-toolbar")).toContainText("2 preview rows");

  const tablesFilter = workspace.getByRole("searchbox", { name: "Filter tables" });
  await tablesFilter.fill("no-match-audit-only");
  await expect(choices).toHaveCount(0);
  await expect(workspace.getByRole("heading", { name: "No matching tables" })).toBeVisible();
  await tablesFilter.fill("");
  await expect(choices).toHaveCount(3);
  await expect(rows).toHaveCount(2);

  const rowsFilter = workspace.getByRole("searchbox", { name: "Filter rows", includeHidden: true });
  if (phone) {
    await expect(rowsFilter).toBeHidden();
  } else {
    await rowsFilter.fill("no-match-audit-only");
    await expect(rows).toHaveCount(0);
    await expect(workspace.getByRole("heading", { name: "No matching rows" })).toBeVisible();
    await rowsFilter.fill("capability");
    await expect(rows).toHaveCount(1);
    await rowsFilter.fill("");
    await expect(rows).toHaveCount(2);
    await expect(workspace.locator(".table-toolbar")).toContainText("2 preview rows");
  }
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

  test("filters loaded KV keys without hiding the empty result", async ({ page }) => {
    await page.getByText("audio/chunks", { exact: true }).first().click();
    await page.getByTestId("open-value").click();
    await checkKvKeyFilter(page);
  });

  test("filters SQL choices and preview rows without inventing a total", async ({ page }) => {
    await page.getByText("conversations", { exact: true }).first().click();
    await page.getByTestId("canvas-open-table").click();
    await checkSqlFilters(page);
  });

  test("shows only evidenced KV metadata and unknown encryption", async ({
    page,
  }) => {
    await page.getByText("audio/chunks", { exact: true }).first().click();
    const inspector = page.getByTestId("inspector");
    await expect(inspector.getByText("Unknown", { exact: true })).toHaveCount(4);
    await page.getByTestId("open-value").click();
    const workspace = page.getByTestId("kv-workspace");
    await expect(workspace).toBeVisible();
    await expect(page.getByTestId("kv-value")).toContainText(
      '"conversationId": "c_01HZX3Q7W8Y3"',
    );

    await page.getByRole("tab", { name: "Metadata" }).click();
    await expect(page.getByText("bafybeig7jgm7…kc2q")).toBeVisible();
    await expect(workspace.getByText("Unknown", { exact: true })).toHaveCount(3);
    await expect(workspace.getByText("Encrypted", { exact: true })).toHaveCount(0);
    await expect(workspace.getByText("Plaintext", { exact: true })).toHaveCount(0);
    await workspace.getByRole("button", {
      name: "audio/chunks/c_01HZX3Q7W8Y3/0001.opus",
    }).click();
    await expect(workspace.getByText("482,304 bytes")).toBeVisible();
    await expect(workspace.getByText("Unknown", { exact: true })).toHaveCount(1);
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

  test("keeps desktop evidence steps and expandable timestamps", async ({
    page,
  }) => {
    const footer = page.getByTestId("evidence-footer");
    const steps = footer.locator(".evidence__steps");
    const toggle = footer.locator(".evidence__toggle");
    await expect(steps).toBeVisible();
    await expect(steps.locator("time")).toHaveCount(0);
    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(steps.locator("time").first()).toBeVisible();
    await toggle.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(steps).toBeVisible();
    await expect(steps.locator("time")).toHaveCount(0);
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

test.describe("desktop canvas interaction", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.skip(({ isMobile }) => Boolean(isMobile), "Desktop canvas only");

  test("keeps zoom controls clear of nodes without a minimap in both themes", async ({
    page,
  }) => {
    await connect(page);
    const lightControls = await page.locator(".react-flow__controls-button").first().boundingBox();
    expect(lightControls?.width).toBeGreaterThanOrEqual(44);
    expect(lightControls?.height).toBeGreaterThanOrEqual(44);
    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") {
        await page.getByRole("button", { name: "Use dark theme" }).click();
      }
      for (const level of ["system", "space"] as const) {
        await page.getByRole("tab", { name: new RegExp(level, "i") }).click();
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
          await expect(page.locator(".canvas-minimap")).toHaveCount(0);
        }
      }
    }
  });

  test("tabs to actionable nodes and announces their selection state", async ({
    page,
  }) => {
    await connect(page);
    const precedingButton = page.getByRole("button", { name: "Hide tours" });
    await precedingButton.focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(".react-flow__node:focus")).toHaveCount(1);
    await expect(page.locator('.react-flow__edge[tabindex="0"]')).toHaveCount(0);
    await page.keyboard.press("Shift+Tab");
    await expect(precedingButton).toBeFocused();

    const kvNode = page.locator('.react-flow__node[data-id="listen-audio-chunks"]');
    await expect(kvNode).toHaveAttribute("aria-label", /kv resource audio\/chunks, not selected/i);
    await kvNode.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", {
      name: /kv resource audio\/chunks, selected/i,
    })).toBeVisible();
    await expect(page.locator(".cartograph [role='status']")).toHaveText(
      /audio\/chunks resource selected/i,
    );

    const spaceNode = page.locator('.react-flow__node[data-id="applications"]');
    await expect(spaceNode).toHaveAttribute("aria-label", /space applications, 3 resources, not selected/i);
    await spaceNode.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("group", {
      name: /space applications, 3 resources, selected/i,
    })).toBeVisible();
    await expect(page.locator(".cartograph [role='status']")).toHaveText(
      /applications space selected/i,
    );
  });

  test("selects and opens focused nodes with truthful keyboard instructions", async ({
    page,
  }) => {
    await connect(page);
    const kvNode = page.locator('.react-flow__node[data-id="listen-audio-chunks"]');
    await kvNode.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(kvNode).toBeFocused();
    await expect(kvNode).toHaveCSS("outline-style", "solid");
    const instructions = await kvNode.evaluate((node) =>
      node.getAttribute("aria-describedby")?.split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ") ?? "",
    );
    expect(instructions).toContain("Shift+Enter");
    expect(instructions).not.toMatch(/delete/i);

    await page.getByRole("button", { name: "Use dark theme" }).click();
    await kvNode.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(kvNode).toHaveCSS("outline-style", "solid");

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector")).toContainText("listen / audio/chunks");
    const sqlNode = page.locator('.react-flow__node[data-id="listen-conversations"]');
    await sqlNode.focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("inspector")).toContainText("listen / conversations");

    await kvNode.focus();
    await page.keyboard.press("Shift+Enter");
    await expect(page.getByTestId("kv-workspace")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tab", { name: /space/i })).toHaveAttribute("aria-selected", "true");
    await expect(kvNode).toHaveAttribute("aria-label", /audio\/chunks, selected$/i);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tab", { name: /system/i })).toHaveAttribute("aria-selected", "true");
    await expect(kvNode).toHaveAttribute("aria-label", /audio\/chunks, selected$/i);
    await page.keyboard.press("Escape");
    await expect(kvNode).toHaveAttribute("aria-label", /audio\/chunks, not selected$/i);
    await expect(page.locator(".cartograph [role='status']")).toHaveText(
      /listen space selected/i,
    );
    await page.keyboard.press("1");
    const spaceNode = page.locator('.react-flow__node[data-id="applications"]');
    await spaceNode.focus();
    await page.keyboard.press("Shift+Enter");
    await expect(page.getByRole("tab", { name: /space/i })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("inspector")).toContainText("applications");
  });
});

test.describe("signed-out phone focus with debug log", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(({ isMobile }) => !isMobile, "Phone layout only");

  test("keeps the Connect focus ring outside the non-modal panel", async ({
    page,
  }) => {
    await page.goto("/");
    const connectButton = page.getByTestId("connect-tinycloud");
    await page.getByRole("button", { name: "View debug log" }).click();
    const panel = page.getByTestId("debug-log");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(connectButton).toBeFocused();
    expect(await connectButton.evaluate((button) => button.matches(":focus-visible"))).toBe(true);
    expect(await page.evaluate(() => {
      const button = document.querySelector("[data-testid=connect-tinycloud]")!.getBoundingClientRect();
      const panel = document.querySelector("[data-testid=debug-log]")!.getBoundingClientRect();
      return button.top >= 0 && button.bottom <= panel.top;
    })).toBe(true);
    await panel.getByRole("button", { name: "Close debug log" }).click();
    await expect(panel).toBeHidden();
  });
});

test.describe("phone evidence disclosure", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(({ isMobile }) => !isMobile, "Phone layout only");

  test("reveals system and resource details and collapses by keyboard", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.getByText("SDK mock data ready")).toBeVisible();
    const footer = page.getByTestId("evidence-footer");
    const steps = footer.locator(".evidence__steps");
    const toggle = footer.locator(".evidence__toggle");
    const chevron = toggle.locator("svg");
    await expect(chevron).toHaveCSS("transition-duration", "0s");
    await expect(chevron).toHaveCSS("transform", "none");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(steps).toBeHidden();

    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(steps).toBeVisible();
    await expect(chevron).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
    await expect(steps.getByText("Session established")).toBeVisible();
    await expect(steps.locator("time").first()).toBeVisible();
    await page.getByRole("button", { name: "audio/chunks KV read + write" }).click();
    await expect(steps.getByText("Resource access confirmed")).toBeVisible();
    await expect(chevron).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
    await expect(steps.locator("time").last()).toBeVisible();
    expect(await page.evaluate(() => {
      const list = document.querySelector(".evidence__steps")!.getBoundingClientRect();
      const status = document.querySelector(".status-bar")!.getBoundingClientRect();
      return list.top >= 0 && list.bottom <= status.top;
    })).toBe(true);

    await toggle.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(steps).toBeHidden();
    await expect(chevron).toHaveCSS("transform", "none");
    await expect(steps.locator("time")).toHaveCount(0);
  });

  test("scrolls long resource evidence above the phone status", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.getByText("SDK mock data ready")).toBeVisible();
    await page.getByRole("button", { name: "audio/chunks KV read + write" }).click();
    const footer = page.getByTestId("evidence-footer");
    const steps = footer.locator(".evidence__steps");
    const toggle = footer.locator(".evidence__toggle");
    await toggle.press("Enter");
    await steps.locator("li").last().locator("small").evaluate((element) => {
      element.textContent = "resource: kv/" + "synthetic-segment-".repeat(30);
    });

    expect(await steps.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await toggle.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(steps).toBeFocused();
    await page.keyboard.press("End");
    await expect.poll(() => steps.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => {
      const lastTime = document.querySelector(".evidence__steps li:last-child time")!.getBoundingClientRect();
      const list = document.querySelector(".evidence__steps")!.getBoundingClientRect();
      const status = document.querySelector(".status-bar")!.getBoundingClientRect();
      return lastTime.top >= list.top && lastTime.bottom <= list.bottom && lastTime.bottom <= status.top;
    })).toBe(true);
  });
});

test.describe("phone KV metadata", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(({ isMobile }) => !isMobile, "Phone layout only");

  test("keeps unknown encryption singular on the same entry", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.getByText("SDK mock data ready")).toBeVisible();
    await page.getByRole("button", { name: "audio/chunks KV read + write" }).click();
    const workspace = page.getByTestId("kv-workspace");
    await workspace.getByRole("tab", { name: "Metadata" }).click();
    await expect(workspace.getByText("Unknown", { exact: true })).toHaveCount(3);
    await expect(workspace.getByText("Encrypted", { exact: true })).toHaveCount(0);
    await expect(workspace.getByText("Plaintext", { exact: true })).toHaveCount(0);
  });

  test("filters loaded keys on the phone", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.getByText("SDK mock data ready")).toBeVisible();
    await page.getByRole("button", { name: "audio/chunks KV read + write" }).click();
    await checkKvKeyFilter(page);
  });

  test("filters SQL choices and reports preview rows on the phone", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.getByText("SDK mock data ready")).toBeVisible();
    await page.getByRole("button", { name: "conversations SQL read + write" }).click();
    await checkSqlFilters(page, true);
  });
});
