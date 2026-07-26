import { describe, expect, it } from "vitest";

function ensureBrowserGlobals() {
  if (typeof globalThis.HTMLElement === "undefined") {
    globalThis.HTMLElement = class HTMLElement {} as typeof HTMLElement;
  }
  if (typeof globalThis.customElements === "undefined") {
    globalThis.customElements = {
      define() {},
      get() {
        return undefined;
      },
    } as unknown as typeof customElements;
  }
}

describe("createExplorerDataSource", () => {
  it("defaults to the real SDK-backed data source", async () => {
    ensureBrowserGlobals();
    const { createExplorerDataSource } = await import("./createExplorerDataSource");
    const dataSource = createExplorerDataSource({ mode: "" });
    expect(dataSource.mode).toBe("real");
  });

  it("keeps the seeded mock available only behind an explicit development toggle", async () => {
    ensureBrowserGlobals();
    const { createExplorerDataSource } = await import("./createExplorerDataSource");
    const dataSource = createExplorerDataSource({ mode: "mock" });
    expect(dataSource.mode).toBe("mock");
  });
});
