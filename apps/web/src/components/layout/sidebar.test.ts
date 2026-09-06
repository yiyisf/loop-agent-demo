import { describe, expect, it } from 'vitest';
import type { ThreadListItem } from '@/lib/types';
import { groupThreads } from './sidebar';

const thread = (id: string, updatedAt: string): ThreadListItem => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  activeRunId: null,
});

describe('groupThreads', () => {
  it('buckets threads by relative day and preserves the incoming order', () => {
    const now = new Date('2026-09-05T15:00:00');
    const groups = groupThreads(
      [
        thread('a', '2026-09-05T09:00:00'),
        thread('b', '2026-09-04T23:30:00'),
        thread('c', '2026-09-01T10:00:00'),
        thread('d', '2026-08-20T10:00:00'),
        thread('e', '2026-09-05T00:00:01'),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.threads.map((t) => t.id)])).toEqual([
      ['今天', ['a', 'e']],
      ['昨天', ['b']],
      ['近 7 天', ['c']],
      ['更早', ['d']],
    ]);
  });

  it('omits empty groups', () => {
    const now = new Date('2026-09-05T15:00:00');
    const groups = groupThreads([thread('x', '2026-01-01T00:00:00')], now);
    expect(groups.map((g) => g.key)).toEqual(['older']);
  });
});
