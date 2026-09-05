import type { RunEvent } from '@loop-agent/shared';
import { nowIso } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import type { Stores } from '../store/types.js';
import { RunState } from './projections.js';
import { buildAssistantMessage } from './ui-stream.js';

export const SERVER_RESTART_REASON = 'Server restarted while the run was in progress';

/**
 * Runs that were in flight when the process died cannot be resumed (the basic
 * version keeps engine state in memory). Close them out from their persisted
 * events so history shows the partial progress plus a clear failure reason.
 */
export async function recoverInterruptedRuns(stores: Stores, logger: Logger): Promise<number> {
  const unfinished = await stores.runs.listUnfinished();
  for (const run of unfinished) {
    try {
      const events = await stores.runs.events(run.id, 0, 100_000);
      const state = RunState.replay({ ...run, status: 'queued' }, events);
      let seq = state.lastSeq;
      const ts = nowIso();
      const extra: RunEvent[] = [];

      for (const step of state.steps) {
        if (
          step.status === 'running' ||
          step.status === 'pending' ||
          step.status === 'ready' ||
          step.status === 'waiting_user' ||
          step.status === 'waiting_approval'
        ) {
          extra.push({
            type: 'step.status',
            stepId: step.id,
            status: 'cancelled',
            attempt: step.attempt,
            runId: run.id,
            seq: ++seq,
            ts,
          });
        }
      }
      extra.push({
        type: 'run.status',
        status: 'failed',
        reason: SERVER_RESTART_REASON,
        runId: run.id,
        seq: ++seq,
        ts,
      });

      for (const e of extra) {
        state.apply(e);
        await stores.runs.appendEvent(e);
      }
      const snapshot = state.snapshot();
      await stores.runs.saveSnapshot(snapshot);
      const thread = await stores.threads.get(run.threadId);
      if (thread) await stores.threads.appendMessage(run.threadId, buildAssistantMessage(snapshot));
    } catch (err) {
      logger.error({ err, runId: run.id }, 'failed to recover interrupted run');
    }
  }
  if (unfinished.length > 0) {
    logger.warn({ count: unfinished.length }, 'marked interrupted runs as failed');
  }
  return unfinished.length;
}
