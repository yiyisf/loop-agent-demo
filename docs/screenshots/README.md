# 界面截图

本目录存放 README「界面预览」用的核心功能截图，由 `pnpm screenshots`（`scripts/capture-docs-screenshots.mjs`）在 mock 模型下自动拍摄。

| 文件 | 场景 |
| --- | --- |
| `01-home.png` | 首页：无模式入口、建议任务 |
| `02-conversation.png` | 普通对话，不生成工作流计划 |
| `03-workflow.png` | 计划卡片 + 工作台 DAG |
| `04-hitl-approval.png` | 高风险工具审批 |
| `05-plan-confirm.png` | 执行前确认 / 编辑计划 |
| `06-artifacts.png` | 主会话产物卡 + 工作台 Markdown 预览 |
| `07-generative-ui.png` | `present_ui` 选择卡片 |

重拍要求：已安装依赖与 Playwright Chromium（`pnpm exec playwright install chromium`）。脚本会临时拉起 API `:3101` 与 Vite `:5273`，拍完退出。
