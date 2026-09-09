import { describe, expect, it } from 'vitest';
import { uiBlockFromTool } from './ui-blocks.js';

describe('uiBlockFromTool', () => {
  it('accepts a valid present_ui payload', () => {
    const block = uiBlockFromTool('present_ui', {
      id: 'ui_1',
      widget: {
        kind: 'choice',
        prompt: '选一个环境继续',
        options: [{ id: 'prod', label: '生产环境' }],
      },
    });
    expect(block?.widget.kind).toBe('choice');
  });

  it('rejects unknown tools, errors and HTML-like extras', () => {
    expect(
      uiBlockFromTool('calculator', { id: 'x', widget: { kind: 'metric', items: [] } }),
    ).toBeUndefined();
    expect(uiBlockFromTool('present_ui', { error: 'no' })).toBeUndefined();
    expect(
      uiBlockFromTool('present_ui', {
        id: 'ui_1',
        widget: { kind: 'html', html: '<script>alert(1)</script>' },
      }),
    ).toBeUndefined();
  });
});
