import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import type { ModelRole } from './model-provider.js';

export interface MockCallContext {
  role: ModelRole;
  modelId: string;
  /** Number of previous calls made to this model instance. */
  callIndex: number;
  options: LanguageModelV4CallOptions;
  systemText: string;
  lastUserText: string;
  /** Text of all messages (system/user/assistant/tool results), for cheap heuristics. */
  transcript: string;
  toolNames: string[];
  wantsJson: boolean;
}

export interface MockReply {
  text?: string;
  reasoning?: string;
  json?: unknown;
  toolCalls?: Array<{ toolName: string; input: unknown }>;
  /** Simulated latency per streamed chunk. */
  chunkDelayMs?: number;
}

export type MockScript = (ctx: MockCallContext) => MockReply | Promise<MockReply>;

export interface MockModelOptions {
  modelId: string;
  role: ModelRole;
  script?: MockScript;
}

const usage = (input: number, output: number): LanguageModelV4Usage => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const estimateTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

function extractText(options: LanguageModelV4CallOptions) {
  let systemText = '';
  let lastUserText = '';
  const transcript: string[] = [];
  for (const msg of options.prompt) {
    if (msg.role === 'system') {
      systemText += `${msg.content}\n`;
      transcript.push(msg.content);
      continue;
    }
    for (const part of msg.content) {
      if (part.type === 'text') {
        transcript.push(part.text);
        if (msg.role === 'user') lastUserText = part.text;
      } else if (part.type === 'tool-result') {
        transcript.push(JSON.stringify(part.output));
      } else if (part.type === 'tool-call') {
        transcript.push(`${part.toolName}(${JSON.stringify(part.input)})`);
      }
    }
  }
  return { systemText, lastUserText, transcript: transcript.join('\n') };
}

function buildContent(reply: MockReply, callIndex: number): LanguageModelV4Content[] {
  const content: LanguageModelV4Content[] = [];
  if (reply.reasoning) content.push({ type: 'reasoning', text: reply.reasoning });
  if (reply.json !== undefined) {
    content.push({ type: 'text', text: JSON.stringify(reply.json) });
  } else if (reply.text) {
    content.push({ type: 'text', text: reply.text });
  }
  for (const [i, call] of (reply.toolCalls ?? []).entries()) {
    content.push({
      type: 'tool-call',
      toolCallId: `mock-call-${callIndex}-${i}`,
      toolName: call.toolName,
      input: JSON.stringify(call.input ?? {}),
    });
  }
  return content;
}

function toGenerateResult(
  reply: MockReply,
  options: LanguageModelV4CallOptions,
  callIndex: number,
) {
  const content = buildContent(reply, callIndex);
  const outputText = content
    .map((c) =>
      c.type === 'text' || c.type === 'reasoning' ? c.text : c.type === 'tool-call' ? c.input : '',
    )
    .join('');
  const hasToolCalls = content.some((c) => c.type === 'tool-call');
  const result: LanguageModelV4GenerateResult = {
    content,
    finishReason: { unified: hasToolCalls ? 'tool-calls' : 'stop', raw: undefined },
    usage: usage(estimateTokens(JSON.stringify(options.prompt)), estimateTokens(outputText)),
    warnings: [],
  };
  return result;
}

