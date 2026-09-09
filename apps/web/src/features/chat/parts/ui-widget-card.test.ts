import { describe, expect, it } from 'vitest';
import { formatUiSelection } from './ui-widget-card';

describe('formatUiSelection', () => {
  it('formats a choice', () => {
    expect(
      formatUiSelection(
        {
          kind: 'choice',
          prompt: '选一个',
          options: [
            { id: 'prod', label: '生产环境' },
            { id: 'dev', label: '开发环境' },
          ],
        },
        { ids: 'prod' },
      ),
    ).toBe('我选择：生产环境');
  });

  it('formats a table row and a metric', () => {
    expect(
      formatUiSelection(
        { kind: 'table', columns: ['项', '值'], rows: [['访问', '1200']] },
        { row: '0' },
      ),
    ).toBe('查看行：项=访问，值=1200');
    expect(
      formatUiSelection(
        { kind: 'metric', items: [{ label: '转化', value: '3.1%' }] },
        { label: '转化' },
      ),
    ).toBe('查看指标：转化 3.1%');
  });

  it('formats a form', () => {
    expect(
      formatUiSelection(
        {
          kind: 'form',
          title: '周报',
          fields: [{ name: 'done', label: '本周完成', type: 'text' }],
        },
        { done: '写完预览' },
      ),
    ).toBe('表单「周报」：\n本周完成：写完预览');
  });
});
