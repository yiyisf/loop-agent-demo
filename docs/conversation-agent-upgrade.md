# loop-agent 对话能力升级方案（待评审）

> 状态：方案稿，**未实施**。请先审核目标、边界与分阶段范围后再开工。  
> 基线：当前 `main`（已含对话 / 自动 / 先规划三种 Run 模式）。

---

## 1. 为什么要升

产品定位应是「能对话的 Agent，必要时再规划执行」，而不是「只能生成和跑动态工作流的演示」。

主流 Agent（ChatGPT / Claude / Cursor / CopilotKit 类产品）的共同能力是：

- 多轮人机对话是默认入口
- 回复不限形态：纯文本、Markdown、代码、表格、结构化 UI
- 对话中按需用工具，不必先出 DAG
- 同一会话里可以闲聊、问答、再升级成工作流，再回到对话
- 前端能渲染协议化事件（本仓库已有 AI SDK UI Message Stream；业界对应层是 AG-UI）

当前仓库的工作流循环（Planner → Executor → Reflector → Finalizer）已经可用。缺的是把**对话**做成一等公民，而不是工作流引擎上的早退旁路。

---

## 2. 现状诊断（对照代码）

| 能力 | 现状 | 缺口 |
| --- | --- | --- |
| 对话入口 | `RunMode = chat / auto / plan_first`；`auto` 走启发式/模型路由 | `auto` 偏工作流；对话仍是 `LoopEngine` 里 `runChatTurn` 后 `return` |
| 单轮对话 | `chat-turn.ts`：一次 `ToolLoopAgent`，文本走 `final.text_delta` | 无推理流、无结构化回复部件、空回复即失败 |
| 多轮记忆 | `buildHistory()` 把历史压成最多 4000 字纯文本 | 丢失工具、计划、产物、问答；跟进质量差 |
| 输入 | Composer 只收 `string`；服务端 `extractUserText` 只取 text part | 无附件、图片、粘贴文件、多 part 用户消息 |
| 输出 | 最终答案用 Streamdown 渲染 Markdown | 无独立「对话气泡」语义；无引用、无生成式 UI、无画布 |
| 协议 | 自研 Event → AI SDK `data-*` parts | 不是 AG-UI；外部前端/CopilotKit 无法直接接入 |
| 工具 | calculator / fetch / search / workspace / ask_user / 审批 | 对话与工作流共用；无 MCP、无前端工具 |
| 工作流 | 完整 DAG、重规划、HITL、可恢复展示 | 保留为高级能力，不应再当唯一路径 |
| 工作台 | 为步骤/DAG 设计 | 纯对话时信息空，缺少「对话过程 / 引用 / 产物」 |

结论：不是「完全没有对话」，而是**对话被做成了工作流的特例**，所以体验和实用性仍像工作流产品。

---

## 3. 目标与非目标

### 3.1 目标

1. **对话优先**：同一 Thread 里，默认按人机对话处理；只有任务确实需要多步协同时才生成 Plan。
2. **多形态回复**：同一条助手消息可同时包含文本、Markdown、工具卡、计划卡、生成式 UI、产物引用。
3. **对话 ↔ 工作流可切换**：用户可在对话中说「拆成步骤执行」升级为工作流；工作流结束后继续用对话追问，不必新开会话。
4. **协议可扩展**：内部仍以 Event + UI Message 为事实来源；对外增加 AG-UI 适配，不推翻现有 Web。
5. **保持现有工作流质量**：plan_first、审批、重规划、断线重连、mock e2e 不回退。

### 3.2 非目标（本轮不承诺）

- 语音、实时音视频
- 多租户 / 登录鉴权
- 跨会话长期记忆（向量库）
- 进程崩溃后从步骤断点继续执行（仍是设计稿阶段 8）
- 用 CopilotKit 整页替换现有 UI
- A2A 多 Agent 联邦

---

## 4. 建议的产品模型

```
Thread（会话，长期存在）
  └─ Turn（一次用户输入 → 一次助手回复）
        ├─ Conversation（默认）：文本 / Markdown / 工具 / UI 部件
        └─ Workflow（按需）：Plan DAG → 逐步执行 → 最终回答
              结束后仍落回同一 Thread，下一条可以继续 Conversation
```

三种用户意图（对应现有模式，语义要改清楚）：

| 模式 | 新语义 | 默认是否建议保留 |
| --- | --- | --- |
| **对话** `chat` | 绝不自动出 Plan；可工具、可 Markdown/UI | 是，且作为默认 |
| **自动** `auto` | 对话优先；仅当任务明显多步时升级工作流 | 是 |
| **先规划** `plan_first` | 强制工作流 + 确认计划 | 是，作为高级 |

