import { describe, expect, it } from 'vitest';
import { heuristicRoute } from './route.js';

describe('heuristicRoute', () => {
  it('keeps multi-step tasks on the workflow path', () => {
    expect(heuristicRoute('计算 (12+30)*2 并说明过程')).toBe('workflow');
    expect(heuristicRoute('抓取 https://example.com/ 的网页并总结')).toBe('workflow');
    expect(heuristicRoute('整理一份周报模板')).toBe('workflow');
    expect(heuristicRoute('任务')).toBe('workflow');
  });

  it('routes greetings and short questions to chat', () => {
    expect(heuristicRoute('你好')).toBe('chat');
    expect(heuristicRoute('谢谢！')).toBe('chat');
    expect(heuristicRoute('现在几点？')).toBe('chat');
  });
});
