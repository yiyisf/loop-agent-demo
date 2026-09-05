import type {
  Approval,
  LoopAgentDataParts,
  Plan,
  PlanDiff,
  RunStatus,
  Step,
  ToolCallRecord,
  Usage,
  UserQuestion,
} from '@loop-agent/shared';
import { TERMINAL_RUN_STATUSES } from '@loop-agent/shared';
import type { AgentUIMessage } from './types';

/** Everything the UI needs about a run, derived from one assistant message's parts. */
export interface RunView {
  runId?: string;
  status?: RunStatus;
  statusReason?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  plan?: Plan;
  planDiff?: PlanDiff;
  planReason?: string;
  steps: Step[];
  toolCalls: ToolCallRecord[];
  approvals: Approval[];
  questions: UserQuestion[];
  usage?: Usage;
  finalText: string;
  isTerminal: boolean;
}

export function deriveRunView(message: AgentUIMessage | undefined): RunView {
  const view: RunView = {
    steps: [],
    toolCalls: [],
    approvals: [],
    questions: [],
    finalText: '',
    isTerminal: false,
  };
  if (!message) return view;

  const stepMap = new Map<string, Step>();
  for (const part of message.parts) {
    switch (part.type) {
      case 'data-run': {
        const d = part.data as LoopAgentDataParts['run'];
        view.runId = d.runId;
        view.status = d.status;
        view.statusReason = d.reason;
        view.error = d.error;
        view.startedAt = d.startedAt;
        view.endedAt = d.endedAt;
        break;
      }
      case 'data-plan': {
        const d = part.data as LoopAgentDataParts['plan'];
        view.plan = d.plan;
        view.planDiff = d.diff;
        view.planReason = d.reason;
        break;
      }
      case 'data-step':
        stepMap.set((part.data as Step).id, part.data as Step);
        break;
      case 'data-tool':
        view.toolCalls.push(part.data as ToolCallRecord);
        break;
      case 'data-approval':
        view.approvals.push(part.data as Approval);
        break;
      case 'data-question':
        view.questions.push(part.data as UserQuestion);
        break;
      case 'data-usage':
        view.usage = part.data as Usage;
        break;
      case 'text':
        view.finalText += part.text;
        break;
      default:
        break;
    }
  }

  // Preserve plan ordering; fall back to arrival order for steps without a plan.
  const order = view.plan?.steps.map((s) => s.id) ?? [...stepMap.keys()];
  view.steps = order.map((id) => stepMap.get(id) ?? view.plan!.steps.find((s) => s.id === id)!);
  view.isTerminal = view.status ? TERMINAL_RUN_STATUSES.has(view.status) : false;
  if (!view.runId) view.runId = message.metadata?.runId;
  return view;
}

export const runStatusLabel: Record<RunStatus, string> = {
  queued: '排队中',
  planning: '规划中',
  awaiting_plan_confirmation: '等待确认计划',
  executing: '执行中',
  replanning: '调整计划',
  awaiting_approval: '等待审批',
  awaiting_user: '等待回答',
  finalizing: '生成回答',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export const stepStatusLabel: Record<Step['status'], string> = {
  pending: '待执行',
  ready: '就绪',
  running: '执行中',
  succeeded: '完成',
  failed: '失败',
  skipped: '已跳过',
  blocked: '已阻塞',
  cancelled: '已取消',
  waiting_approval: '等待审批',
  waiting_user: '等待回答',
};
