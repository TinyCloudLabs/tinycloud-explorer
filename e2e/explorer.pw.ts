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

  test("keeps controls and minimap clear of nodes at system and space levels", async ({
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
            const overlays = [...canvas.querySelectorAll(".react-flow__controls, .canvas-minimap")]
              .map((overlay) => overlay.getBoundingClientRect());
            return [...canvas.querySelectorAll(".react-flow__node")]
              .filter((node) => {
                const box = node.getBoundingClientRect();
                return overlays.some((overlay) =>
                  box.left < overlay.right && box.right > overlay.left &&
                  box.top < overlay.bottom && box.bottom > overlay.top
                );
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
});
