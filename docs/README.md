# mofang-nestjs 后端文档索引

> **约定**：`docs/` 整个目录被 `.gitignore` 第 6 行排除 → 这些文档是**本地参考**，不进 commit；
> commit 范围只算 `src/` + `bin/` + `*.json`。
> **本文档的作用**：给当前有效文档一个入口 —— 想知道"现在做到哪了 / 下一步干什么 / 某个决策为什么这么定"，
> 从这里进，不要靠翻文件名猜。历史留档统一在 `archive/`，需要追溯时再翻，日常不看。

---

## 🧭 顶层方向（战略母版在前端仓库）

终局定位、九层生态、五层营收、八条红线、三阶段节奏以**前端产品整合版 §17（2026-10-27 全真执业升级定稿版）**为准：
`xin_su_app/docs/product/心塑App-产品设计文档-整合版v2.0.md` §17。本仓库 specs/progress 只承载已拍板的接口契约与未结待办，不另立战略口径；§17 中标「新增/远期」的接案信箱、转介流转、危机干预、设置压力、文书、AI 团督、公共池接力、自我关怀等模块，在后端收到正式任务单前不提前开发。

---

## 🚦 当前先看（2026-10-23 阶段：v1.3 自由练习 + 金句 + 首页承接）

| 文档 | 什么时候看 |
|------|-----------|
| **[后端待办缺口清单](progress/backend-open-gaps-2026-10-22.md)** | **开工第一入口** —— 当前 P0/P1/P2 缺口（G1 金图托管 / G2 首页真实聚合 / G3 专项进度接 MCQ / G4 真实推荐）+ 上线前运维检查与验收清单 |
| [v1.3 自由练习引擎 spec](specs/counselor-practice-engine-v1.3-freeform.md) | 改自由练习（practice 场景 / 尝试 / 评判 / 私有场景）前的契约依据 |
| [v1.2 全真会谈 spec](specs/counselor-mode-v1.2-full-situ-simulation.md) | 完整会谈 / 分层人设 / 知情同意 / 长程卷宗 / 督导的契约依据，§14 记实现决策 |
| [v0.3 整体基线 spec](specs/ai-voice-training-v0.3.md) | AI 引擎 / 鉴权 / 多租户 / 语音链路的底层基线 |

---

## 📁 目录结构

### `specs/` — 拍板后的契约（开发依据，只留当前母版）

| 文档 | 内容 | 状态 |
|------|------|------|
| [counselor-practice-engine-v1.3-freeform.md](specs/counselor-practice-engine-v1.3-freeform.md) | **v1.3 微技能自由练习引擎**（零压、无分数）——60 场景库 / 尝试 / LLM 主路径+确定性降级评判 / 自定义真实场景生成；0 破坏 v1.2 MCQ | 🟡 主链路已落地，G6/G7 等 P2 待补 |
| [counselor-mode-v1.2-full-situ-simulation.md](specs/counselor-mode-v1.2-full-situ-simulation.md) | **v1.2 全真模拟实训系统**——分层人设 / 知情同意 / 会谈核心 / 长程卷宗 / 督导 / 专项成长；§14 记实现决策 | ✅ 主体落地 |
| [ai-voice-training-v0.3.md](specs/ai-voice-training-v0.3.md) | v0.3 整体基线——AI 引擎 / 鉴权 / 多租户 / 语音链路 / KB-CMS | ✅ 已落地基线 |
| [counselor-visitor-pool.md](specs/counselor-visitor-pool.md) | AI 模拟来访池公共供给层契约（公共模板 + 启动克隆） | 🟢 活跃契约 |
| [counselor-roleplay-voice-bidi-tts-2026-10-23.md](specs/counselor-roleplay-voice-bidi-tts-2026-10-23.md) | 全真会谈 bidi 逐句出声 WS 协议（帧格式/错误归一） | ✅ 已落地，协议参考 |
| [counselor-practice-asr-stt-and-llm-access-2026-10-23.md](specs/counselor-practice-asr-stt-and-llm-access-2026-10-23.md) | 微训练 STT 接入 + 限流/错误映射/env 决策 | ✅ 已落地，实现参考 |

