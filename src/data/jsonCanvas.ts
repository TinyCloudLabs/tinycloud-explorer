import type {
  TinyCloudResource,
  TinyCloudSpace,
} from "./ExplorerDataSource";

export interface JsonCanvasNode {
  id: string;
  type: "file" | "group" | "text";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  file?: string;
  subpath?: string;
  label?: string;
  text?: string;
  tc?: Record<string, unknown>;
}

export interface JsonCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toSide?: "top" | "right" | "bottom" | "left";
  toEnd?: "none" | "arrow";
  label?: string;
  color?: string;
  tc?: Record<string, unknown>;
}

export interface JsonCanvasDocument {
  nodes: JsonCanvasNode[];
  edges: JsonCanvasEdge[];
}

function resourceNode(
  resource: TinyCloudResource,
  space: TinyCloudSpace,
  index: number,
): JsonCanvasNode {
  return {
    id: resource.id,
    type: "file",
    file: `tc://${space.id}/${resource.kind}/${resource.name}`,
    x: 490,
    y: 80 + index * 150,
    width: 300,
    height: 116,
    color: "5",
    tc: {
      kind: "resource",
      resourceType: resource.kind,
      space: space.id,
      path: resource.path,
      access: resource.access,
      grantedBy: resource.grantedBy,
      expiresAt: resource.expiresAt,
    },
  };
}

export function spaceToJsonCanvas(
  spaces: TinyCloudSpace[],
  selectedSpace: TinyCloudSpace,
): JsonCanvasDocument {
  const otherSpaces = spaces.filter((space) => space.id !== selectedSpace.id);
  const nodes: JsonCanvasNode[] = [
    ...otherSpaces.map<JsonCanvasNode>((space, index) => ({
      id: space.id,
      type: "group",
      label: space.name,
      x: 40,
      y: 50 + index * 180,
      width: 260,
      height: 124,
      color: "5",
      tc: {
        kind: "space",
        space: space.id,
        resourceCount: space.resourceCount,
        access: space.access,
      },
    })),
    {
      id: selectedSpace.id,
      type: "group",
      label: selectedSpace.name,
      x: 390,
      y: 25,
      width: 500,
      height: Math.max(470, selectedSpace.resources.length * 150 + 80),
      color: "5",
      tc: {
        kind: "space",
        space: selectedSpace.id,
        resourceCount: selectedSpace.resourceCount,
        access: selectedSpace.access,
      },
    },
    ...selectedSpace.resources.map((resource, index) =>
      resourceNode(resource, selectedSpace, index),
    ),
  ];

  const edges: JsonCanvasEdge[] = otherSpaces.map((space, index) => ({
    id: `edge-${space.id}-${selectedSpace.id}`,
    fromNode: space.id,
    toNode: selectedSpace.id,
    fromSide: "right",
    toSide: "left",
    toEnd: "arrow",
    color: index === 0 ? "5" : undefined,
    label: "accessible",
    tc: {
      kind: "delegation",
      ability: "tinycloud.space/read",
    },
  }));

  return { nodes, edges };
}
