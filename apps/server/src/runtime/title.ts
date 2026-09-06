import { generateText } from 'ai';
import type { Logger } from '../lib/logger.js';
import type { ModelProvider } from '../providers/model-provider.js';

export const MAX_TITLE_LENGTH = 40;

/** Deterministic fallback used before/without the model: first line of the input. */
export function fallbackTitle(input: string): string {
  const firstLine = input.split('\n').find((l) => l.trim().length > 0) ?? input;
  return firstLine.trim().slice(0, MAX_TITLE_LENGTH) || '新会话';
}

function sanitizeTitle(raw: string): string {
  return raw
    .split('\n')[0]!
    .replace(/^["'“”‘’`#*\-\s]+|["'“”‘’`*\s]+$/g, '')
    .replace(/[。．.!！?？]+$/, '')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}

export interface GenerateTitleInput {
  input: string;
  answer?: string;
  model?: string;
}

/** Asks the model for a short (6–12 character) thread title; never throws. */
export async function generateThreadTitle(
  models: ModelProvider,
  logger: Logger,
  { input, answer, model }: GenerateTitleInput,
): Promise<string> {
  try {
    const result = await generateText({
      model: models.model('titler', model),
      system:
        '你是会话标题生成器。根据用户任务与回答，用与用户相同的语言生成一个 6–12 个字（英文则 3–6 个词）的简洁标题。' +
        '只输出标题本身，不要标点、引号、序号或解释。',
      prompt: `用户任务：\n${input.slice(0, 1500)}\n\n${answer ? `回答摘要：\n${answer.slice(0, 800)}` : ''}`,
      maxOutputTokens: 40,
      temperature: 0.3,
    });
    const title = sanitizeTitle(result.text);
    return title || fallbackTitle(input);
  } catch (err) {
    logger.warn({ err }, 'title generation failed; using fallback');
    return fallbackTitle(input);
  }
}
