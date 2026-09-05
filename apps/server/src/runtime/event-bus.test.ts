import type { RunEvent } from '@loop-agent/shared';
import { describe, expect, it } from 'vitest';
import { EventBus } from './event-bus.js';

describe('EventBus', () => {
  it('assigns increasing seq and persists non-transient events only', () => {
    const persisted: RunEvent[] = [];
    const bus = new EventBus({ sink: (e) => void persisted.push(e) });
    bus.open('r1');
    const a = bus.append('r1', { type: 'run.status', status: 'planning' });
    const b = bus.append('r1', { type: 'final.text_delta', delta: 'x' });
    const c = bus.append('r1', { type: 'log', level: 'info', message: 'hi' });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect(persisted.map((e) => e.type)).toEqual(['run.status', 'log']);
    expect(bus.buffered('r1', 1).map((e) => e.seq)).toEqual([2, 3]);
  });

  it('replays buffered events then streams live ones until closed', async () => {
    const bus = new EventBus();
    bus.open('r1');
    bus.append('r1', { type: 'run.status', status: 'planning' });
    bus.append('r1', { type: 'run.status', status: 'executing' });

    const seen: number[] = [];
    const consumer = (async () => {
      for await (const e of bus.subscribe('r1', 1)) seen.push(e.seq);
    })();

    await new Promise((r) => setTimeout(r, 5));
    bus.append('r1', { type: 'run.status', status: 'finalizing' });
    bus.append('r1', { type: 'run.status', status: 'succeeded' });
    bus.close('r1');
    await consumer;
    expect(seen).toEqual([2, 3, 4]);
  });

  it('falls back to loadHistory for unknown runs', async () => {
    const bus = new EventBus({
      loadHistory: async (runId, fromSeq) =>
        [1, 2, 3]
          .filter((s) => s > fromSeq)
          .map(
            (seq) => ({ type: 'log', level: 'info', message: 'x', runId, seq, ts: '' }) as RunEvent,
          ),
    });
    const seen: number[] = [];
    for await (const e of bus.subscribe('old', 1)) seen.push(e.seq);
    expect(seen).toEqual([2, 3]);
  });

  it('stops when the signal aborts', async () => {
    const bus = new EventBus();
    bus.open('r1');
    const ac = new AbortController();
    const consumer = (async () => {
      const out: number[] = [];
      for await (const e of bus.subscribe('r1', 0, ac.signal)) out.push(e.seq);
      return out;
    })();
    await new Promise((r) => setTimeout(r, 5));
    bus.append('r1', { type: 'run.status', status: 'planning' });
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    expect(await consumer).toEqual([1]);
  });
});
