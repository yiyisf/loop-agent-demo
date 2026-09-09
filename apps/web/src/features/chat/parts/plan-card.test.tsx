import type { Plan, Step } from '@loop-agent/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlanCard } from './plan-card';

function makeStep(partial: Partial<Step> & Pick<Step, 'id' | 'title' | 'goal'>): Step {
  return {
    dependsOn: [],
    tools: [],
    acceptance: 'ok',
    status: 'pending',
    attempt: 0,
    revisionIntroduced: 1,
    ...partial,
  };
}

function makePlan(steps: Step[]): Plan {
  return {
    runId: 'run_test',
    revision: 1,
    objective: '完成一次超长步骤内容的展示核对',
    steps,
    createdAt: '2026-09-08T00:00:00.000Z',
  };
}

const LONG_GOAL =
  '调研竞品A、竞品B与竞品C的定价、功能清单、目标用户与近三个月更新节奏，并对照我们产品给出差距、优先级与下一季度落地建议。'.repeat(
    2,
  );

describe('PlanCard', () => {
  it('wraps long step details instead of clipping them to a single truncated line', () => {
    const steps = [
      makeStep({
        id: 'research',
        title: '调研竞品并整理差距',
        goal: LONG_GOAL,
        acceptance: '输出一份覆盖定价、功能、用户与更新节奏的对照表，并给出可执行的优先级建议。',
        status: 'succeeded',
        result: {
          status: 'succeeded',
          summary:
            '已完成三家竞品对照：定价分层、核心功能重合度、目标用户重叠与近三个月发布节奏均已写入对照表，并按影响面排出下季度优先级。',
          artifacts: [],
        },
      }),
    ];

    const { container } = render(
      <PlanCard plan={makePlan(steps)} steps={steps} toolCalls={[]} defaultOpen />,
    );

    const goal = screen.getByTestId('plan-step-goal');
    expect(goal).toHaveTextContent(LONG_GOAL);
    expect(goal.className).not.toMatch(/\btruncate\b/);
    expect(goal.className).toMatch(/whitespace-pre-wrap/);
    expect(goal.className).toMatch(/overflow-wrap:anywhere/);

    expect(screen.getByTestId('plan-step-acceptance')).toHaveTextContent('验收：');
    expect(screen.getByTestId('plan-step-result')).toHaveTextContent('已完成三家竞品对照');

    expect(container.querySelector('.truncate')).toBeNull();
  });
});