function toStream(
  result: LanguageModelV4GenerateResult,
  chunkDelayMs: number,
): ReadableStream<LanguageModelV4StreamPart> {
  const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  let idx = 0;
  for (const c of result.content) {
    const id = `mock-part-${idx++}`;
    if (c.type === 'text' || c.type === 'reasoning') {
      const start = c.type === 'text' ? 'text-start' : 'reasoning-start';
      const delta = c.type === 'text' ? 'text-delta' : 'reasoning-delta';
      const end = c.type === 'text' ? 'text-end' : 'reasoning-end';
      parts.push({ type: start, id });
      for (const piece of chunk(c.text)) parts.push({ type: delta, id, delta: piece });
      parts.push({ type: end, id });
    } else if (c.type === 'tool-call') {
      parts.push({ type: 'tool-input-start', id: c.toolCallId, toolName: c.toolName });
      parts.push({ type: 'tool-input-delta', id: c.toolCallId, delta: c.input });
      parts.push({ type: 'tool-input-end', id: c.toolCallId });
      parts.push(c);
    }
  }
  parts.push({ type: 'finish', usage: result.usage, finishReason: result.finishReason });

  return new ReadableStream<LanguageModelV4StreamPart>({
    async start(controller) {
      for (const part of parts) {
        if (chunkDelayMs > 0) await new Promise((r) => setTimeout(r, chunkDelayMs));
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

function* chunk(text: string, size = 12) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

export function createMockLanguageModel(opts: MockModelOptions): MockLanguageModelV4 {
  const script = opts.script ?? defaultMockScript;
  let callIndex = 0;

  const run = async (options: LanguageModelV4CallOptions) => {
    const idx = callIndex++;
    const { systemText, lastUserText, transcript } = extractText(options);
    const ctx: MockCallContext = {
      role: opts.role,
      modelId: opts.modelId,
      callIndex: idx,
      options,
      systemText,
      lastUserText,
      transcript,
      toolNames: (options.tools ?? []).map((t) => t.name),
      wantsJson: options.responseFormat?.type === 'json',
    };
    const reply = await script(ctx);
    return { reply, result: toGenerateResult(reply, options, idx) };
  };

  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: opts.modelId,
    doGenerate: async (options) => (await run(options)).result,
    doStream: async (options) => {
      const { reply, result } = await run(options);
      return { stream: toStream(result, reply.chunkDelayMs ?? 0) };
    },
  });
}

/**
 * Deterministic demo behaviour used when LLM_PROVIDER=mock and no script is supplied.
 * It produces a small plan, drives each step to completion via `finish_step`,
 * always decides to continue, and writes a short final answer.
 */
export const defaultMockScript: MockScript = (ctx) => {
  switch (ctx.role) {
    case 'planner': {
      const task = taskFromPrompt(ctx.lastUserText);
      const wantsFetch = /https?:\/\/|网页|抓取|fetch|url/i.test(task);
      const wantsAsk = /问我|询问|先确认|clarif|ask me/i.test(task);
      const workTools: string[] = [];
      if (/calculator|计算/.test(task)) workTools.push('calculator');
      if (wantsFetch) workTools.push('http_fetch');
      return {
        json: {
          objective: `完成任务：${task.slice(0, 120)}`,
          steps: [
            {
              id: 'understand',
              title: '理解任务并拆解要点',
              goal: '明确任务范围、关键约束与期望产出。',
              dependsOn: [],
              tools: wantsAsk ? ['ask_user'] : [],
              acceptance: '列出任务要点与产出形式。',
            },
            {
              id: 'work',
              title: '执行核心工作',
              goal: '基于要点完成主要工作并给出中间结论。',
              dependsOn: ['understand'],
              tools: workTools,
              acceptance: '得到可验证的中间结果。',
            },
            {
              id: 'verify',
              title: '校验并整理结果',
              goal: '检查结果是否满足验收标准并整理为可交付形式。',
              dependsOn: ['work'],
              tools: [],
              acceptance: '结果经过校验且格式清晰。',
            },
          ],
          rationale: '演示用 mock 计划：三步串行。',
        },
        chunkDelayMs: 10,
      };
    }
    case 'executor': {
      // A denial (tool output or a note from a previous attempt) ends the step as failed.
      if (/"denied":true|User denied tool/.test(ctx.transcript)) {
        return {
          text: '用户拒绝了该工具调用，无法继续此步骤。',
          toolCalls: [
            {
              toolName: 'finish_step',
              input: {
                status: 'failed',
                summary: '（mock）用户拒绝了所需的工具调用，步骤无法完成。',
                artifacts: [],
              },
            },
          ],
          chunkDelayMs: 15,
        };
      }
      if (ctx.callIndex === 0 && ctx.toolNames.includes('ask_user')) {
        return {
          reasoning: '任务存在歧义，先向用户确认偏好。',
          toolCalls: [
            {
              toolName: 'ask_user',
              input: {
                question: '你希望结果偏向哪种风格？',
                options: ['简洁摘要', '详细报告'],
              },
            },
          ],
          chunkDelayMs: 15,
        };
      }
      if (ctx.callIndex === 0 && ctx.toolNames.includes('http_fetch')) {
        return {
          reasoning: '需要抓取网页内容作为依据。',
          toolCalls: [{ toolName: 'http_fetch', input: { url: 'https://example.com/' } }],
          chunkDelayMs: 15,
        };
      }
      if (ctx.callIndex === 0 && ctx.toolNames.includes('calculator')) {
        return {
          reasoning: '需要先做一个简单计算来验证工具可用。',
          toolCalls: [{ toolName: 'calculator', input: { expression: '(12 + 30) * 2' } }],
          chunkDelayMs: 15,
        };
      }
      return {
        text: '步骤已完成，正在提交结果。',
        toolCalls: [
          {
            toolName: 'finish_step',
            input: {
              status: 'succeeded',
              summary: `（mock）已完成该步骤：${summarizeGoal(ctx.systemText)}`,
              artifacts: [],
            },
          },
        ],
        chunkDelayMs: 15,
      };
    }
    case 'reflector':
      return { json: { action: 'continue', note: 'mock: 继续执行' } };
    case 'titler': {
      const task =
        /用户任务：\n([\s\S]*?)(?:\n\n|$)/.exec(ctx.lastUserText)?.[1] ?? ctx.lastUserText;
      return { text: shortTitle(task) };
    }
    default:
      return {
        text: [
          '## 结论',
          '',
          '这是 **mock 模型** 生成的最终回答，用于在没有真实 LLM 的情况下演示完整流程。',
          '',
          '## 依据',
          '',
          '- 计划已按步骤执行完毕',
          '- 各步骤均报告成功',
          '',
          '## 说明',
          '',
          '配置 `LLM_PROVIDER` 与 `LLM_API_KEY` 后即可使用真实模型。',
        ].join('\n'),
        chunkDelayMs: 20,
      };
  }
};

/** First 12 characters of the task, without cutting a Latin word in half. */
function shortTitle(task: string): string {
  const text = task.trim().replace(/\s+/g, ' ');
  if (text.length <= 12) return text || '新会话';
  let cut = text.slice(0, 12);
  if (/[A-Za-z0-9]$/.test(cut) && /^[A-Za-z0-9]/.test(text[12] ?? '')) {
    cut = cut.replace(/[A-Za-z0-9]+$/, '');
  }
  return cut.trim() || text.slice(0, 12);
}

function taskFromPrompt(prompt: string): string {
  const m = /Task:\n([\s\S]*?)(?:\n\n|$)/.exec(prompt);
  return (m?.[1] ?? prompt).trim();
}

function summarizeGoal(systemText: string): string {
  const m = systemText.match(/目标[:：]\s*(.+)/) ?? systemText.match(/Goal[:：]\s*(.+)/i);
  return (m?.[1] ?? '').trim().slice(0, 80) || '目标已达成';
}