> 旧版 spec（v1.1、v1.3-backend-impl 落地说明、ai-voice v0.1/v0.2、v1.0 纯文字不出声稿 roleplay-text-loop）已移至 `archive/specs-legacy/`，仅追溯用。

### `progress/` — 当前待办与近期落地（只留未结/近期）

| 文档 | 内容 | 状态 |
|------|------|------|
| [engine-core-wp0-boundary-skeleton-backend-2026-10-28.md](progress/engine-core-wp0-boundary-skeleton-backend-2026-10-28.md) | **引擎 Phase1 第一张任务单 WP0**：纯 TS `engine-core` 内核边界骨架（零 NestJS/TypeORM 直连、内存仓储、可脱离容器单测），不写算法不接线 | ✅ 代码已交付，待复跑 build/test |
| [engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md](progress/engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md) | **引擎 Phase1 WP1 · BDI 认知引擎（规则轨）**：快照五槽位落地为具体类型、事件分类器+状态迁移算子+意图规划器、角色基线注入、可复现快照；不接 LLM/不渲染/不接线 | ✅ 代码已交付，jest 42 绿 / tsc 0 错 / eslint 0 错 |
| [engine-core-wp2-layered-memory-backend-2026-10-28.md](progress/engine-core-wp2-layered-memory-backend-2026-10-28.md) | **引擎 Phase1 WP2 · 分层记忆 V1**：三级记忆（工作8轮窗口/短时晋升/长时 Qdrant visitor_long_memory）、重要度衰减、显式主题键冲突消解、跨会话按 visitorId 接续召回；端口向后兼容，Qdrant/embedding 实现放 B 层，本期不调 LLM/不出口语 | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest 5 套件 95 用例全绿（WP0·WP1 既有 42 零回归） |
| [engine-core-wp3-trajectory-control-backend-2026-10-28.md](progress/engine-core-wp3-trajectory-control-backend-2026-10-28.md) | **引擎 Phase1 WP3 · 会话轨迹控制引擎**：强覆盖/修正/触发三模式 + 线性多幕游标（单向推进/不跳幕），条件判定 + 游标推进 + 三模式合成纯函数，确定性可复现的标准化考核/伦理盲盒；剧本经 openSession 注入不落库，游标仅进程内存，不调 LLM/不出口语，不搬 counselor/drills | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest engine-core 5 套件 123 用例全绿（WP0·WP1·WP2 既有 82 零回归）+ engine-adapters 13 绿 |
| [engine-core-wp4-ethics-safety-backend-2026-10-28.md](progress/engine-core-wp4-ethics-safety-backend-2026-10-28.md) | **引擎 Phase1 WP4 · 伦理安全引擎**：咨询师侧确定性硬规则（承诺治愈/双重关系/违法指导/自杀自残指导/歧视 → block；说教/过早建议 → warn）+ 可选 PsyGUARD 风险探测端口（超时/报错自动降级回规则，绝不阻断对话）+ 会话内累计伦理报告；内核只判定不拦截、不内置模型、不发网络、不落库，不搬 counselor/drills/live-hint | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest engine-core 6 套件 153 用例全绿（WP0–WP3 既有 123 零回归）+ engine-adapters 13 绿 |
| [engine-core-wp5-rendering-scheduling-backend-2026-10-28.md](progress/engine-core-wp5-rendering-scheduling-backend-2026-10-28.md) | **引擎 Phase1 WP5 · 多模型渲染调度（契约层）**：渲染规格 `RenderSpec`（意图+情绪阻抗移情+信念+记忆+轨迹参考+最近对话+Token预算）+ `RenderPort` 端口 + 任务分层（stable/chat/advanced）+ Token 预算裁剪（保尾部最近轮）+ 主备容灾「选谁」纯状态机 + 输出侧伦理校验（复用 WP4）；本期零 LLM/零 prompt/零网络/零落库，turn 管线零改动、reply 恒空 | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest engine-core 7 套件 177 用例全绿（WP0–WP4 既有 153 零回归）+ engine-adapters 13 绿 |
| [phase1-integration-backlog-2026-10-28.md](progress/phase1-integration-backlog-2026-10-28.md) | **Phase1 装配集成轮总清单（WP6+）**：WP0–WP5 交付内核纯层后"把纯层接成可用对练"的剩余工作拆解 —— WP6 渲染适配 → WP7 规格组装+turn 接线 → WP8 WS/流式端到端 → WP9 角色资产池 → WP10 剧本资产 → WP11 PsyGUARD → WP12 记忆装配 → WP13 可观测 |
| [phase1-milestone-to-beta-10weeks-2026-10-28.md](progress/phase1-milestone-to-beta-10weeks-2026-10-28.md) | **Phase1 到 Beta 的 10 周里程碑**：从内核纯层到可交付 Beta 的排期与验收口径 |
| [engine-wp6-llm-render-port-backend-2026-10-28.md](progress/engine-wp6-llm-render-port-backend-2026-10-28.md) | **WP6 · RenderPort LLM 适配 + 主备执行（适配层）**：`LlmRenderAdapter implements RenderPort`（窄面 `ChatCaller` → 可 mock）+ 主备运行时（失败计数 → 指数退避冷却 → 恢复切回主，"选谁"仍走内核 `selectFailoverTarget`）+ 任务分层配置化温度/模型 + 输出侧 guard 处置（warn 放行 / block 重生成一次仍 block 则降级且**不传高危原文**）+ 鉴权失败不循环；本期不组装 RenderSpec / 不接 turn / 不填 reply / 不流式 | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest engine-adapters 2 套件 31 用例全绿（WP6 新增 18）+ engine-core 7 套件 177 用例零回归（内核与 `src/llm` 整树零改动） |
| [engine-wp7-spec-assembly-turn-reply-backend-2026-10-28.md](progress/engine-wp7-spec-assembly-turn-reply-backend-2026-10-28.md) | **WP7 · RenderSpec 组装 + turn 接线填 reply（决策→说话闭环）**：`buildRenderSpec` 纯函数（决策→规格，历史裁剪复用内核 `fitContextToBudget`）+ `TurnRenderOrchestrator` 装配门面（内核 turn → 组装 → `RenderPort.render` → 回填真实 reply → 问+答成对补写工作记忆）+ 中文来访风格 system prompt 模板（仅适配层，内核零 prompt）；内核 `reply` 仍恒 `''`、内核与 `src/llm` 整树零改动 | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest engine-adapters 3 套件 47 用例全绿（WP7 新增 15）+ engine-core 7 套件 177 用例零回归 |
| [engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md](progress/engine-wp8-di-wiring-aggregated-turn-backend-2026-10-28.md) | **WP8-A · 引擎 NestJS 装配 + 聚合 turn 生产接线**：用 `LlmRouterService.chat` 包出窄面 `ChatCaller` → 装配 `InMemoryEngineSession` / `LlmRenderAdapter` / `TurnRenderOrchestrator` → 接好 `resolveSession` 归属注入缝与 `buildVisitorMessages` prompt 缝 → 对外 `open/turn/close` 聚合门面 + JWT 聚合调试端点（`/engine/debug/*`）；**装配层只做「读 env → 造纯对象 → 注入」**，零决策/零 prompt/零 RenderSpec 组装；内核与 `src/llm` 整树零改动；本期不做流式 / WS / 灰度切旧（归 WP8-B） | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest engine-adapters 4 套件 81 用例全绿（WP8-A 新增 34）+ engine-core 7 套件 177 用例零回归 |
| [llm-minimax-chat-provider-backend-2026-10-28.md](progress/llm-minimax-chat-provider-backend-2026-10-28.md) | **MiniMax chat provider 接入（让 WP8 引擎聚合 turn 出真实 reply）**：新增 `minimax` 厂商（继承 OpenAI 兼容基类，复用既有 `MINIMAX_API_KEY/BASE_URL/LLM_MODEL`，只注册 CHAT）+ 启动注册分支 + 厂商 env 事实单一真相表（apiKey 键名 / 模型名 / 基址归一）；**只动 `src/llm`**，内核 / 装配层 / voice / agent / counselor 零改动 | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest test/llm 1 套件 22 用例全绿 + engine-adapters+engine-core 11 套件 258 用例全绿零回归；curl 端到端实测 `reply` 非空真实文本 / `fallbackUsed=false` / `providerHint=minimax` |
| [engine-wp8b-streaming-ws-grayscale-backend-2026-10-29.md](progress/engine-wp8b-streaming-ws-grayscale-backend-2026-10-29.md) | **WP8-B · 流式原生渲染（单一实现）+ 接进 voice WS + 灰度切旧**：`render()` 与 `streamRender()` **共用**同一份候选主备核心（`runCandidateLoop` + `RenderFailoverRuntime`，冷却/退避/记账只有一份）；流式四阶段（首 delta 前定候选 → 鉴权失败不切备 → 首个非空 delta **锁定**候选 → 边吐边累计 → 后置全文 guard 只记信号）；guard 拆**前置静态预检**（只基于 RenderSpec，复用内核同一套规则，不调模型）+ **后置全文 guard**；门面新增 `turnStream`（复用决策/组装/落账的同一套闭环）；voice 侧经窄接口 `VoiceTurnBackend` + 灰度开关（`ENGINE_VOICE_ENABLED` / `ENGINE_STREAM_GRAYSCALE_SESSIONS`）接入，**消费器零改动**，新引擎失败本场**透明回落**旧链路（帧序列逐帧一致）；内核整树零改动 / 不动 TTS·ASR·bridge / 不删旧 visitor / 不改前端帧 | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest 三个新套件 37 用例全绿 + engine-core+engine-adapters+voice 16 套件 370 用例全绿（engine-core 177 零回归）；真实上游（MiniMax）实测 7 段增量 / ttft 5824ms / barge-in 首段后真断流 |
| [backend-open-gaps-2026-10-22.md](progress/backend-open-gaps-2026-10-22.md) | **当前待办主线**：P0 G1 金句图托管、P1 G2-G4 首页个性化真实聚合、P2 G5-G8 完善项 + 上线验收 | 🔴 进行中 |
| [quote-static-cdn-backlog-2026-10-22.md](progress/quote-static-cdn-backlog-2026-10-22.md) | 金句背景图 CDN/静态托管未就绪的独立待办（G1 展开） | 🔴 未解决 |
| [vpt-session-enhancement-backend-2026-10-26.md](progress/vpt-session-enhancement-backend-2026-10-26.md) | **vpt 全真语音会话增强**：会话落库贯通、实时提示/技术统计/移情标记接 WS、暂停恢复、复盘报告查询+4流派反馈、卡片字段 | 🔴 待开工 |
| [history-list-backend-2026-10-26.md](progress/history-list-backend-2026-10-26.md) | **练习历史列表接口补充**：会话列表补 sessionType/reportStatus/overallScore/interrupted 聚合字段 + 批量取报告消 N+1 + 类型过滤（本期仅 vpt+单次训练） | ✅ 已完成 |
| [empty-session-report-lifecycle-backend-2026-10-27.md](progress/empty-session-report-lifecycle-backend-2026-10-27.md) | **空会话与报告生命周期边界**：空局前置拦截不派发、`no_content` 终态派生、瞬时失败落 parse_error+手动重试、陈旧兜底 15min→5min | 🔴 实现中 |
| [vpt-feedback-status-isolation-2026-10-27.md](progress/vpt-feedback-status-isolation-2026-10-27.md) | **判断2 补丁**：vpt 的 CBT 流派反馈不参与整体 reportStatus 派生（主报告未到时不得被反馈提前判 completed/parse_error），仅 training_session 走反馈档 | 🔴 待修 |
| [visitor-pool-backend-parallel-2026-10-27.md](progress/visitor-pool-backend-parallel-2026-10-27.md) | **来访池后端并行任务（不依赖前端）**：A 公共人物绑定系统音色 / B 危机识别专区静态元数据壳(只读不干预) / C 督导 alternatives 替代回应 / D 代号合规巡检订正 | 🔴 待开工 |

