import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  Box,
  ChevronRight,
  Database,
  KeyRound,
  LockKeyhole,
} from "lucide-react";
import { useMemo } from "react";
import type {
  TinyCloudResource,
  TinyCloudSpace,
} from "../data/ExplorerDataSource";
import {
  spaceToJsonCanvas,
  type JsonCanvasNode,
} from "../data/jsonCanvas";

interface SpaceNodeData extends Record<string, unknown> {
  label: string;
  resourceCount: number;
  selected: boolean;
}

interface ResourceNodeData extends Record<string, unknown> {
  label: string;
  kind: "sql" | "kv";
  access: string;
  selected: boolean;
}

type SpaceFlowNode = Node<SpaceNodeData, "space">;
type SpaceGroupFlowNode = Node<SpaceNodeData, "spaceGroup">;
type ResourceFlowNode = Node<ResourceNodeData, "resource">;
type ExplorerFlowNode =
  | SpaceFlowNode
  | SpaceGroupFlowNode
  | ResourceFlowNode;

function SpaceNode({ data }: NodeProps<SpaceFlowNode>) {
  return (
    <div
      className={`canvas-node canvas-node--space${data.selected ? " is-selected" : ""}`}
    >
      <Handle type="source" position={Position.Right} />
      <Box aria-hidden="true" size={20} strokeWidth={1.75} />
      <span className="canvas-node__body">
        <strong>{data.label}</strong>
        <small>{data.resourceCount} resources</small>
      </span>
      <ChevronRight aria-hidden="true" size={18} />
    </div>
  );
}

function SpaceGroupNode({ data }: NodeProps<SpaceGroupFlowNode>) {
  return (
    <div className="canvas-group">
      <Handle type="target" position={Position.Left} />
      <div className="canvas-group__header">
        <Database aria-hidden="true" size={22} />
        <span>
          <strong>{data.label}</strong>
          <small>{data.resourceCount} resources</small>
        </span>
        <span className="tc-badge">{data.selected ? "selected space" : "space"}</span>
      </div>
    </div>
  );
}

function ResourceNode({ data }: NodeProps<ResourceFlowNode>) {
  const ResourceIcon = data.kind === "sql" ? Database : KeyRound;
  return (
    <div
      className={`canvas-node canvas-node--resource${data.selected ? " is-selected" : ""}`}
    >
      <ResourceIcon aria-hidden="true" size={21} />
      <span className="canvas-node__body">
        <strong>{data.label}</strong>
        <small>{data.kind.toUpperCase()}</small>
      </span>
      <LockKeyhole aria-hidden="true" size={15} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

const nodeTypes = {
  space: SpaceNode,
  spaceGroup: SpaceGroupNode,
  resource: ResourceNode,
};

function toFlowNode(
  node: JsonCanvasNode,
  selectedSpace: TinyCloudSpace,
  selectedResourceId: string | null,
): ExplorerFlowNode {
  const kind = node.tc?.kind;
  if (kind === "resource") {
    return {
      id: node.id,
      type: "resource",
      position: { x: node.x, y: node.y },
      data: {
        label:
          selectedSpace.resources.find((resource) => resource.id === node.id)
            ?.name ?? node.id,
        kind: (node.tc?.resourceType as "sql" | "kv") ?? "kv",
        access: String(node.tc?.access ?? "read-only"),
        selected: node.id === selectedResourceId,
      },
      selected: node.id === selectedResourceId,
      draggable: true,
      style: { width: node.width, height: node.height },
      ariaLabel: `${node.tc?.resourceType} resource ${node.id}`,
    };
  }

  const isSelectedGroup = node.id === selectedSpace.id;
  const flowNode: SpaceFlowNode | SpaceGroupFlowNode = {
    id: node.id,
    type: isSelectedGroup ? "spaceGroup" : "space",
    position: { x: node.x, y: node.y },
    data: {
      label: node.label ?? node.id,
      resourceCount: Number(node.tc?.resourceCount ?? 0),
      selected: isSelectedGroup,
    },
    selected: isSelectedGroup,
    draggable: !isSelectedGroup,
    selectable: true,
    style: {
      width: node.width,
      height: node.height,
      zIndex: isSelectedGroup ? -1 : 1,
    },
    ariaLabel: `Space ${node.label}, ${node.tc?.resourceCount} resources`,
  };
  return flowNode;
}

interface CartographCanvasProps {
  spaces: TinyCloudSpace[];
  selectedSpace: TinyCloudSpace;
  selectedResource: TinyCloudResource | null;
  onSelectSpace: (spaceId: string) => void;
  onOpenSpace: (spaceId: string) => void;
  onSelectResource: (resourceId: string) => void;
  onOpenResource: (resourceId: string) => void;
}

function CartographCanvasInner({
  spaces,
  selectedSpace,
  selectedResource,
  onSelectSpace,
  onOpenSpace,
  onSelectResource,
  onOpenResource,
}: CartographCanvasProps) {
  const document = useMemo(
    () => spaceToJsonCanvas(spaces, selectedSpace),
    [selectedSpace, spaces],
  );
  const nodes = useMemo(
    () =>
      document.nodes.map((node) =>
        toFlowNode(node, selectedSpace, selectedResource?.id ?? null),
      ),
    [document.nodes, selectedResource?.id, selectedSpace],
  );
  const edges = useMemo<Edge[]>(
    () =>
      document.edges.map((edge) => ({
        id: edge.id,
        source: edge.fromNode,
        target: edge.toNode,
        type: "step",
        label: edge.label,
        animated: false,
        style: { stroke: "var(--tc-color-text-muted)", strokeWidth: 1 },
        labelStyle: {
          fill: "var(--tc-color-text-muted)",
          fontSize: 11,
        },
      })),
    [document.edges],
  );

  const handleNode = (node: ExplorerFlowNode, open: boolean) => {
    if (node.type === "resource") {
      if (open) onOpenResource(node.id);
      else onSelectResource(node.id);
      return;
    }
    if (open) onOpenSpace(node.id);
    else onSelectSpace(node.id);
  };

  return (
    <div
      className="cartograph"
      role="application"
      aria-label={`TinyCloud map. ${selectedSpace.name} selected with ${selectedSpace.resourceCount} resources.`}
      data-testid="cartograph-canvas"
    >
      <ReactFlow<ExplorerFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.45}
        maxZoom={1.6}
        nodesConnectable={false}
        deleteKeyCode={null}
        onNodeClick={(_, node) => handleNode(node, false)}
        onNodeDoubleClick={(_, node) => handleNode(node, true)}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color="var(--tc-color-field-dot)"
          gap={12}
          size={1}
        />
        <Controls
          showInteractive={false}
          position="top-right"
          aria-label="Canvas zoom controls"
        />
      </ReactFlow>
      <div className="canvas-minimap" role="img" aria-label="Canvas minimap">
        <span className="canvas-minimap__node canvas-minimap__node--one" />
        <span className="canvas-minimap__node canvas-minimap__node--two" />
        <span className="canvas-minimap__node canvas-minimap__node--three" />
        <span className="canvas-minimap__node canvas-minimap__node--selected" />
        <span className="canvas-minimap__viewport" />
      </div>
    </div>
  );
}

export function CartographCanvas(props: CartographCanvasProps) {
  return (
    <ReactFlowProvider>
      <CartographCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
