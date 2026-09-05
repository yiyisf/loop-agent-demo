# loop-agent-demo

基础版 loop-agent：Web 页面 + 服务端 Agent Runtime，支持 AI 动态 workflow 规划与执行（TypeScript 全栈）。

- 设计文档：[loop-agent-design.md](./loop-agent-design.md)
- 实施计划：见设计文档 §12，按阶段逐步交付

## 结构

```
apps/server     Hono + Vercel AI SDK 的 Agent Runtime（Node 22）
apps/web        Vite + React 19 + TanStack Router/Query 的 Web 前端
packages/shared 前后端共享的 Zod 契约（Plan / Step / Run / Event / UI data parts）
```

## 快速开始

```bash
pnpm install
cp .env.example .env        # 默认 LLM_PROVIDER=mock，无需 API Key
pnpm dev                    # server: http://localhost:3001  web: http://localhost:5173
```

其他脚本：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。

## 配置

见 `.env.example`。`LLM_PROVIDER` 支持 `openai`、`openai-compatible`、`anthropic`、`mock`；
`mock` 使用脚本化模型，便于离线演示与自动化测试。
