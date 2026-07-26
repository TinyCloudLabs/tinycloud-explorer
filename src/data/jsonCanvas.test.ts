import { describe, expect, it } from "vitest";
import { SdkMockExplorerDataSource } from "./sdkMockDataSource";
import { spaceToJsonCanvas } from "./jsonCanvas";

describe("spaceToJsonCanvas", () => {
  it("projects TinyCloud spaces and resources into spec-compatible nodes", async () => {
    const snapshot = await new SdkMockExplorerDataSource(0).connect();
    const listen = snapshot.spaces.find((space) => space.id === "listen")!;
    const document = spaceToJsonCanvas(snapshot.spaces, listen);

    expect(document.nodes).toHaveLength(
      snapshot.spaces.length + listen.resources.length,
    );
    expect(
      document.nodes.find((node) => node.id === "listen"),
    ).toMatchObject({
      type: "group",
      label: "listen",
      tc: {
        kind: "space",
        space: "listen",
      },
    });
    expect(
      document.nodes.find((node) => node.id === "listen-conversations"),
    ).toMatchObject({
      type: "file",
      file: "tc://listen/sql/conversations",
      color: "5",
      tc: {
        kind: "resource",
        resourceType: "sql",
        space: "listen",
        permissions: expect.objectContaining({
          list: true,
          read: true,
          write: true,
        }),
      },
    });
    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromNode: "listen",
          toNode: "listen-conversations",
          tc: expect.objectContaining({ kind: "contains" }),
        }),
      ]),
    );
  });

  it("keeps TinyCloud extensions under a single tc key", async () => {
    const snapshot = await new SdkMockExplorerDataSource(0).connect();
    const document = spaceToJsonCanvas(snapshot.spaces, snapshot.spaces[0]);
    const allowed = new Set([
      "id",
      "type",
      "x",
      "y",
      "width",
      "height",
      "color",
      "file",
      "subpath",
      "label",
      "text",
      "tc",
    ]);

    for (const node of document.nodes) {
      expect(Object.keys(node).every((key) => allowed.has(key))).toBe(true);
    }
  });
});
