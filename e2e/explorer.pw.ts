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

async function canvasNodesClear(page: import("@playwright/test").Page) {
  return page.locator(".cartograph").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    const controls = canvas.querySelector(".react-flow__controls")!.getBoundingClientRect();
    return [...canvas.querySelectorAll(".react-flow__node")].every((node) => {
      const box = node.getBoundingClientRect();
      return box.left >= bounds.left && box.right <= bounds.right &&
        box.top >= bounds.top && box.bottom <= bounds.bottom &&
        !(box.left < controls.right && box.right > controls.left &&
          box.top < controls.bottom && box.bottom > controls.top);
    });
  });
}

async function checkKvKeyFilter(page: import("@playwright/test").Page) {
  const workspace = page.getByTestId("kv-workspace");
  const entries = workspace.locator(".kv-keys li");
  const filter = workspace.getByRole("searchbox", { name: "Filter keys" });
  await expect(entries).toHaveCount(3);
  await filter.fill("no-match-audit-only");
  await expect(entries).toHaveCount(0);
  await expect(workspace.getByRole("heading", { name: "No matching keys" })).toBeVisible();
  await expect(workspace.getByText("Clear the filter to see all keys.")).toBeVisible();
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
  await expect(workspace.locator(".table-toolbar")).toContainText(
    "2 preview rows · 3,982,114 total",
  );

  const tablesFilter = workspace.getByRole("searchbox", { name: "Filter tables" });
  await tablesFilter.fill("no-match-audit-only");
  await expect(choices).toHaveCount(0);
  await expect(workspace.getByRole("heading", { name: "No matching tables" })).toBeVisible();
  await expect(workspace.getByText("Clear the filter to see all tables.")).toBeVisible();
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
    await expect(workspace.getByText(
      "No loaded preview rows match. Clear the filter to see them.",
    )).toBeVisible();
    await expect(workspace.locator(".table-toolbar")).toContainText(
      "0 of 2 preview rows · 3,982,114 total",
    );
    const copyRows = workspace.getByRole("button", { name: "Copy rows" });
    await expect(copyRows).toBeDisabled();
    await expect(copyRows).toHaveCSS("white-space", "nowrap");
    await rowsFilter.fill("capability");
    await expect(rows).toHaveCount(1);
    await rowsFilter.fill("");
    await expect(rows).toHaveCount(2);
    await expect(workspace.getByRole("button", { name: "Copy rows" })).toBeEnabled();
    await expect(workspace.locator(".table-toolbar")).toContainText("2 preview rows");
  }
}

