import { type RunEvent, type RunEventPayload, TRANSIENT_EVENT_TYPES } from '@loop-agent/shared';
import { nowIso } from '../lib/ids.js';

export type EventSink = (event: RunEvent) => void | Promise<void>;
type Subscriber = (event: RunEvent) => void;

interface RunChannel {
  seq: number;
  buffer: RunEvent[];
  subscribers: Set<Subscriber>;
  closed: boolean;
  releaseTimer?: NodeJS.Timeout;
}

export interface EventBusOptions {
  /** Persist non-transient events (called synchronously in append order). */
  sink?: EventSink;
  /** How long to keep a finished run's buffer in memory for late reconnects. */
  retainClosedMs?: number;
  /** Loader used for replaying events of runs no longer buffered in memory. */
  loadHistory?: (runId: string, fromSeq: number) => Promise<RunEvent[]>;
}

/**
 * In-memory, per-run ordered event log with pub/sub. Every event gets a
 * monotonically increasing `seq` so clients can resume from any position.
 */
export class EventBus {
  private channels = new Map<string, RunChannel>();

  constructor(private readonly options: EventBusOptions = {}) {}

  open(runId: string): void {
    if (this.channels.has(runId)) return;
    this.channels.set(runId, { seq: 0, buffer: [], subscribers: new Set(), closed: false });
  }

  has(runId: string): boolean {
    return this.channels.has(runId);
  }

  append(runId: string, payload: RunEventPayload): RunEvent {
    const channel = this.channels.get(runId);
    if (!channel) throw new Error(`EventBus: run ${runId} is not open`);
    if (channel.closed) throw new Error(`EventBus: run ${runId} is closed`);

    channel.seq += 1;
    const event = { ...payload, runId, seq: channel.seq, ts: nowIso() } as RunEvent;
    channel.buffer.push(event);

    for (const sub of channel.subscribers) {
      try {
        sub(event);
      } catch {
        // subscriber errors must not break the run
      }
    }

    if (this.options.sink && !TRANSIENT_EVENT_TYPES.has(event.type)) {
      void Promise.resolve(this.options.sink(event)).catch(() => undefined);
    }
    return event;
  }

  /** Marks the run finished: subscribers are completed, buffer retained briefly. */
  close(runId: string): void {
    const channel = this.channels.get(runId);
    if (!channel || channel.closed) return;
    channel.closed = true;
    for (const sub of channel.subscribers) sub(END_MARKER);
    channel.subscribers.clear();
    const retain = this.options.retainClosedMs ?? 5 * 60_000;
    channel.releaseTimer = setTimeout(() => this.channels.delete(runId), retain);
    channel.releaseTimer.unref?.();
  }

  isClosed(runId: string): boolean {
    return this.channels.get(runId)?.closed ?? true;
  }

  currentSeq(runId: string): number {
    return this.channels.get(runId)?.seq ?? 0;
  }

  /** Events currently buffered in memory after `fromSeq` (exclusive). */
  buffered(runId: string, fromSeq = 0): RunEvent[] {
    return (this.channels.get(runId)?.buffer ?? []).filter((e) => e.seq > fromSeq);
  }

  /**
   * Replays buffered/persisted events after `fromSeq`, then streams live events
   * until the run is closed or the signal aborts.
   */
  subscribe(runId: string, fromSeq = 0, signal?: AbortSignal): AsyncIterable<RunEvent> {
    const bus = this;
    return {
      [Symbol.asyncIterator]() {
        const queue: RunEvent[] = [];
        let done = false;
        let notify: (() => void) | null = null;
        let lastSeq = fromSeq;
        let started = false;
        let unsubscribe: (() => void) | null = null;

        const push = (e: RunEvent) => {
          if (e === END_MARKER) {
            done = true;
          } else if (e.seq > lastSeq) {
            lastSeq = e.seq;
            queue.push(e);
          }
          notify?.();
        };

        const onAbort = () => {
          done = true;
          notify?.();
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        const cleanup = () => {
          unsubscribe?.();
          signal?.removeEventListener('abort', onAbort);
        };

        const start = async () => {
          started = true;
          const channel = bus.channels.get(runId);
          if (channel) {
            // Subscribe before replaying so no live event is missed in between.
            channel.subscribers.add(push);
            unsubscribe = () => channel.subscribers.delete(push);
            for (const e of channel.buffer) if (e.seq > lastSeq) push(e);
            if (channel.closed) done = true;
          } else if (bus.options.loadHistory) {
            for (const e of await bus.options.loadHistory(runId, lastSeq)) push(e);
            done = true;
          } else {
            done = true;
          }
        };

        return {
          async next(): Promise<IteratorResult<RunEvent>> {
            if (!started) await start();
            while (queue.length === 0) {
              if (done || signal?.aborted) {
                cleanup();
                return { value: undefined, done: true };
              }
              await new Promise<void>((resolve) => {
                notify = resolve;
              });
              notify = null;
            }
            return { value: queue.shift()!, done: false };
          },
          async return(): Promise<IteratorResult<RunEvent>> {
            cleanup();
            done = true;
            return { value: undefined, done: true };
          },
        };
      },
    };
  }
}

const END_MARKER = { type: 'log', seq: -1 } as unknown as RunEvent;
