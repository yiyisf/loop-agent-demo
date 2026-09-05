import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { AppConfig } from '../config.js';
import { createMockLanguageModel, type MockScript } from './mock-model.js';

export type ModelRole = 'planner' | 'executor' | 'reflector' | 'finalizer' | 'titler' | 'default';

export interface ModelProvider {
  readonly kind: AppConfig['LLM_PROVIDER'];
  /** Resolve a model for a role; `override` wins when provided. */
  model(role?: ModelRole, override?: string): LanguageModel;
  modelId(role?: ModelRole, override?: string): string;
}

export interface ModelProviderOptions {
  mockScript?: MockScript;
}

export function createModelProvider(
  config: AppConfig,
  options: ModelProviderOptions = {},
): ModelProvider {
  const resolveId = (role: ModelRole = 'default', override?: string): string => {
    if (override) return override;
    if (role === 'planner' && config.LLM_PLANNER_MODEL) return config.LLM_PLANNER_MODEL;
    if (role === 'executor' && config.LLM_EXECUTOR_MODEL) return config.LLM_EXECUTOR_MODEL;
    return config.LLM_MODEL;
  };

  const factory = createFactory(config, options);

  return {
    kind: config.LLM_PROVIDER,
    modelId: resolveId,
    model: (role, override) => factory(resolveId(role, override), role ?? 'default'),
  };
}

function createFactory(
  config: AppConfig,
  options: ModelProviderOptions,
): (modelId: string, role: ModelRole) => LanguageModel {
  switch (config.LLM_PROVIDER) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: requireKey(config), baseURL: config.LLM_BASE_URL });
      return (id) => openai(id);
    }
    case 'openai-compatible': {
      const compat = createOpenAICompatible({
        name: 'openai-compatible',
        apiKey: requireKey(config),
        baseURL: config.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      });
      return (id) => compat(id);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: requireKey(config),
        baseURL: config.LLM_BASE_URL,
      });
      return (id) => anthropic(id);
    }
    case 'mock': {
      return (id, role) =>
        createMockLanguageModel({ modelId: id, role, script: options.mockScript });
    }
  }
}

function requireKey(config: AppConfig): string {
  if (!config.LLM_API_KEY) {
    throw new Error(`LLM_API_KEY is required for provider "${config.LLM_PROVIDER}"`);
  }
  return config.LLM_API_KEY;
}
