import { describe, expect, it } from 'vitest';
import { heuristicRoute, wantsPlanConfirmation } from './route.js';

describe('heuristicRoute', () => {
  it('defaults to conversation', () => {
    expect(heuristicRoute('你好').route).toBe('chat');
    expect(heuristicRoute('谢谢！').route).toBe('chat');
    expect(heuristicRoute('现在几点？').route).toBe('chat');
    expect(heuristicRoute('计算 (12+30)*2 并说明过程').route).toBe('chat');
    expect(heuristicRoute('把上一条改成表格').route).toBe('chat');
  });

  it('routes multi-step collaboration to workflow', () => {
    expect(heuristicRoute('对比 Zustand、Jotai 与 Redux Toolkit').route).toBe('workflow');
    expect(heuristicRoute('抓取 https://example.com/ 的网页并总结').route).toBe('workflow');
    expect(heuristicRoute('整理一份周报模板').route).toBe('workflow');
    expect(heuristicRoute('调研三个方案并给出选型建议').route).toBe('workflow');
  });

  it('treats “review the plan first” as workflow + confirmPlan', () => {
    const d = heuristicRoute('先列出计划等我确认再执行：整理一份周报模板');
    expect(d.route).toBe('workflow');
    expect(d.confirmPlan).toBe(true);
    expect(wantsPlanConfirmation('确认后再做')).toBe(true);
  });

  it('keeps short follow-ups in conversation even if history mentions a plan', () => {
    expect(heuristicRoute('第三步为什么失败', 'Assistant: [plan] 完成迁移').route).toBe('chat');
  });
});