test.describe("signed-out entry after dark session", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "Theme toggle is available in desktop layout");

  for (const width of [1440, 390]) {
    test(`keeps entry and debug panel legible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await connect(page);
      await page.getByRole("button", { name: "Use dark theme" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.getByRole("button", { name: "Disconnect wireframe session" }).click();
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });

      const entry = page.locator(".connect-screen");
      const card = entry.locator(".connect-card");
      await expect(card).toBeVisible();
      await expect(entry).toHaveCSS("color-scheme", "light");
      await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");

      const contrast = async (foreground: string, background: string) =>
        page.evaluate(({ foreground, background }) => {
          const channel = (normalized: number) =>
            normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          const luminance = (color: string) => {
            const values = color.match(/\d*\.?\d+/g)!.slice(0, 3).map(Number);
            const [r, g, b] = color.startsWith("color(srgb ")
              ? values
              : values.map((value) => value / 255);
            return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
          };
          const text = getComputedStyle(document.querySelector(foreground)!).color;
          const surface = getComputedStyle(document.querySelector(background)!).backgroundColor;
          const [lighter, darker] = [luminance(text), luminance(surface)].sort((a, b) => b - a);
          return (lighter + 0.05) / (darker + 0.05);
        }, { foreground, background });

      expect(await contrast(".connect-card h1", ".connect-card")).toBeGreaterThanOrEqual(3);
      expect(await contrast(".connect-card__intro p", ".connect-card")).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(".connect-card .tc-badge", ".connect-card .tc-badge")).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(".connect-log-button", ".connect-card")).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(".connect-button", ".connect-button")).toBeGreaterThanOrEqual(4.5);
      await expect(entry.locator(".connect-button")).toHaveCSS("color", "rgb(255, 255, 255)");

      await entry.getByRole("button", { name: /View debug log/ }).click();
      const log = page.getByTestId("debug-log");
      await expect(log).toBeVisible();
      await expect(log).toHaveCSS("color-scheme", "light");
      await expect(log).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
      await expect(page.locator("html")).toHaveCSS("background-color", "rgb(244, 246, 248)");
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 246, 248)");
      expect(await contrast(".debug-log__header strong", ".debug-log__header")).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(".debug-log__header small", ".debug-log__header")).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(".debug-log__entries time", ".debug-log__entries")).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(".debug-log__entries strong", ".debug-log__entries")).toBeGreaterThanOrEqual(4.5);
    });
  }
});

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

  test("frames asynchronously discovered space cards and resources without manual Fit", async ({
    page,
  }) => {
    await page.goto("/e2e/async-framing.html");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.locator(".react-flow__node:has(.canvas-node--space)")).toHaveCount(1);
    await page.evaluate(() => window.completeDiscovery());
    await expect(page.locator(".react-flow__node:has(.canvas-node--space)")).toHaveCount(5);
    await expect(page.locator(".react-flow__node:has(.canvas-node--resource)")).toHaveCount(3);
    await expect.poll(() => canvasNodesClear(page)).toBe(true);
  });

  test("a stationary pane click does not suppress discovery fit", async ({ page }) => {
    await page.goto("/e2e/async-framing.html");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.locator(".react-flow__node:has(.canvas-node--space)")).toHaveCount(1);
    const before = await page.locator(".react-flow__viewport").evaluate(
      (viewport) => getComputedStyle(viewport).transform,
    );
    await page.locator(".react-flow__pane").click({ position: { x: 50, y: 50 } });
    await expect(page.locator(".react-flow__viewport")).toHaveCSS("transform", before);
    await page.evaluate(() => window.completeDiscovery());
    await expect(page.locator(".react-flow__node:has(.canvas-node--space)")).toHaveCount(5);
    await expect(page.locator(".react-flow__node:has(.canvas-node--resource)")).toHaveCount(3);
    await expect.poll(() => canvasNodesClear(page)).toBe(true);
  });

  test("does not reset a user's zoom when discovery completes", async ({ page }) => {
    await page.goto("/e2e/async-framing.html");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.locator(".react-flow__node:has(.canvas-node--space)")).toHaveCount(1);
    await page.locator(".react-flow__controls-zoomout").click();
    await page.waitForTimeout(400); // React Flow animates a manual zoom for 200 ms.
    const before = await page.locator(".react-flow__viewport").evaluate(
      (viewport) => getComputedStyle(viewport).transform,
    );
    await page.evaluate(() => window.completeDiscovery());
    await expect(page.locator(".react-flow__node:has(.canvas-node--space)")).toHaveCount(5);
    await expect(page.locator(".react-flow__viewport")).toHaveCSS("transform", before);
  });

  test("leaves a manual pan in place until the user chooses Fit", async ({ page }) => {
    await page.goto("/e2e/async-framing.html");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.locator(".react-flow__node:has(.canvas-node--space)")).toHaveCount(1);
    const canvas = await page.locator(".cartograph").boundingBox();
    expect(canvas).not.toBeNull();
    await page.mouse.move(canvas!.x + 100, canvas!.y + 100);
    await page.mouse.down();
    await page.mouse.move(canvas!.x + 180, canvas!.y + 140, { steps: 5 });
    await page.mouse.up();
    const before = await page.locator(".react-flow__viewport").evaluate(
      (viewport) => getComputedStyle(viewport).transform,
    );
    await page.evaluate(() => window.completeDiscovery());
    await expect(page.locator(".react-flow__node:has(.canvas-node--space)")).toHaveCount(5);
    await expect(page.locator(".react-flow__viewport")).toHaveCSS("transform", before);
    await page.locator(".react-flow__controls-fitview").click();
    await expect.poll(() => page.locator(".react-flow__viewport").evaluate(
      (viewport) => getComputedStyle(viewport).transform,
    )).not.toBe(before);
  });

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

test.describe("asynchronous phone discovery", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.skip(({ isMobile }) => !isMobile, "Phone layout only");

  test("keeps the loading ledger distinct from a finished empty space", async ({ page }) => {
    await page.goto("/e2e/async-framing.html");
    await page.getByTestId("connect-tinycloud").click();
    await expect(page.getByTestId("ledger-discovery-skeleton")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No resources found" })).toHaveCount(0);
    await page.evaluate(() => window.completeDiscovery());
    await expect(page.getByTestId("ledger-discovery-skeleton")).toHaveCount(0);
    await expect(page.locator(".ledger__resources li")).toHaveCount(3);
    await expect(page.locator(".canvas-desktop")).toBeHidden();
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
