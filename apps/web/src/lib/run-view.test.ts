import type { Plan, Step } from '@loop-agent/shared';
import { describe, expect, it } from 'vitest';
import { deriveRunView } from './run-view';
import type { AgentUIMessage } from './types';

const step = (id: string, status: Step['status']): Step => ({
  id,
  title: id,
  goal: 'g',
  dependsOn: [],
  tools: [],
  acceptance: 'a',
  status,
  attempt: 1,
  revisionIntroduced: 1,
});

const plan: Plan = {
  runId: 'run_1',
  revision: 1,
  objective: 'obj',
  steps: [step('a', 'pending'), step('b', 'pending')],
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('deriveRunView', () => {
  it('returns an empty view for no message', () => {
    const view = deriveRunView(undefined);
    expect(view.steps).toEqual([]);
    expect(view.isTerminal).toBe(false);
  });

  it('collects run/plan/step/tool/usage/text parts in plan order', () => {
    const message: AgentUIMessage = {
      id: 'm1',
      role: 'assistant',
      metadata: { runId: 'run_1' },
      parts: [
        {
          type: 'data-run',
          id: 'run',
          data: {
            runId: 'run_1',
            threadId: 't',
            status: 'succeeded',
            seq: 10,
            startedAt: 's',
            endedAt: 'e',
          },
        },
        { type: 'data-plan', id: 'plan', data: { plan } },
        { type: 'data-step', id: 'step:b', data: step('b', 'succeeded') },
        { type: 'data-step', id: 'step:a', data: step('a', 'succeeded') },
        {
          type: 'data-tool',
          id: 'tool:c1',
          data: { stepId: 'a', toolCallId: 'c1', toolName: 'calculator', input: {}, state: 'done' },
        },
        { type: 'text', text: '## 结论', state: 'done' },
        {
          type: 'data-usage',
          id: 'usage',
          data: { inputTokens: 1, outputTokens: 2, totalTokens: 3, llmCalls: 1, toolCalls: 1 },
        },
      ],
    };
    const view = deriveRunView(message);
    expect(view.runId).toBe('run_1');
    expect(view.status).toBe('succeeded');
    expect(view.isTerminal).toBe(true);
    expect(view.steps.map((s) => `${s.id}:${s.status}`)).toEqual(['a:succeeded', 'b:succeeded']);
    expect(view.toolCalls).toHaveLength(1);
    expect(view.finalText).toBe('## 结论');
    expect(view.usage?.totalTokens).toBe(3);
  });

  it('keeps an empty step list for chat runs without a plan', () => {
    const message: AgentUIMessage = {
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'data-run',
          id: 'run',
          data: {
            runId: 'run_c',
            threadId: 't',
            status: 'succeeded',
            seq: 2,
            mode: 'chat',
          },
        },
        { type: 'text', text: 'hello', state: 'done' },
      ],
    };
    const view = deriveRunView(message);
    expect(view.mode).toBe('chat');
    expect(view.plan).toBeUndefined();
    expect(view.steps).toEqual([]);
    expect(view.finalText).toBe('hello');
    expect(view.citations).toEqual([]);
    expect(view.artifacts).toEqual([]);
  });

  it('collects citations and artifacts', () => {
    const message: AgentUIMessage = {
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'data-citation',
          id: 'cite:1',
          data: {
            id: 'c1',
            title: 'Example Domain',
            url: 'https://example.com/',
            source: 'http_fetch',
            excerpt: 'This domain is for use in documentation.',
          },
        },
        {
          type: 'data-artifact',
          id: 'art:1',
          data: {
            id: 'a1',
            runId: 'run_1',
            stepId: 'work',
            name: 'README.md',
            mime: 'text/markdown',
            size: 12,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
    };
    const view = deriveRunView(message);
    expect(view.citations).toHaveLength(1);
    expect(view.artifacts[0]?.name).toBe('README.md');
  });

  it('falls back to plan steps when no step part arrived yet', () => {
    const message: AgentUIMessage = {
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'data-plan', id: 'plan', data: { plan } }],
    };
    const view = deriveRunView(message);
    expect(view.steps.map((s) => s.status)).toEqual(['pending', 'pending']);
  });
});
