import { describe, expect, it } from "vitest";
import { FixtureExplorerDataSource } from "./fixtureDataSource";

describe("FixtureExplorerDataSource", () => {
  it("exposes the complete account, SQL, and KV walkthrough", async () => {
    const source = new FixtureExplorerDataSource();
    const snapshot = await source.connect();
    const listen = snapshot.spaces.find((space) => space.id === "listen");

    expect(snapshot.identity.nodeUrl).toBe("https://node.tinycloud.xyz");
    expect(snapshot.spaces).toHaveLength(4);
    expect(listen?.resources.some((resource) => resource.kind === "sql")).toBe(
      true,
    );
    expect(listen?.resources.some((resource) => resource.kind === "kv")).toBe(
      true,
    );
    expect(snapshot.evidence.every((step) => step.verified)).toBe(true);
  });

  it("runs read queries and rejects mutation in the read-only wireframe", async () => {
    const source = new FixtureExplorerDataSource();
    const result = await source.runQuery(
      "listen",
      "listen-conversations",
      "SELECT source, COUNT(*) AS total FROM conversations GROUP BY source",
    );

    expect(result.columns.map((column) => column.name)).toEqual([
      "source",
      "total",
    ]);
    expect(result.rows).toHaveLength(3);
    await expect(
      source.runQuery(
        "listen",
        "listen-conversations",
        "DELETE FROM conversations",
      ),
    ).rejects.toThrow("only permits SELECT");
  });
});
