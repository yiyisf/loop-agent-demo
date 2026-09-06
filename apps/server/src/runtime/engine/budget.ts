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

  /**
   * Throws when the accumulated token usage exceeds the budget. The time budget
   * is enforced by the RunManager's abort timer (→ cancelled), not here, so a
   * run has exactly one terminal state per limit.
   */
  assertWithinLimits(run: Run): void {
    if (run.usage.totalTokens > this.budget.maxTotalTokens) {
      throw new BudgetExceededError(
        `Token budget exceeded (${run.usage.totalTokens} > ${this.budget.maxTotalTokens})`,
      );
    }
  }

  canReplan(): boolean {
    return this.replans < this.budget.maxReplans;
  }

  /** Throws when the reflector asks for a replan after the budget is used up. */
  assertReplanAvailable(reason: string): void {
    if (!this.canReplan()) {
      throw new BudgetExceededError(
        `Replan budget exhausted (maxReplans=${this.budget.maxReplans}); requested because: ${reason}`,
      );
    }
  }

  noteReplan(): void {
    this.replans += 1;
  }
}