> 已落地的一次性记录（v1.3 §7/§8、来访池后端、vpt 联调清单、10-26 音色代理/握手任务单）移入 `archive/progress-2026-10/`；10-21 v1.2 当日记录、10-20 专项改版、更早扫描快照在 `archive/`。

### `architecture/` — 长期架构与环境（保留不动）

| 文档 | 内容 |
|------|------|
| [ai-engine-roadmap-v1.1.md](architecture/ai-engine-roadmap-v1.1.md) | **AI 来访仿真引擎终局路线图**：现状基线、已拍板决策、五引擎差距、Phase1 工作包 WP0-WP5、参考资产借鉴、伦理分层、不做清单（引擎方向母版，任务单从这里拆） |
| [v6.0-ai-engine.md](architecture/v6.0-ai-engine.md) | V6.0 AI 引擎架构与部署 |
| [v2-user-module-architecture.md](architecture/v2-user-module-architecture.md) | V2 用户模块架构 |
| [V2_SETUP.md](architecture/V2_SETUP.md) | 本地环境搭建 |
| [V3_DOCKER_DEPLOY.md](architecture/V3_DOCKER_DEPLOY.md) | Docker 部署 |

### `reference/` — 上游愿景原件（仅备查，落地以 architecture 为准）

| 文档 | 内容 |
|------|------|
| [ai-simulation-blueprint-v1.1.md](reference/ai-simulation-blueprint-v1.1.md) | PDF《AI来访仿真平台终局版技术实现方案 V1.1》转写原件；**愿景备查，冲突处以 roadmap 为准** |

