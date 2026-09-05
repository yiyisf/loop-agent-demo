import type { Budget, Run } from '@loop-agent/shared';
import { BudgetExceededError } from './context.js';

export class BudgetGuard {
  private readonly startedAt = Date.now();
  replans = 0;

  constructor(readonly budget: Budget) {}

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  remainingMs(): number {
    return Math.max(0, this.budget.maxDurationMs - this.elapsedMs());
  }

  /** Throws when the accumulated usage or elapsed time exceeds the budget. */
  assertWithinLimits(run: Run): void {
    if (run.usage.totalTokens > this.budget.maxTotalTokens) {
      throw new BudgetExceededError(
        `Token budget exceeded (${run.usage.totalTokens} > ${this.budget.maxTotalTokens})`,
      );
    }
    if (this.elapsedMs() > this.budget.maxDurationMs) {
      throw new BudgetExceededError(
        `Time budget exceeded (${Math.round(this.elapsedMs() / 1000)}s)`,
      );
    }
  }

  canReplan(): boolean {
    return this.replans < this.budget.maxReplans;
  }

  noteReplan(): void {
    this.replans += 1;
  }
}
