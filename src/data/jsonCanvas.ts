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
    x: 480,
    y: 50 + index * 148,
    width: 320,
    height: 112,
    color: "5",
    tc: {
      kind: "resource",
      resourceType: resource.kind,
      space: space.id,
      path: resource.path,
      access: resource.access,
      permissions: resource.permissions,
      grantedBy: resource.grantedBy,
      expiresAt: resource.expiresAt,
    },
  };
}

export function spaceToJsonCanvas(
  spaces: TinyCloudSpace[],
  selectedSpace: TinyCloudSpace,
): JsonCanvasDocument {
  const nodes: JsonCanvasNode[] = [
    ...spaces.map<JsonCanvasNode>((space, index) => ({
      id: space.id,
      type: "group",
      label: space.name,
      x: 40,
      y: 50 + index * 148,
      width: 270,
      height: 112,
      color: "5",
      tc: {
        kind: "space",
        space: space.id,
        resourceCount: space.resourceCount,
        access: space.access,
      },
    })),
    ...selectedSpace.resources.map((resource, index) =>
      resourceNode(resource, selectedSpace, index),
    ),
  ];

  const edges: JsonCanvasEdge[] = selectedSpace.resources.map((resource) => ({
    id: `edge-${selectedSpace.id}-${resource.id}`,
    fromNode: selectedSpace.id,
    toNode: resource.id,
    fromSide: "right",
    toSide: "left",
    toEnd: "arrow",
    color: "5",
    tc: {
      kind: "contains",
      access: resource.access,
    },
  }));

  return { nodes, edges };
}