### `adr/` — 架构决策记录（**改动前先看有没有相关 ADR**，长期保留不动）

| ADR | 决策 |
|-----|------|
| [README](adr/README.md) | ADR 目录说明 + 模板 |
| [0001-jwt-vs-cookie-session.md](adr/0001-jwt-vs-cookie-session.md) | JWT vs Cookie Session |
| [0002-async-audit-log-via-bullmq.md](adr/0002-async-audit-log-via-bullmq.md) | 审计日志走 BullMQ 异步 |
| [0003-typeorm-migration-replace-synchronize.md](adr/0003-typeorm-migration-replace-synchronize.md) | **禁用 `synchronize: true`，所有 schema 变更走 migration** |

### `archive/` — 历史留档（不再日常翻阅，需要追溯旧结论时按目录找）

- `specs-legacy/`：v1.1、v1.3-backend-impl、ai-voice v0.1/v0.2 等被取代的旧 spec。
- `progress-2026-10/`：10-21 v1.2 五切片落地记录、总快照、排期、gap-scan；10-22 金句后端落地、v1.3 前端记录；10-20 专项改版。
- `progress-earlier/`：10-15 V3.1 治本、10-14 三次并行扫描 + 深度扫描、10-13 v0.1 快照。
- `handoff/`：10-15 跨会话接续提示（已被后续文档覆盖）。

