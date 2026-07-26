import { describe, expect, it } from "vitest";
import { FixtureExplorerDataSource } from "./fixtureDataSource";
import { spaceToJsonCanvas } from "./jsonCanvas";

describe("spaceToJsonCanvas", () => {
  it("projects TinyCloud spaces and resources into spec-compatible nodes", async () => {
    const snapshot = await new FixtureExplorerDataSource().connect();
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
      },
    });
  });

  it("keeps TinyCloud extensions under a single tc key", async () => {
    const snapshot = await new FixtureExplorerDataSource().connect();
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
