import { expect, test } from '@playwright/test';

test.describe('loop-agent smoke', () => {
  test('runs a task end to end and survives a reload', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('计算 (12+30)*2 并说明过程');
    await composer.press('Enter');

    await expect(page).toHaveURL(/\/threads\/thr_/);
    // Exact user bubble — the plan card also contains the task as "完成任务：…".
    await expect(page.getByTestId('user-message')).toHaveText('计算 (12+30)*2 并说明过程');
    // Plan card shows up with the mock plan's steps.
    await expect(page.getByText('理解任务并拆解要点').first()).toBeVisible();

    // Reload mid-run: the run must be re-attached and continue to completion.
    await page.reload();
    await expect(page.getByText('理解任务并拆解要点').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '结论' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('已完成').first()).toBeVisible();

    // Exactly one assistant answer: no duplicates after the reload.
    await expect(page.getByRole('heading', { name: '结论' })).toHaveCount(1);

    // Sidebar lists the thread under today's group with a generated title.
    await expect(page.getByText('今天')).toBeVisible();
    // CI retries reuse the in-memory store, so earlier attempts may leave extra threads.
    await expect(
      page.getByRole('navigation').getByRole('link', { name: /计算/ }).first(),
    ).toBeVisible();

    // Cmd/Ctrl+K jumps back to the new-task page and focuses the composer.
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('textbox', { name: '任务输入' })).toBeFocused();
  });

  test('tool approval pauses the run until the user decides', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('抓取 https://example.com/ 的网页并总结');
    await composer.press('Enter');

    await expect(page.getByText('工具审批')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('有工具调用等待你的审批', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '拒绝' }).click();

    await expect(page.getByText('失败').first()).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: /已处理的交互/ }).click();
    await expect(page.getByText('已拒绝')).toBeVisible();
  });

  test('chat mode replies without a workflow plan', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '对话' }).click();
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('你好');
    await composer.press('Enter');

    await expect(page.getByText('对话模式')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('理解任务并拆解要点')).toHaveCount(0);
  });

  test('expanded plan wraps long step details instead of one truncated line', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '先规划' }).click();
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('整理一份周报模板');
    await composer.press('Enter');

    await expect(page.getByText('确认计划', { exact: true })).toBeVisible({ timeout: 30_000 });
    const longGoal =
      '调研竞品A、竞品B与竞品C的定价、功能清单、目标用户与近三个月更新节奏，并对照我们产品给出差距、优先级与下一季度落地建议。';
    await page.locator('textarea[name$="-goal"]').first().fill(longGoal);
    await page.getByRole('button', { name: '按修改后的计划执行' }).click();

    const detail = page.getByTestId('plan-step-goal').first();
    await expect(detail).toHaveText(longGoal, { timeout: 30_000 });
    const box = await detail.boundingBox();
    expect(box, 'step detail should be visible').toBeTruthy();
    expect(box!.height, 'long step goal should wrap onto more than one line').toBeGreaterThan(28);

    const noPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(noPageOverflow).toBe(true);
  });

  test('plan_first lets the user edit the plan before execution', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '先规划' }).click();
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('整理一份周报模板');
    await composer.press('Enter');

    await expect(page.getByText('确认计划', { exact: true })).toBeVisible({ timeout: 30_000 });
    const titles = page.getByRole('textbox', { name: '步骤标题' });
    await expect(titles).toHaveCount(3);
    await page.getByRole('button', { name: '删除步骤' }).last().click();
    await expect(titles).toHaveCount(2);
    await page.getByRole('button', { name: '按修改后的计划执行' }).click();

    await expect(page.getByRole('button', { name: /计划 v2 已调整/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: '结论' })).toBeVisible({ timeout: 45_000 });
  });

  test('regenerate starts a new run from the previous user message', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /规划方案/ })).toBeVisible();
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('计算 (12+30)*2 并说明过程');
    await composer.press('Enter');
    await expect(page.getByRole('heading', { name: '结论' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('已完成').first()).toBeVisible();

    await page.getByRole('button', { name: '重新生成' }).click();
    await expect(page.getByTestId('user-message')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: '结论' })).toHaveCount(2, { timeout: 45_000 });
    await expect(page.getByRole('button', { name: '重新生成' })).toHaveCount(1);
  });

  test('retry after a denied approval starts a new run', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('抓取 https://example.com/ 的网页并总结');
    await composer.press('Enter');
    await expect(page.getByText('工具审批')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '拒绝' }).click();
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible({ timeout: 45_000 });

    await page.getByRole('button', { name: '重试' }).click();
    await expect(page.getByTestId('user-message')).toHaveCount(2);
    await expect(page.getByText('工具审批')).toBeVisible({ timeout: 30_000 });
  });
});