---

## 🔧 写代码前必看的 16 条硬约束

1. **migration 真注册点是 `bin/ormconfig.ts`**（import + `migrations[]` 数组），`src/migration/index.ts` 全仓无人 import —— 漏登记会**静默不建表**（输出 "No migrations are pending"）
2. **counselor 系 migration 一律手写 DDL** —— `migration:generate` 的 entities glob 扫不到 counselor entity
3. **软删不是 `@DeleteDateColumn`** —— 每处查询手写 `deletedAt: IsNull()`
4. **同名符号跨文件要查重** —— domain interface 与 entity class 曾同名 → TS2300 级联炸 27 个错
5. `noUnusedLocals`（未使用 import = **错误**）· `noPropertyAccessFromIndexSignature`（`obj['x']` 括号访问）· `strict`
6. **结构化输出只有一条链** —— 一律走 `CounselorLlmJsonClient`
7. **`.env` 的 `MINIMAX_LLM_MODEL` / `MINIMAX_BASE_URL` 是 ASR/TTS 共用值，不许动** —— 模型差异用 `MINIMAX_COUNSELOR_LLM_MODEL` per-call 覆盖
8. **M3.1-Flash 忽略 `temperature`/`top_p`**（确定性靠 prompt + `reasoning_effort`）；**thinking token 计入生成长度上限**（结构化 JSON 用 `max_completion_tokens` 并留余量）
9. **不自动 commit / push** —— 写完给 commit 文字，等大炮指令
10. **偏好表的键白名单拦不住"已知键 + 非法值"** —— `prefs` 值类型放宽为 `boolean | string` 后要按键加值白名单
11. **SSE 事件总线是进程内的** —— 多实例部署需换 Redis Pub/Sub（仓库当前无 pub/sub 频道）
12. **异步任务的偏好在「执行时」读，不在「入队时」读** —— 用户中途改的偏好要能立刻生效
13. **jobId 要幂等** —— 重试/重传不能堆重复 job
14. **agent 与 business 之间只走 @Global 注册表** —— provider token 直注会成环（counselor→agent 取 LlmModule，agent→counselor 就成环）
15. **业务上下文块要能"替换"通用画像，不能只追加** —— 两套人设并存会让模型选择性忽略，行为不可预期
16. **"档位"只控展示，不控是否分析** —— 档案抽取 / 信任度推进 / 移情标记是卷宗数据，对关掉提示的用户同样有价值

