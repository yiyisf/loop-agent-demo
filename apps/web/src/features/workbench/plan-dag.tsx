import type { Step } from '@loop-agent/shared';
import {
  Background,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo } from 'react';
import { StepStatusIcon, stepStatusRing } from '@/features/chat/parts/step-status-icon';
import { stepStatusLabel } from '@/lib/run-view';
import { cn } from '@/lib/utils';

const NODE_W = 168;
const NODE_H = 52;
const GAP_X = 20;
const GAP_Y = 44;

type StepNodeData = { step: Step; index: number; selected: boolean };
type StepNode = Node<StepNodeData, 'step'>;

/**
 * Longest-path layering: a step sits one row below its deepest dependency, so
 * parallel branches end up side by side and the critical path reads top-down.
 */
export function layoutSteps(steps: Step[]): Map<string, { x: number; y: number }> {
  const level = new Map<string, number>();
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visit = (id: string, trail: Set<string>): number => {
    const cached = level.get(id);
    if (cached !== undefined) return cached;
    if (trail.has(id)) return 0;
    trail.add(id);
    const step = byId.get(id);
    const depth = step
      ? step.dependsOn.reduce((max, dep) => Math.max(max, visit(dep, trail) + 1), 0)
      : 0;
    level.set(id, depth);
    return depth;
  };
  for (const s of steps) visit(s.id, new Set());

  const rows = new Map<number, string[]>();
  for (const s of steps) {
    const l = level.get(s.id) ?? 0;
    rows.set(l, [...(rows.get(l) ?? []), s.id]);
  }
  const widest = Math.max(1, ...[...rows.values()].map((r) => r.length));
  const totalW = widest * NODE_W + (widest - 1) * GAP_X;

  const pos = new Map<string, { x: number; y: number }>();
  for (const [l, ids] of rows) {
    const rowW = ids.length * NODE_W + (ids.length - 1) * GAP_X;
    const offset = (totalW - rowW) / 2;
    ids.forEach((id, i) => {
      pos.set(id, { x: offset + i * (NODE_W + GAP_X), y: l * (NODE_H + GAP_Y) });
    });
  }
  return pos;
}

function StepNodeView({ data }: NodeProps<StepNode>) {
  const { step, index, selected } = data;
  return (
    <div
      className={cn(
        'flex h-[52px] w-[168px] items-center gap-2 rounded-lg border bg-card px-2.5 text-left shadow-xs transition-colors',
        stepStatusRing(step.status),
        selected && 'ring-2 ring-primary/60',
      )}
      title={`${step.title}\n${stepStatusLabel[step.status]}`}
    >
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-border" />
      <StepStatusIcon status={step.status} className="size-3.5" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium leading-4">
          <span className="mr-1 text-muted-foreground">{index + 1}.</span>
          {step.title}
        </div>
        <div className="truncate text-[10px] leading-4 text-muted-foreground">
          {stepStatusLabel[step.status]}
          {step.tools.length > 0 && ` · ${step.tools.length} 工具`}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-border" />
    </div>
  );
}

const nodeTypes = { step: StepNodeView };

function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  // Node sizes are only known after the first measured render; fitting before
  // that leaves the graph at zoom 1 with the bottom rows clipped.
  const initialized = useNodesInitialized();
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit whenever the graph shape changes
  useEffect(() => {
    if (!initialized) return;
    const id = requestAnimationFrame(() => void fitView({ padding: 0.12, duration: 200 }));
    return () => cancelAnimationFrame(id);
  }, [initialized, signature, fitView]);
  return null;
}

export function PlanDag({
  steps,
  selectedStepId,
  onSelect,
  className,
}: {
  steps: Step[];
  selectedStepId: string | undefined;
  onSelect: (stepId: string) => void;
  className?: string;
}) {
  const { nodes, edges } = useMemo(() => {
    const pos = layoutSteps(steps);
    const nodes: StepNode[] = steps.map((step, index) => ({
      id: step.id,
      type: 'step',
      position: pos.get(step.id) ?? { x: 0, y: index * (NODE_H + GAP_Y) },
      data: { step, index, selected: step.id === selectedStepId },
      draggable: false,
      connectable: false,
      selectable: false,
    }));
    const ids = new Set(steps.map((s) => s.id));
    const edges: Edge[] = steps.flatMap((step) =>
      step.dependsOn
        .filter((dep) => ids.has(dep))
        .map((dep) => ({
          id: `${dep}->${step.id}`,
          source: dep,
          target: step.id,
          type: 'smoothstep',
          animated: step.status === 'running',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          style: { strokeWidth: 1.25 },
        })),
    );
    return { nodes, edges };
  }, [steps, selectedStepId]);

  const signature = steps.map((s) => `${s.id}:${s.dependsOn.join('|')}`).join(',');

  return (
    <div className={cn('relative', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnDoubleClick={false}
        colorMode="system"
        className="!bg-transparent"
        aria-label="计划步骤依赖图"
      >
        <Background gap={16} size={1} className="!text-border/40" />
        <FitOnChange signature={signature} />
      </ReactFlow>
    </div>
  );
}