**建议拍板 A**：Composer 默认模式从「自动」改为「对话」。`auto` 的启发式从「偏工作流」改为「偏对话」（问候、解释、改写、单问、看结果 → chat；对比/调研/迁移/批量 → workflow）。

---

## 5. 架构怎么改（不推翻 Runtime）

保持 Event 为唯一事实来源（ADR D3）。新增一层「对话运行时」，工作流变成它可调用的能力，而不是外层唯一循环。

```
POST /threads/:id/messages
        │
        ▼
  ConversationEngine          ← 新增，默认路径
        │  stream: text / markdown / ui / tool / question
        │
        ├─ tools（与现网同一 ToolRegistry）
        ├─ 可选：handoff → LoopEngine（现有规划执行）
        └─ emit RunEvent（扩类型，不另起一套状态）
                │
                ├─ 现有 UI Message Stream（本仓库 Web 继续用）
                └─ AG-UI Adapter（给外部客户端 / 后续 CopilotKit）
```

关键改动点（实施时才动代码）：

| 层 | 做什么 |
| --- | --- |
| `packages/shared` | 用户/助手消息 parts 扩展：`file`、`ui`、`citation`、`artifact-ref`；RunEvent 增加对话态（如 `message.ui`） |
| `chat-turn.ts` → `conversation-engine.ts` | 支持 reasoning 流、多 part 输出、工具后继续说话、空回复重试；可 `handoff: workflow` |
| `buildHistory` | 结构化最近 N 轮（用户原文、助手摘要、工具名、计划目标），而不是 4000 字切片 |
| `ui-stream.ts` | 对话回复不再全部塞进 `final` 一个 text 块；普通对话用标准 text stream + 可选 `data-ui` |
| Web | 消息按 part 分派渲染：Markdown / UI 部件 / 引用 / 附件；工作台增加「对话」页（引用、产物、工具时间线） |
| API | 现有 `/messages` 保持；另增 `POST /api/ag-ui`（或 `/api/runs/:id/ag-ui`）做协议适配 |

**建议拍板 B（AG-UI 策略）**：

- **推荐**：现有 Web **不重写**为 CopilotKit。先在内部增加可映射的 part/事件，再做 **AG-UI SSE 适配器**，让外部客户端能连。
- **不推荐**：第一期用 AG-UI 替换 AI SDK `useChat`。风险大，现有计划卡/审批/重连都要重做。

「支持 AG-UI」在本方案里的含义是：

1. 助手可以发出**生成式 UI 部件**（表格、选项、指标卡、表单）——用户体感上的 ag-ui。
2. 运行时事件能被翻译成 AG-UI 标准事件（`TEXT_MESSAGE_*`、`TOOL_CALL_*`、`STATE_SNAPSHOT`、`CUSTOM`）。
3. 本仓库 Web 继续走 AI SDK UI Message Stream。

---

## 6. 分阶段实施（审核后按阶段开工）

### 阶段 C1 — 对话成为默认主路径（优先）

**用户能感知到的变化**

- 打开页面就是对话：直接问答、解释、改写、总结，不必先出三步计划。
- Markdown（标题、列表、代码、表格）在对话气泡里流式出现，而不是「工作流结论」外壳。
- 同一会话追问能引用上一轮内容（历史不再几乎丢失）。
- 工作流仍然可用：切「先规划」或说「按步骤做」才会出 Plan。

**技术范围**

- 默认模式改为 `chat`；`auto` 路由改对话优先。
- 升级 `runChatTurn`：reasoning、工具后继续输出、失败可说人话。
- `buildHistory` 改为结构化最近轮次（建议 8–12 轮 + 摘要）。
- 助手消息渲染：无 Plan 时走对话气泡，不显示「规划中」空壳。
- 工作台空态改为对话说明（工具、引用），而不是空白 DAG。
- mock / e2e：长对话、追问、Markdown 表格；原工作流 e2e 保持。

**验收**

- 「你好 / 解释这段 / 把上一条改成表格」不出 Plan。
- 「调研三个方案并对比」在 `auto` 仍可出 Plan。
- 刷新后追问仍知道上文。

### 阶段 C2 — 多形态内容（文本 / Markdown / 引用 / 附件）

**用户能感知到的变化**

- 可上传或粘贴文件（先做文本、Markdown、JSON、小 PDF 抽文本；图片做可选）。
- 工具抓取/检索的结果在回复旁出引用条，可点开原文摘要。
- 工作区产物在主会话以卡片出现，不只在工作台。

**技术范围**

- 用户消息 parts：`text | file`；存储与大小上限。
- 工具输出规范化为 `citation` / `artifact-ref`。
- Composer：附件按钮、拖拽、粘贴。
- 对话模型能读附件摘要（超长则切片 + workspace）。

