import { PlanDraftSchema, ReflectionDecisionSchema } from '@loop-agent/shared';
import { describe, expect, it } from 'vitest';
import { createMockLanguageModel } from '../providers/mock-model.js';
import {
  extractJsonValue,
  generateStructured,
  PLAN_DRAFT_CONTRACT,
  REFLECTION_DECISION_CONTRACT,
} from './structured.js';

describe('extractJsonValue', () => {
  it('parses a bare object', () => {
    expect(extractJsonValue('{"action":"continue"}')).toEqual({
      ok: true,
      value: { action: 'continue' },
    });
  });

  it('strips markdown fences and leading commentary', () => {
    const text = 'Here you go:\n```json\n{"objective":"x","steps":[]}\n```\n';
    expect(extractJsonValue(text)).toEqual({
      ok: true,
      value: { objective: 'x', steps: [] },
    });
  });

  it('rejects empty or non-json text', () => {
    expect(extractJsonValue('   ').ok).toBe(false);
    expect(extractJsonValue('sorry I cannot').ok).toBe(false);
  });
});

describe('generateStructured', () => {
  it('validates planner JSON from generateText (no response_format)', async () => {
    const model = createMockLanguageModel({
      modelId: 'mock',
      role: 'planner',
      script: () => ({
        text: '```json\n{"objective":"demo","steps":[{"id":"a","title":"A","goal":"g","dependsOn":[],"tools":[],"acceptance":"ok"}]}\n```',
      }),
    });
    const result = await generateStructured({
      model,
      schema: PlanDraftSchema,
      system: 'planner',
      prompt: 'Task',
      contract: PLAN_DRAFT_CONTRACT,
      schemaName: 'PlanDraft',
    });
    expect(result.object.objective).toBe('demo');
    expect(result.object.steps).toHaveLength(1);
  });

  it('repairs an invalid first reply then accepts the second', async () => {
    let calls = 0;
    const model = createMockLanguageModel({
      modelId: 'mock',
      role: 'reflector',
      script: () => {
        calls += 1;
        if (calls === 1) return { text: 'not json at all' };
        return { json: { action: 'continue', note: 'fixed' } };
      },
    });
    const result = await generateStructured({
      model,
      schema: ReflectionDecisionSchema,
      system: 'reflector',
      prompt: 'step done',
      contract: REFLECTION_DECISION_CONTRACT,
      schemaName: 'ReflectionDecision',
    });
    expect(calls).toBe(2);
    expect(result.object).toEqual({ action: 'continue', note: 'fixed' });
  });

  it('throws after the last failed attempt', async () => {
    const model = createMockLanguageModel({
      modelId: 'mock',
      role: 'planner',
      script: () => ({ text: '{"objective":"x","steps":[]}' }),
    });
    await expect(
      generateStructured({
        model,
        schema: PlanDraftSchema,
        system: 'planner',
        prompt: 'Task',
        contract: PLAN_DRAFT_CONTRACT,
        schemaName: 'PlanDraft',
        attempts: 2,
      }),
    ).rejects.toThrow(/did not match PlanDraft/);
  });
});
