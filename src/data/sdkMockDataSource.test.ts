import { describe, expect, it } from "vitest";
import { SdkMockExplorerDataSource } from "./sdkMockDataSource";

describe("SdkMockExplorerDataSource", () => {
  it("loads seeded spaces and resources through SDK mock operations", async () => {
    const source = new SdkMockExplorerDataSource(0);
    const snapshot = await source.connect();
    const listen = snapshot.spaces.find((space) => space.id === "listen");

    expect(snapshot.identity.nodeUrl).toBe("https://node.tinycloud.xyz");
    expect(snapshot.spaces).toHaveLength(4);
    expect(listen?.resources).toHaveLength(5);
    expect(listen?.resources.some((resource) => resource.kind === "sql")).toBe(
      true,
    );
    expect(listen?.resources.some((resource) => resource.kind === "kv")).toBe(
      true,
    );
    expect(
      listen?.resources.find((resource) => resource.id === "listen-audit-log"),
    ).toMatchObject({
      name: "audit-log",
      access: "needs-permission",
      size: null,
      tables: [],
    });
    expect(snapshot.evidence.every((step) => step.verified)).toBe(true);
    expect(
      source.getSdkOperations().some((operation) => operation.type === "list"),
    ).toBe(true);
    expect(
      source.getSdkOperations().some((operation) => operation.type === "get"),
    ).toBe(true);
  });

  it("runs read queries and rejects mutation in the read-only wireframe", async () => {
    const source = new SdkMockExplorerDataSource(0);
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

  it("grants read permission through the SDK mock store", async () => {
    const source = new SdkMockExplorerDataSource(0);
    const before = await source.connect();
    const auditBefore = before.spaces
      .find((space) => space.id === "listen")
      ?.resources.find((resource) => resource.id === "listen-audit-log");

    expect(auditBefore).toMatchObject({
      access: "needs-permission",
      permissions: { list: true, describe: true, read: false, grant: true },
    });

    const auditAfter = await source.grantPermission(
      "listen",
      "listen-audit-log",
    );

    expect(auditAfter).toMatchObject({
      access: "read-only",
      permissions: { read: true, write: false, query: true, grant: false },
    });
    expect(auditAfter.kind === "sql" && auditAfter.tables.length).toBeGreaterThan(
      0,
    );
    expect(
      source.getSdkOperations().some((operation) => operation.type === "put"),
    ).toBe(true);
  });
});
