import { describe, expect, it } from "vitest";
import { serializeExplorerLogs } from "./DebugLogPanel";

describe("DebugLogPanel", () => {
  it("copies ISO timestamps and structured request telemetry", () => {
    const text = serializeExplorerLogs([
      {
        id: "log-1",
        timestamp: "2026-07-29T03:40:23.054Z",
        level: "info",
        scope: "http",
        message: "GET /info completed · HTTP 200 · 247.3 ms",
        details: {
          phase: "stop",
          startedAt: "2026-07-29T03:40:22.807Z",
          stoppedAt: "2026-07-29T03:40:23.054Z",
          elapsedMs: 247.3,
          httpStatus: 200,
        },
      },
    ]);

    expect(text).toContain("2026-07-29T03:40:23.054Z INFO [http]");
    expect(text).toContain('"startedAt":"2026-07-29T03:40:22.807Z"');
    expect(text).toContain('"stoppedAt":"2026-07-29T03:40:23.054Z"');
    expect(text).toContain('"elapsedMs":247.3');
    expect(text).toContain('"httpStatus":200');
  });
});
