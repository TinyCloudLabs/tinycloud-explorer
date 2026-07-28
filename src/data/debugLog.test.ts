import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearExplorerLogs,
  explorerLog,
  getExplorerLogs,
  subscribeExplorerLogs,
} from "./debugLog";

describe("Explorer debug log", () => {
  beforeEach(() => {
    clearExplorerLogs();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("redacts authentication material and stored values", () => {
    explorerLog("info", "auth", "Connected", {
      address: "0x1234",
      authorization: "Bearer live-token",
      note: "request failed with Bearer abcdefghij.klmnopqrst.uvwxyz12345",
      nested: {
        signature: "0xsigned",
        value: { private: true },
      },
    });

    expect(getExplorerLogs()[0]).toMatchObject({
      scope: "auth",
      details: {
        address: "0x1234",
        authorization: "[redacted]",
        note: "request failed with Bearer [redacted]",
        nested: {
          signature: "[redacted]",
          value: "[redacted]",
        },
      },
    });
  });

  it("publishes updates and clears the current session log", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeExplorerLogs(listener);
    explorerLog("info", "spaces", "Discovered", { count: 4 });
    clearExplorerLogs();
    unsubscribe();

    expect(listener).toHaveBeenLastCalledWith([]);
  });
});
