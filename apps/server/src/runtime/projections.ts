import {
  type Approval,
  addUsage,
  type Plan,
  type Run,
  type RunEvent,
  type Step,
  TERMINAL_RUN_STATUSES,
  type UserQuestion,
} from '@loop-agent/shared';

export interface ToolCallRecord {
  stepId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
  state: 'calling' | 'done';
}

export interface RunSnapshot {
  run: Run;
  plan: Plan | null;
  approvals: Approval[];
  questions: UserQuestion[];
  toolCalls: ToolCallRecord[];
  lastSeq: number;
}

/**
 * Mutable projection of a run built purely from its event log. The engine
 * emits events and reads back from the projection, so persisted history,
 * live UI streams and reconnects all agree.
 */
export class RunState {
  run: Run;
  plan: Plan | null = null;
  approvals = new Map<string, Approval>();
  questions = new Map<string, UserQuestion>();
  toolCalls = new Map<string, ToolCallRecord>();
  finalText = '';
  lastSeq = 0;

  constructor(run: Run) {
    this.run = { ...run };
  }

  get steps(): Step[] {
    return this.plan?.steps ?? [];
  }

  step(stepId: string): Step | undefined {
    return this.plan?.steps.find((s) => s.id === stepId);
  }

  apply(event: RunEvent): void {
    this.lastSeq = Math.max(this.lastSeq, event.seq);
    switch (event.type) {
      case 'run.status': {
        this.run.status = event.status;
        if (event.status === 'planning' && !this.run.startedAt) this.run.startedAt = event.ts;
        if (TERMINAL_RUN_STATUSES.has(event.status)) this.run.endedAt = event.ts;
        if (event.status === 'failed' || event.status === 'cancelled') {
          if (event.reason) this.run.error = event.reason;
        }
        break;
      }
      case 'plan.created':
      case 'plan.revised': {
        this.plan = structuredClone(event.plan);
        this.run.currentRevision = event.plan.revision;
        break;
      }
      case 'step.status': {
        const step = this.step(event.stepId);
        if (!step) break;
        step.status = event.status;
        step.attempt = event.attempt;
        if (event.error !== undefined) step.error = event.error;
        if (event.status === 'running' && !step.startedAt) step.startedAt = event.ts;
        if (
          event.status === 'succeeded' ||
          event.status === 'failed' ||
          event.status === 'skipped' ||
          event.status === 'cancelled' ||
          event.status === 'blocked'
        ) {
          step.endedAt = event.ts;
        }
        break;
      }
      case 'step.result': {
        const step = this.step(event.stepId);
        if (step) step.result = event.result;
        break;
      }
      case 'tool.call': {
        this.toolCalls.set(event.toolCallId, {
          stepId: event.stepId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          state: 'calling',
        });
        break;
      }
      case 'tool.result': {
        const rec = this.toolCalls.get(event.toolCallId);
        if (rec) {
          rec.output = event.output;
          rec.isError = event.isError;
          rec.durationMs = event.durationMs;
          rec.state = 'done';
        } else {
          this.toolCalls.set(event.toolCallId, {
            stepId: event.stepId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: undefined,
            output: event.output,
            isError: event.isError,
            durationMs: event.durationMs,
            state: 'done',
          });
        }
        break;
      }
      case 'approval.requested': {
        this.approvals.set(event.approvalId, {
          id: event.approvalId,
          runId: event.runId,
          stepId: event.stepId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          reason: event.reason,
          status: 'pending',
          createdAt: event.ts,
        });
        break;
      }
      case 'approval.resolved': {
        const a = this.approvals.get(event.approvalId);
        if (a) {
          a.status = event.approved ? 'approved' : 'denied';
          a.resolution = event.reason;
          a.resolvedAt = event.ts;
        }
        break;
      }
      case 'user_question.asked': {
        this.questions.set(event.questionId, {
          id: event.questionId,
          runId: event.runId,
          stepId: event.stepId,
          question: event.question,
          options: event.options,
          createdAt: event.ts,
        });
        break;
      }
      case 'user_question.answered': {
        const q = this.questions.get(event.questionId);
        if (q) {
          q.answer = event.answer;
          q.answeredAt = event.ts;
        }
        break;
      }
      case 'final.text_delta': {
        this.finalText += event.delta;
        break;
      }
      case 'final.done': {
        this.finalText = event.answer;
        this.run.finalAnswer = event.answer;
        break;
      }
      case 'usage': {
        this.run.usage = addUsage(this.run.usage, event.usage);
        break;
      }
      case 'error': {
        if (event.fatal) this.run.error = event.message;
        break;
      }
      default:
        break;
    }
  }

  snapshot(): RunSnapshot {
    return {
      run: structuredClone(this.run),
      plan: this.plan ? structuredClone(this.plan) : null,
      approvals: [...this.approvals.values()].map((a) => structuredClone(a)),
      questions: [...this.questions.values()].map((q) => structuredClone(q)),
      toolCalls: [...this.toolCalls.values()].map((t) => structuredClone(t)),
      lastSeq: this.lastSeq,
    };
  }

  static replay(run: Run, events: Iterable<RunEvent>): RunState {
    const state = new RunState(run);
    for (const e of events) state.apply(e);
    return state;
  }
}
