import type { RunEvent, RunEventPayload } from '@loop-agent/shared';
import { describe, expect, it } from 'vitest';
import {
  closeAgUiText,
  contentToText,
  createAgUiTranslateState,
  extractAgUiUserText,
  isAgUiHitlPause,
  resolveAgUiResumes,
  runEventToAgUi,
} from './ag-ui.js';

const ts = '2026-01-01T00:00:00.000Z';

function ev(payload: RunEventPayload): RunEvent {
  return { runId: 'run_1', seq: 1, ts, ...payload };
}

describe('runEventToAgUi', () => {
  it('maps text deltas to TEXT_MESSAGE_START then CONTENT', () => {
    const state = createAgUiTranslateState('run_1');
    expect(runEventToAgUi(ev({ type: 'final.text_delta', delta: '你' }), state)).toEqual([
      { type: 'TEXT_MESSAGE_START', messageId: 'msg_run_1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg_run_1', delta: '你' },
    ]);
    expect(runEventToAgUi(ev({ type: 'final.text_delta', delta: '好' }), state)).toEqual([
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg_run_1', delta: '好' },
    ]);
    expect(runEventToAgUi(ev({ type: 'final.done', answer: '你好' }), state)).toEqual([
      { type: 'TEXT_MESSAGE_END', messageId: 'msg_run_1' },
    ]);
  });

  it('emits a full text message from final.done when no deltas arrived', () => {
    const state = createAgUiTranslateState('run_1');
    expect(runEventToAgUi(ev({ type: 'final.done', answer: '整段回答' }), state)).toEqual([
      { type: 'TEXT_MESSAGE_START', messageId: 'msg_run_1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg_run_1', delta: '整段回答' },
      { type: 'TEXT_MESSAGE_END', messageId: 'msg_run_1' },
    ]);
  });

  it('maps tool.call to START / ARGS / END', () => {
    const state = createAgUiTranslateState('run_1');
    expect(
      runEventToAgUi(
        ev({
          type: 'tool.call',
          stepId: 'work',
          toolCallId: 'call_1',
          toolName: 'calculator',
          input: { expr: '1+1' },
        }),
        state,
      ),
    ).toEqual([
      { type: 'TOOL_CALL_START', toolCallId: 'call_1', toolCallName: 'calculator' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'call_1', delta: '{"expr":"1+1"}' },
      { type: 'TOOL_CALL_END', toolCallId: 'call_1' },
    ]);
  });

  it('maps ui.presented to CUSTOM name=ui', () => {
    const state = createAgUiTranslateState('run_1');
    const block = {
      id: 'ui_1',
      widget: { kind: 'metric' as const, items: [{ label: '续费率', value: '40%' }] },
    };
    expect(runEventToAgUi(ev({ type: 'ui.presented', block }), state)).toEqual([
      { type: 'CUSTOM', name: 'ui', value: block },
    ]);
  });

  it('records an approval interrupt and pauses on awaiting_approval', () => {
    const state = createAgUiTranslateState('run_1');
    const mapped = runEventToAgUi(
      ev({
        type: 'approval.requested',
        approvalId: 'apr_1',
        stepId: 'work',
        toolCallId: 'tc_1',
        toolName: 'http_fetch',
        input: { url: 'https://example.com/' },
        reason: '需要确认',
      }),
      state,
    );
    expect(mapped[0]).toMatchObject({ type: 'CUSTOM', name: 'approval' });
    expect(state.pendingInterrupts).toEqual([
      { id: 'apr_1', reason: 'approval', message: '需要确认', toolCallId: 'tc_1' },
    ]);
    expect(isAgUiHitlPause(ev({ type: 'run.status', status: 'awaiting_approval' }), state)).toBe(
      true,
    );
  });

  it('synthesizes a plan_confirmation interrupt on pause', () => {
    const state = createAgUiTranslateState('run_1');
    expect(
      isAgUiHitlPause(ev({ type: 'run.status', status: 'awaiting_plan_confirmation' }), state),
    ).toBe(true);
    expect(state.pendingInterrupts[0]).toMatchObject({
      id: 'plan_confirmation',
      reason: 'plan_confirmation',
    });
  });
});

describe('AG-UI request helpers', () => {
  it('reads user text from a string or text parts', () => {
    expect(extractAgUiUserText([{ role: 'user', content: '  你好  ' }])).toBe('你好');
    expect(
      extractAgUiUserText([
        { role: 'assistant', content: '先忽略' },
        { role: 'user', content: [{ type: 'text', text: '对比 Zustand' }] },
      ]),
    ).toBe('对比 Zustand');
  });

  it('ignores empty content', () => {
    expect(contentToText(null)).toBe('');
    expect(extractAgUiUserText([{ role: 'user', content: '' }])).toBe('');
  });

  it('maps resume[] to the matching waiter key', () => {
    const ops = resolveAgUiResumes(
      {
        messages: [],
        resume: [{ interruptId: 'apr_1', status: 'resolved', payload: { approved: true } }],
      },
      {
        runId: 'run_1',
        status: 'awaiting_approval',
        approvals: [{ id: 'apr_1', toolCallId: 'tc_1', status: 'pending' }],
        questions: [],
        hasWaiter: () => true,
      },
    );
    expect(ops).toEqual([{ key: 'approval:apr_1', value: { approved: true } }]);
  });

  it('closeAgUiText is a no-op after the message ended', () => {
    const state = createAgUiTranslateState('run_1');
    expect(closeAgUiText(state)).toEqual([]);
    state.textStarted = true;
    expect(closeAgUiText(state)).toEqual([{ type: 'TEXT_MESSAGE_END', messageId: 'msg_run_1' }]);
    expect(closeAgUiText(state)).toEqual([]);
  });
});
