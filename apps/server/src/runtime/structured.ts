import type { LanguageModel, LanguageModelUsage } from 'ai';
import { generateText } from 'ai';
import type { z } from 'zod';

/**
 * Lite LLM gateways (and many OpenAI-compatible proxies) reject native
 * structured output: `response_format.json_schema`, Anthropic's json tool,
 * and OpenAI Responses API `/v1/responses`. `generateObject` always sends one
 * of those. We instead ask for plain JSON text and validate locally.
 */

export type StructuredTelemetry = {
  isEnabled?: boolean;
  functionId?: string;
};

export interface GenerateStructuredOptions<S extends z.ZodType> {
  model: LanguageModel;
  schema: S;
  system: string;
  prompt: string;
  /** Human-readable JSON example / field list placed in the system prompt. */
  contract: string;
  schemaName: string;
  abortSignal?: AbortSignal;
  telemetry?: StructuredTelemetry;
  /** Parse + validate attempts (default 2: initial + one repair). */
  attempts?: number;
}

export function extractJsonValue(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'model returned empty text' };

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  const attempts = [candidate];
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(candidate.slice(start, end + 1));
  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    attempts.push(candidate.slice(arrayStart, arrayEnd + 1));
  }

  let lastErr = 'no JSON object in model text';
  for (const chunk of attempts) {
    try {
      return { ok: true, value: JSON.parse(chunk) };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastErr };
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}

function jsonSystemPrompt(system: string, contract: string): string {
  return `${system}

Respond with a single JSON value only. Do not wrap it in markdown fences. Do not add commentary before or after the JSON.

${contract}`;
}

export async function generateStructured<S extends z.ZodType>(
  options: GenerateStructuredOptions<S>,
): Promise<{ object: z.infer<S>; usage: LanguageModelUsage }> {
  const attempts = options.attempts ?? 2;
  let lastError = '';

  for (let i = 0; i < attempts; i++) {
    const repair =
      lastError.length > 0
        ? `\n\nYour previous reply was not valid ${options.schemaName} JSON:\n${lastError}\nReturn a corrected JSON value only.`
        : '';
    const result = await generateText({
      model: options.model,
      system: jsonSystemPrompt(options.system, options.contract),
      prompt: `${options.prompt}${repair}`,
      abortSignal: options.abortSignal,
      telemetry: options.telemetry,
    });

    const extracted = extractJsonValue(result.text);
    if (!extracted.ok) {
      lastError = extracted.error;
      continue;
    }
    const parsed = options.schema.safeParse(extracted.value);
    if (!parsed.success) {
      lastError = formatZodIssues(parsed.error);
      continue;
    }
    return { object: parsed.data, usage: result.usage };
  }

  throw new Error(
    `Model response did not match ${options.schemaName}: ${lastError || 'unknown parse error'}`,
  );
}

export const PLAN_DRAFT_CONTRACT = `Required shape:
{
  "objective": "one or two sentences restating the task",
  "steps": [
    {
      "id": "kebab-case",
      "title": "short title",
      "goal": "what this step must accomplish",
      "dependsOn": [],
      "tools": [],
      "acceptance": "how to verify success"
    }
  ],
  "rationale": "optional"
}
Rules: 1–12 steps; each id matches ^[a-z0-9][a-z0-9_-]{0,31}$; tools must be from the available list or empty.`;

export const REFLECTION_DECISION_CONTRACT = `Required shape — exactly one of:
{ "action": "continue", "note": "optional" }
{ "action": "replan", "reason": "...", "patch": [ { "op": "add"|"update"|"remove", ... } ] }
{ "action": "ask_user", "question": "...", "options": ["optional"] }
{ "action": "finish_early", "reason": "..." }
Patch ops: add { "op":"add", "step": <step draft>, "after"?: "<id>" }; update { "op":"update", "stepId":"<id>", "changes": { ... } }; remove { "op":"remove", "stepId":"<id>" }.`;
