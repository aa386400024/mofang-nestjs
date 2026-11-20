# AF-209 · 来访者真人度 R3：语域审计、场景矩阵与不可朗读文本拦截

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-209/task-sheet.md`
- 基线：`fcac5b2c1b881d0b6fbac9ca0e7b29cb4982c5ad`（AF-208 合并后）
- 实施日期：2026-11-20（跨零点收尾）
- 角色：executor

## 一、交付范围

本单把 R2 的“话轮形态”推进到“语域 + 可朗读性 + 场景一致性”，不改 engine-core、不加 env、不改变默认 `off`。

### 新增

- `src/shared/realism/visitor-register-audit.ts`
  - 硬违约：`non_spoken_text`（括号/星号舞台动作、界面 chrome）、`prompt_echo`（设定/prompt 模板回显）。
  - 软信号：`clinical_jargon`、`bookish_connective`、`assistant_tone`、`meta_speech`；只记录，不触发重试。
  - `prompt_echo` 抑制其他软信号，避免把整段 prompt 里的“阻抗”等词误记成来访者语域。
- `test/auto-practice/af209-register-audit.spec.ts`（15 项）
- `test/auto-practice/af209-realism-matrix.spec.ts`（5 项）
- `test/engine-adapters/af209-register-retry.spec.ts`（6 项）

### 修改

- `src/shared/realism/visitor-realism-profile.ts`
  - 新增“语域层”directive；只在 active 注入。
  - 场景话术去掉禁用词举例，改为“不要写任何界面词、软件操作或旁白”，降低 prompt 自身成为泄漏源。
  - 文字短形态同步去掉“消息/发送/对方正在输入”的举例。
- `src/shared/realism/visitor-realism-audit.ts`
  - `RealismViolation` 接入 `non_spoken_text` / `prompt_echo`；`RealismSignal` 接入四类语域软信号。
  - 风险轮也执行不可朗读与 prompt 回显检查；风险轮不再“整轮豁免”。
  - 重试指令增加“只输出能直接朗读的台词”和“不要把设定、规则、状态词带出来”。
- `src/shared/realism/index.ts`
  - 导出 `inspectVisitorRegister` 与 register 类型。

## 二、关键设计决策

1. **硬违约只放两类**
   - 不可朗读文本：TTS 读不出，且会破坏角色沉浸。
   - prompt 回显：比语气问题严重，必须重说；与 R1 输出闸门形成纵深防御。

2. **咨询术语只做软信号**
   - “边界感”“原生家庭”等词真实来访者也可能说；硬拦会误伤。
   - 软信号用于观察 prompt 是否把台词带成评估报告，不逼模型改写成假口语。

3. **界面 chrome 收窄**
   - 历史复算发现“给朋友发消息今晚可以试试”被 `发消息` 误判。
   - 已删除 `发消息 / 发了条消息 / 发送消息`，只保留真正属于对话界面的词（对方正在输入、语音条、聊天框、屏幕上、未读消息等）。
   - 新增回归测试，防止再次误杀生活语义。

4. **场景默认不变**
   - `resolveRealismScene()` 缺省仍是 `in_person`；视频/语音归 `online_voice`；文字必须显式 `online + text`。
   - 场景层与角色层解耦，新增场景只需扩 `RealismScene` 与场景表，不触碰审计与重试通道。

5. **重试预算不变**
   - 仍只在 active 下最多一次；重试仍失败接受第二次可读文本，不降级兜底句；流式只审计不重试。
   - `prompt_echo` 与 `non_spoken_text` 共用同一预算，避免叠加放大调用。

## 三、历史导出离线复算

对用户两份导出做只读复算，统计 visitor 台词：

| 文件 | visitor 条数 | 不可朗读 | prompt 回显 | 语域软信号 |
| --- | ---: | ---: | ---: | ---: |
| `auto-practice-FzkJ9Z15n10nNUed1hWv_.json` | 52 | 0 | 1 | 0 |
| `auto-practice-fJI3UtvAl6u1Ss34JViWq.json` | 17 | 0 | 0 | 0 |

说明：

- 第一份导出有 1 条整段 prompt 回显，已被 `prompt_echo` 命中；这条在旧批次里就是用户反馈的“回复里出现 prompt”。R3 不依赖上游闸门，自己能识别并触发一次重说。
- 其余 68 条没有括号动作、星号动作或界面 chrome；语域软信号为 0，说明历史台词的主要问题不是“满口咨询术语”，而是回显与过长。
- 复算只用 `inspectVisitorRegister`，不重建 profile，不替代 R2 的话轮形态审计；比例只用于回归口径，不作为生产重试率证据。

## 四、闸门证据

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向回归 | `pnpm exec vitest run` 6 个 R2/R3 文件 | 6 files / 49 tests passed |
| 类型检查 | `pnpm typecheck` | 0 error |
| Lint | `pnpm exec eslint --no-cache "{src,test}/**/*.ts"` | 0 error / 0 warning |
| 全量测试 | `pnpm test` | 232 files passed + 1 skipped；4044 tests passed + 4 skipped |
| engine-core | `git diff --stat HEAD -- src/engine-core` | 空 |

## 五、偏差与遗留

- **偏差**：任务单只写“界面词硬拦”，实施中追加 `prompt_echo` 硬违约。理由是历史导出已出现整段 prompt 回显，且它同时满足“不可朗读”和“角色破坏”，仅靠上游输出闸门不够。
- **偏差**：界面词表比初版收窄，去掉“发消息”等生活语义，避免把正常内容判失败。
- **未做**：真实 LLM 批量复跑、线上文字场景的真实读感对比、AI 双盲评分接入。R3 只到“临床代理门槛 + 工程闸门”，不宣称临床有效性。
- **仍默认 off**：`RENDER_REALISM_MODE` 默认 `off`；验收批次需显式 `active`。
- **R4 建议**：把语域软信号纳入批次指标；用真实批次标定 `prompt_echo` / `non_spoken_text` 的重试率；再决定是否把 `clinical_jargon` 升级为按角色区分的硬规则。

## 六、提交信息

`feat(af209): 增加来访者语域审计与不可朗读文本拦截`
