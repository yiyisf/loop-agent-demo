import { expect, test } from '@playwright/test';

test.describe('loop-agent smoke', () => {
  test('runs a task end to end and survives a reload', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('计算 (12+30)*2 并说明过程');
    await composer.press('Enter');

    await expect(page).toHaveURL(/\/threads\/thr_/);
    await expect(page.getByText('计算 (12+30)*2 并说明过程')).toBeVisible();
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
    await expect(page.getByRole('link', { name: /计算/ })).toBeVisible();
  });

  test('tool approval pauses the run until the user decides', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('抓取 https://example.com/ 的网页并总结');
    await composer.press('Enter');

    await expect(page.getByText('工具审批')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('有工具调用等待你的审批')).toBeVisible();
    await page.getByRole('button', { name: '拒绝' }).click();

    await expect(page.getByText('失败').first()).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: /已处理的交互/ }).click();
    await expect(page.getByText('已拒绝')).toBeVisible();
  });

  test('plan_first lets the user edit the plan before execution', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('switch', { name: '先确认计划' }).click();
    const composer = page.getByRole('textbox', { name: '任务输入' });
    await composer.fill('整理一份周报模板');
    await composer.press('Enter');

    await expect(page.getByText('确认计划')).toBeVisible({ timeout: 30_000 });
    const titles = page.getByRole('textbox', { name: '步骤标题' });
    await expect(titles).toHaveCount(3);
    await page.getByRole('button', { name: '删除步骤' }).last().click();
    await expect(titles).toHaveCount(2);
    await page.getByRole('button', { name: '按修改后的计划执行' }).click();

    await expect(page.getByRole('button', { name: /计划 v2 已调整/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: '结论' })).toBeVisible({ timeout: 45_000 });
  });
});
