import type { ToolSet } from 'ai';
import type { AppConfig } from '../../config.js';
import type { ToolDefinition, ToolInfo, ToolRuntime } from './types.js';

export class ToolRegistry {
  private defs = new Map<string, ToolDefinition>();

  constructor(private readonly config: AppConfig) {}

  register(def: ToolDefinition): this {
    if (this.defs.has(def.name)) throw new Error(`Tool "${def.name}" already registered`);
    this.defs.set(def.name, def);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.defs.get(name);
  }

  isEnabled(name: string): boolean {
    const def = this.defs.get(name);
    return !!def && !def.disabledReason?.(this.config);
  }

  list(): ToolInfo[] {
    return [...this.defs.values()].map((d) => {
      const reason = d.disabledReason?.(this.config);
      return {
        name: d.name,
        description: d.description,
        risk: d.risk,
        category: d.category,
        enabled: !reason,
        disabledReason: reason,
      };
    });
  }

  /** Names the planner may assign to steps. */
  plannableNames(): Set<string> {
    return new Set(
      [...this.defs.values()]
        .filter((d) => d.plannable && this.isEnabled(d.name))
        .map((d) => d.name),
    );
  }

  /** Markdown list describing plannable tools for prompts. */
  describeForPlanner(): string {
    const lines = [...this.defs.values()]
      .filter((d) => d.plannable && this.isEnabled(d.name))
      .map((d) => `- \`${d.name}\` (risk: ${d.risk}): ${d.description}`);
    return lines.length ? lines.join('\n') : '- (no tools available)';
  }

  /** Instantiate the given tools (unknown or disabled names are skipped). */
  pick(names: readonly string[], rt: ToolRuntime): ToolSet {
    const set: ToolSet = {};
    for (const name of new Set(names)) {
      const def = this.defs.get(name);
      if (!def || !this.isEnabled(name)) continue;
      set[name] = def.create(rt);
    }
    return set;
  }
}