### 零压红线（自由练习 vs MCQ 严格隔离）

- 自由练习（practice）**无分数 / 无对错 / 无评级 / 无通过率**，只有 3-5 条零压批注；
- 分数、平均分、是否正确**只允许出现在 MCQ 备考频道**（training-exercises），两套 DTO 不得混算。

---

## 📐 文档写作规范

- 命名：`<主题>-<切片>-<日期>.md`，日期 `YYYY-MM-DD`
- 每个文件头写「用途 / 性质 / 配套文档」，让人 10 秒内知道要不要点开
- 落地记录要含：**改了什么 / 为什么这么定（反双胞胎）/ 怎么验证 / 下次接续入口**
- 文档里的"已落地"结论必须能对上 commit hash，否则就是过期信息
- 拍板类的决策要同时写进 spec（契约层）与 progress（时间线层），避免只在一处
- 已完成、被新版取代的快照/扫描/handoff 用完即移入 `archive/`，主目录只留当前有效契约与未结待办

---

**最后更新**：2026-10-29（新增 WP8-B 流式原生渲染 + voice 灰度接入任务单；WP5 / WP6 / WP7 / WP8-A / MiniMax / WP8-B 交付记录见 [engine-core-wp5-rendering-scheduling-implementation-2026-10-28.md](progress/engine-core-wp5-rendering-scheduling-implementation-2026-10-28.md)、[engine-wp6-llm-render-port-implementation-2026-10-28.md](progress/engine-wp6-llm-render-port-implementation-2026-10-28.md)、[engine-wp7-spec-assembly-turn-reply-implementation-2026-10-28.md](progress/engine-wp7-spec-assembly-turn-reply-implementation-2026-10-28.md)、[engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md](progress/engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md)、[llm-minimax-chat-provider-implementation-2026-10-28.md](progress/llm-minimax-chat-provider-implementation-2026-10-28.md)、[engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md](progress/engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md)）；specs/progress 其余内容未改动。当前阶段 = v1.3 自由练习 + 来访池 + 全真语音闭环，引擎 Phase1 的 WP0–WP5（内核纯层）、WP6（渲染适配层）、WP7（决策→说话闭环单元）、WP8-A（NestJS 装配 + 聚合 turn 生产接线）与 WP8-B（流式原生渲染 + voice WS 灰度接入）已交付并复跑绿 —— 渲染主备/冷却只有一份实现，灰度开关 `ENGINE_VOICE_ENABLED` 缺省关（旧链路逐帧一致），下一步为 WP9（角色资产池 / 5Ps 剧本注入）。
