/**
 * Capture core-feature screenshots into docs/screenshots/ for the README gallery.
 * Usage: node scripts/capture-docs-screenshots.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');
const SERVER_PORT = 3101;
const WEB_PORT = 5273;
const baseURL = `http://localhost:${WEB_PORT}`;
const health = `http://127.0.0.1:${SERVER_PORT}/health`;

const children = [];

function stopChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
}

function spawnPkg(name, extraArgs = [], extraEnv = {}) {
  const child = spawn('node', [path.join(root, 'scripts', 'run-pkg.mjs'), name, ...extraArgs], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'pipe',
  });
  children.push(child);
  child.stderr?.on('data', () => undefined);
  return child;
}

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not started';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url} (${last})`);
}

async function shot(page, name) {
  await page.screenshot({
    path: path.join(outDir, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
  console.log(`wrote docs/screenshots/${name}.png`);
}

async function newTask(page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('textbox', { name: '任务输入' }).waitFor({ timeout: 15_000 });
}

async function send(page, text) {
  const composer = page.getByRole('textbox', { name: '任务输入' });
  await composer.fill(text);
  await composer.press('Enter');
}

async function waitUntilIdle(page) {
  await page.getByPlaceholder(/继续说/).waitFor({ timeout: 45_000 });
}

async function ensureWorkbench(page) {
  const artifactsTab = page.getByRole('tab', { name: /产物|计划/ }).first();
  if (!(await artifactsTab.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '切换工作台' }).click();
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });

  spawnPkg('server', [], {
    PORT: String(SERVER_PORT),
    WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
    LLM_PROVIDER: 'mock',
    DATABASE_URL: 'memory',
    DATA_DIR: path.join(root, 'data', 'docs-screenshots'),
    LOG_LEVEL: 'warn',
    MOCK_DELAY_MS: '0',
  });
  await waitFor(health);
  spawnPkg('web', ['--port', String(WEB_PORT), '--strictPort'], {
    VITE_API_URL: `http://127.0.0.1:${SERVER_PORT}`,
  });
  await waitFor(baseURL);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  await page.goto(baseURL);
  await page.getByRole('heading', { name: '写消息，或描述要做的事' }).waitFor();
  await shot(page, '01-home');

  await send(page, '你好');
  await page.getByText('对话模式').waitFor({ timeout: 30_000 });
  await waitUntilIdle(page);
  await shot(page, '02-conversation');

  await newTask(page);
  await send(page, '对比 Zustand、Jotai 与 Redux Toolkit 并给出选型建议');
  await page.getByRole('heading', { name: '结论' }).waitFor({ timeout: 45_000 });
  await waitUntilIdle(page);
  await ensureWorkbench(page);
  const planTab = page.getByRole('tab', { name: /计划/ });
  if (await planTab.isVisible()) await planTab.click();
  await page.getByText('理解任务并拆解要点').first().waitFor();
  await shot(page, '03-workflow');

  await newTask(page);
  await send(page, '抓取 https://example.com/ 的网页并总结');
  await page.getByText('工具审批').waitFor({ timeout: 30_000 });
  await shot(page, '04-hitl-approval');

  await newTask(page);
  await send(page, '先列出计划等我确认再执行：整理一份周报模板');
  await page.getByText('确认计划', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '开始执行' }).scrollIntoViewIfNeeded();
  await shot(page, '05-plan-confirm');

  await newTask(page);
  await send(page, '编写一份 README 并保存到工作区');
  await page.getByTestId('artifact-card').waitFor({ timeout: 45_000 });
  await waitUntilIdle(page);
  await ensureWorkbench(page);
  await page.getByRole('tab', { name: /产物/ }).click();
  await page.getByTestId('artifact-preview').waitFor();
  await shot(page, '06-artifacts');

  await newTask(page);
  await send(page, '给我三个部署环境选项让我选一个');
  await page.getByTestId('ui-choice').waitFor({ timeout: 30_000 });
  await waitUntilIdle(page);
  await shot(page, '07-generative-ui');

  await browser.close();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const child of children) stopChild(child);
  });
