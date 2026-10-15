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
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  Eye,
  KeyRound,
  LockKeyhole,
  PencilLine,
  Table2,
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
  onOpen: (mode: "table" | "query" | "value") => void;
  onGrant: () => void;
}

type SpaceFlowNode = Node<SpaceNodeData, "space">;
type ResourceFlowNode = Node<ResourceNodeData, "resource">;
type ExplorerFlowNode = SpaceFlowNode | ResourceFlowNode;

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
      {data.selected ? (
        <ChevronDown aria-hidden="true" size={18} />
      ) : (
        <ChevronRight aria-hidden="true" size={18} />
      )}
    </div>
  );
}

function ResourceNode({ data }: NodeProps<ResourceFlowNode>) {
  const ResourceIcon = data.kind === "sql" ? Database : KeyRound;
  const needsPermission = data.access === "needs-permission";
  const AccessIcon =
    data.access === "read-write"
      ? PencilLine
      : needsPermission
        ? LockKeyhole
        : Eye;
  const accessLabel =
    data.access === "read-write"
      ? "read + write"
      : needsPermission
        ? "Needs additional permission"
        : "read only";
  return (
    <div
      className={`canvas-node canvas-node--resource canvas-node--${data.access}${data.selected ? " is-selected" : ""}`}
    >
      <ResourceIcon aria-hidden="true" size={21} />
      <span className="canvas-node__body">
        <strong>{data.label}</strong>
        <small>
          {data.kind.toUpperCase()}
          <span aria-hidden="true"> · </span>
          <span className="canvas-node__access">
            <AccessIcon aria-hidden="true" size={12} />
            {accessLabel}
          </span>
        </small>
      </span>
      <AccessIcon aria-hidden="true" size={15} />
      <Handle type="target" position={Position.Left} />
      {data.selected && (
        <div
          className="canvas-node__actions nodrag"
          onClick={(event) => event.stopPropagation()}
        >
          {needsPermission ? (
            <button
              type="button"
              data-testid="canvas-grant-permission"
              onClick={data.onGrant}
            >
              <KeyRound aria-hidden="true" size={14} />
              Request access
            </button>
          ) : data.kind === "sql" ? (
            <>
              <button
                type="button"
                data-testid="canvas-open-table"
                onClick={() => data.onOpen("table")}
              >
                <Table2 aria-hidden="true" size={14} />
                Open table
              </button>
              <button
                type="button"
                onClick={() => data.onOpen("query")}
              >
                <Code2 aria-hidden="true" size={14} />
                Open query
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="canvas-open-value"
              onClick={() => data.onOpen("value")}
            >
              <KeyRound aria-hidden="true" size={14} />
              Inspect values
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  space: SpaceNode,
  resource: ResourceNode,
};

// Light Fit View leaves room for the 44px controls and the bottom minimap.
const lightFitViewOptions = {
  padding: { top: "40px", right: "88px", bottom: "148px", left: "40px" },
} as const;

const nodeKeyboardInstructions =
  "Enter or Space selects. Shift+Enter opens. 1, 2 and 3 switch between system, space and resource levels. Escape goes up a level; at system level it clears the selected resource.";
const canvasAriaLabels = {
  "node.a11yDescription.default": nodeKeyboardInstructions,
  "node.a11yDescription.keyboardDisabled": nodeKeyboardInstructions,
};

function toFlowNode(
  node: JsonCanvasNode,
  selectedSpace: TinyCloudSpace,
  selectedResourceId: string | null,
  onOpenResource: (
    resourceId: string,
    mode: "table" | "query" | "value",
  ) => void,
  onGrantPermission: (resourceId: string) => void,
): ExplorerFlowNode {
  const kind = node.tc?.kind;
  if (kind === "resource") {
    const isSelected = node.id === selectedResourceId;
    const resourceLabel =
      selectedSpace.resources.find((resource) => resource.id === node.id)?.name ??
      node.id;
    return {
      id: node.id,
      type: "resource",
      position: { x: node.x, y: node.y },
      data: {
        label: resourceLabel,
        kind: (node.tc?.resourceType as "sql" | "kv") ?? "kv",
        access: String(node.tc?.access ?? "read-only"),
        selected: isSelected,
        onOpen: (mode) => onOpenResource(node.id, mode),
        onGrant: () => onGrantPermission(node.id),
      },
      selected: isSelected,
      draggable: true,
      style: {
        width: node.width,
        height: isSelected ? 132 : node.height,
      },
      ariaLabel: `${node.tc?.resourceType} resource ${resourceLabel}, ${isSelected ? "selected" : "not selected"}`,
    };
  }

  const isSelected = node.id === selectedSpace.id;
  const flowNode: SpaceFlowNode = {
    id: node.id,
    type: "space",
    position: { x: node.x, y: node.y },
    data: {
      label: node.label ?? node.id,
      resourceCount: Number(node.tc?.resourceCount ?? 0),
      selected: isSelected,
    },
    selected: isSelected,
    draggable: true,
    selectable: true,
    style: {
      width: node.width,
      height: node.height,
      zIndex: 1,
    },
    ariaLabel: `Space ${node.label ?? node.id}, ${node.tc?.resourceCount} resources, ${isSelected ? "selected" : "not selected"}`,
  };
  return flowNode;
}

interface CartographCanvasProps {
  spaces: TinyCloudSpace[];
  selectedSpace: TinyCloudSpace;
  selectedResource: TinyCloudResource | null;
  theme: "light" | "dark";
  onSelectSpace: (spaceId: string) => void;
  onOpenSpace: (spaceId: string) => void;
  onSelectResource: (resourceId: string) => void;
  onOpenResource: (
    resourceId: string,
    mode?: "table" | "query" | "value",
  ) => void;
  onGrantPermission: (resourceId: string) => void;
}

function CartographCanvasInner({
  spaces,
  selectedSpace,
  selectedResource,
  theme,
  onSelectSpace,
  onOpenSpace,
  onSelectResource,
  onOpenResource,
  onGrantPermission,
}: CartographCanvasProps) {
  const document = useMemo(
    () => spaceToJsonCanvas(spaces, selectedSpace),
    [selectedSpace, spaces],
  );
  const nodes = useMemo(
    () =>
      document.nodes.map((node) =>
        toFlowNode(
          node,
          selectedSpace,
          selectedResource?.id ?? null,
          onOpenResource,
          onGrantPermission,
        ),
      ),
    [
      document.nodes,
      onGrantPermission,
      onOpenResource,
      selectedResource?.id,
      selectedSpace,
    ],
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
        style: {
          stroke: "var(--tc-color-text-muted)",
          strokeWidth: 1,
          strokeDasharray:
            edge.tc?.access === "needs-permission" ? "6 5" : undefined,
        },
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

  const fitViewOptions = theme === "light" ? lightFitViewOptions : undefined;

  return (
    <div
      className="cartograph"
      role="application"
      aria-label={`TinyCloud map. ${selectedSpace.name} selected with ${selectedSpace.resourceCount} resources.`}
      data-testid="cartograph-canvas"
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.classList.contains("react-flow__node")) return;
        const node = nodes.find((item) => item.id === target.dataset.id);
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        handleNode(node, event.shiftKey && event.key === "Enter");
      }}
    >
      <div className="sr-only" role="status" aria-atomic="true">
        {selectedResource
          ? `${selectedResource.name} resource selected`
          : `${selectedSpace.name} space selected`}
      </div>
      <ReactFlow<ExplorerFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        edgesFocusable={false}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.45}
        maxZoom={1.6}
        nodesConnectable={false}
        deleteKeyCode={null}
        ariaLabelConfig={canvasAriaLabels}
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
          fitViewOptions={fitViewOptions}
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