**验收**

- 上传一份 `.md` 问「总结要点」能基于文件回答。
- fetch/search 后回复带可点击来源。

### 阶段 C3 — 生成式 UI（AG-UI 体感）

**用户能感知到的变化**

- 助手除 Markdown 外可推一块可交互 UI：对比表、单选/多选、指标卡、确认表单。
- 用户在卡片上点选后，作为下一条输入继续对话（不必纯打字）。

**技术范围**

- 新增 `data-ui` part：受控组件清单（先 4 种：`table`、`choice`、`metric`、`form`）。
- 模型用工具 `present_ui` 或结构化 JSON 产出，Zod 校验，禁止任意 HTML。
- 前端注册表渲染；未知类型回退 JSON。

**验收**

- 「用表格对比这三项」出现可滚动表格部件，而不是只有 Markdown。
- 选择「方案 B」后下一轮能读到该选择。

### 阶段 C4 — AG-UI 协议适配（互操作）

**用户 / 集成方能感知到的变化**

- 外部 AG-UI 客户端（CopilotKit `HttpAgent`、自研）可连本 Runtime。
- 本仓库 Web 行为不变。

**技术范围**

- `POST /api/ag-ui`：`RunAgentInput` → 启动/续 Run → SSE 输出 AG-UI 事件。
- Event ↔ AG-UI 映射表（见 §7）。
- 契约测试：一轮对话 + 一次工具 + 一次工作流，事件序列符合 spec。

**验收**

- 用官方/最小 AG-UI client 跑通：流式文本、工具、结束。
- 现有 Playwright 全绿。

### 阶段 C5 — 可选增强（单独评审）

- MCP 外部工具
- 前端工具（浏览器内执行、读当前页）
- 子 Agent（对话里委派一个调研 Agent）
- 会话级记忆摘要（超出 12 轮）

---

## 7. 事件与协议映射（C4 预览）

| 本仓库 Event / chunk | AG-UI 事件 |
| --- | --- |
| `run.status` queued/executing | `RUN_STARTED` |
| `final.text_delta` / text-delta | `TEXT_MESSAGE_START` + `TEXT_MESSAGE_CONTENT` |
| `tool.call` / `tool.result` | `TOOL_CALL_START` / `ARGS` / `END` + `TOOL_CALL_RESULT` |
| `approval.requested` | HITL / `TOOL_CALL` + 等待 |
| `user_question.asked` | 自定义或 HITL |
| `plan.created` / `step.status` | `STATE_SNAPSHOT` 或 `CUSTOM`（plan/step） |
| `data-ui` | `CUSTOM`（`ui`）或 Activity |
| 终态 | `RUN_FINISHED` / `RUN_ERROR` |

本仓库 Web **继续**消费 AI SDK UI Message Stream，避免双协议渲染。

---

## 8. 风险

| 风险 | 缓解 |
| --- | --- |
| 对话默认后，旧 e2e「一输入就出计划」失败 | 那些用例显式点「先规划」或构造强工作流提示；更新 `auto` 单测 |
| 历史变结构化后 token 涨 | 轮次上限 + 摘要 + 工具只留名称与短结果 |
| 生成式 UI 被模型乱输出 HTML | 只允许白名单 schema，原始 HTML 一律拒绝 |
| AG-UI 与 AI SDK 两套流不一致 | 只从 Event 投影，禁止两处各写各的 |
| 附件带来安全面 | 类型白名单、大小上限、不执行上传文件、工作区隔离沿用现网 |

---

## 9. 请审核的决策

请直接回复选项，通过后按阶段开工（默认先做 C1）。

1. **默认入口**：A. Composer 默认「对话」；B. 保持「自动」，但改成对话优先路由。
2. **AG-UI**：A. C3 先做生成式 UI，C4 再做协议适配（推荐）；B. C1 之后立刻上 AG-UI 适配；C. 只做体感 UI，不做对外协议。
3. **附件**：A. C2 做文本类附件；B. C2 含图片；C. 第一期不做附件。
4. **工作流保留**：确认 `plan_first` + 审批 + 重规划全部保留（方案默认「是」）。
5. **C1 是否现在就可以开工**，还是先改方案再动代码。

---

## 10. 建议的第一刀（C1 完成时的外形）

用户打开页面，直接问「这段报错是什么意思」→ 流式 Markdown 解释，工作台不出现三步 DAG。  
再说「按这个思路帮我做一份修复计划并执行」→ 升级为工作流，计划卡出现。  
做完后问「第三步为什么失败」→ 仍在同一会话用对话回答，带着结构化历史。

这三步能走通，才算从「工作流 demo」变成「能对话的 Agent」。
