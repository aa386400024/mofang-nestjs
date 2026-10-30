# mofang-nestjs 后端文档索引

> **约定**：`docs/` 目录**已随引擎 Phase1（WP0 起）纳入 git 版本管理**（`.gitignore` 里的 `docs` 排除规则在 WP0 提交 `dff36fe` 中已移除）。
> 因此本目录下的**任务单与交付记录都会进 commit**，是跨会话接续的唯一事实源，不要写"本地草稿"。
> 历史留档统一在 `archive/`，需要追溯时再翻，日常不看。
>
> **交付记录约定（2026-10-30 起）**：每张任务单配套一份**独立的交付记录** `<任务单名>-implementation-<日期>.md`（与任务单同目录），格式仿 [WP9-C 交付记录](progress/engine-wp9c-voice-render-token-budget-safety-boundaries-implementation-2026-10-29.md)：§0 一句话结论 → 按任务单小节逐节落地 → **与任务单的差异（显式说明）** → 闸门实测结果 → 改动面清单（新增/修改/红线核对）→ commit 文案 → 用户验收 + 已知边界。任务单末尾追加摘要并**交叉链接**到交付记录；本表 `progress/` 每行末尾给出「交付记录」链接 —— 任务单与交付记录**成对出现**，不写单份。

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
| [engine-wp9a-character-profile-seed-injection-backend-2026-10-29.md](progress/engine-wp9a-character-profile-seed-injection-backend-2026-10-29.md) | **WP9-A · 角色内核解析注入管线（内置种子先跑通）**：适配层建可替换端口 `CharacterProfileResolver`（纯 TS 接口 + DI token）+ 2 个内置种子角色（回避依恋 L1 / 焦虑低落 L1），角色 key + 握手 `preset` → 内核 `CharacterProfile` 的**确定性**映射（阻抗 = 种子 + 防御×0.35 + 难度系数；arousal 由临场给、valence 由种子给；**`emotion.label` 不手填**由内核重算；trust 由种子给；移情固定全零），在 `openSession` 注入并带角色 key 稳定派生的 `seed`；**无角色 / 未知角色 / resolver 未装配 / resolver 抛错一律回退中性基线**不阻断；窄接口只**增可选**字段（旧 `VisitorService` 仍满足）；`ENGINE_CHARACTER_SOURCE=db` 只告警占位；内核整树零改动 / 不建 MySQL / 不做审核与 UGC | ✅ 代码已交付并复跑绿：eslint 0 / tsc 0 / jest 两个新套件 28 用例全绿 + engine-core+engine-adapters+voice 18 套件 398 用例全绿（engine-core 177 零回归）；已知缺口：内置种子 key 与公共模板 id 不同命名空间，生产 WS 路径命中率暂为 0（走中性基线） |
| [engine-wp9b-db-character-pool-backend-2026-10-29.md](progress/engine-wp9b-db-character-pool-backend-2026-10-29.md) | **WP9-B · MySQL 角色资产池（5Ps 落库 + 真实 vpt slug 命中）**：新建 `character_profiles` 表（21 列 system 级无 tenant_id + `UNIQUE(template_id)` + `INDEX(audit_status,enabled)`，手写 DDL migration、幂等 up / 净回滚 down、零 DB FK、不开 synchronize）；`DbCharacterProfileResolver implements CharacterProfileResolver`（取行 → 转 `BuiltinCharacterSeed` 形状 → **复用 WP9-A 唯一的 `buildCharacterProfile`，零公式复制**），命中口径 `template_id + approved + enabled + 未软删`，未命中一律回退中性基线并**区分原因**（没建档=debug / 未过审·已下架=warn），DB 异常上抛由 `EngineStreamBackend` 统一容错（WP9-A 已立边界，本轮不改那一层）；**默认数据源由 builtin 改为 db**（`builtin` 保留回退/测试档，未实现值 warn 后回退 db）；首批 **4 个真实 vpt slug**（晚晴/小满/亦舟/念安）入库 approved + 在架，`coreBeliefs` **逐字取自** `visitor_pool_templates.script.innerWorkingModel.coreBeliefs`（同一个人只有一个真相），内容走**独立幂等 seed 脚本**不进 migration，seed 无权改写 `enabled`/`audit_status`；内部 admin 5 端点（`/engine/admin/character-profiles`，class 级 `JwtAuthGuard` + `AdminRoleGuard`，新建缺省 draft）；角色池拆成**独立 Nest 模块 `CharacterPoolModule`** → 引擎装配层零 ORM/零 SDK 包名（守住 WP8-A §8-9 护栏，**护栏未改未破**）；内核整树零改动 / `EngineStreamBackend`·voice 窄接口·`voice.service.ts`·TTS·ASR·agent 零改动 | ✅ 代码已交付并复跑绿：eslint **0 error 0 warning** / tsc 0 错（build + scripts）/ jest 三个新套件 42 用例全绿 + engine-core+engine-adapters+voice+agent+llm **22 套件 462 用例全绿**（engine-core 177 与 WP9-A 既有用例零回归）；**`npm start` 真起服务成功**（`Nest application successfully started`，角色管理 5 路由全部 mapped）；migration up/down 可逆实测、seed 连跑幂等（新增 4 → 未变 4）、DESCRIBE 21 列 + 3 索引实测一致、`git diff --stat HEAD -- src/engine-core` 为空。**顺带拆掉三颗启动/运行炸弹**：① Nest 不允许转出 imported module 的单个 provider；② adapter 的 `import type` 让 `design:paramtypes` 退化成 `Function` → 类 provider 必炸（WP8-B 遗留）；③ `LlmService` 把超时读成字符串 → `AbortSignal.timeout('60000')` → **每次 LLM 调用都炸**。①②修在装配层，adapter 一行未动。交付记录：[engine-wp9b-db-character-pool-backend-implementation-2026-10-29.md](progress/engine-wp9b-db-character-pool-backend-implementation-2026-10-29.md) |
| [engine-wp9c-voice-render-token-budget-safety-boundaries-2026-10-29.md](progress/engine-wp9c-voice-render-token-budget-safety-boundaries-2026-10-29.md) | **WP9-C · 引擎语音渲染路径 token 预算校准 + 安全边界 + E2E 验收**：① token 字段 `maxTokens` → **`maxCompletionTokens`**（默认 **160 → 1500** 走 `ENGINE_RENDER_MAX_TOKENS`，**不同时下发**两字段），voice render **`reasoningEffort=low`**（只对 render taskKind），旧 visitor 链路顺手切字段名；② **截断保护**（新增 `render-truncation.ts`：`finish_reason=length` 裁未闭合尾句，聚合 + 流式**句边界缓冲**，半句不进 TTS）；③ **危机轮次路由**（`LocalCrisisProbe` 实现内核 `RiskProbePort` → `AdaptiveRenderSpec.riskSignal` → 思考强度抬档 + prompt 护栏 + **同步 `supervision_hint` 帧**）；④ **降级路径**（config 加载的**兜底话术池轮换** + `degraded=true` 日志，走正常帧**不发 error 帧**）；⑤ render prompt **确认注入 coreBeliefs** + 轮次权重指令 + dev 日志；⑥ **探针增强**（TTS base64 解码算字节 / 抓 usage+reasoning_tokens / 抓 TTFT / 两角色对比断言 / 截断与危机场景）。**顺手拆掉真缺陷**：LangChain 1.6.2 写 snake_case `finish_reason`，本仓只读 camel → **截断信号从来没收到过**（`readFinishReason()` 双键读取修复） | 🟡 代码已交付并复跑绿：eslint **0 error 0 warning** / tsc 0 错（build + scripts）/ jest **25 套件 495 例全绿**（含 wp8-wiring 护栏 34 例）/ `npm start` 真起服务成功 / `git diff --stat HEAD -- src/engine-core` **为空**；真实上游实测思考 token 94 → 39、耗时 2428 → 1911ms；**待用户跑探针验收**。交付记录：[engine-wp9c-voice-render-token-budget-safety-boundaries-implementation-2026-10-29.md](progress/engine-wp9c-voice-render-token-budget-safety-boundaries-implementation-2026-10-29.md) |
| [engine-wp10-ethical-blindbox-scripts-backend-2026-10-30.md](progress/engine-wp10-ethical-blindbox-scripts-backend-2026-10-30.md) | **WP10 · 伦理盲盒强覆盖剧本资产（10 个）+ 握手注入链路**：`src/engine-adapters/wiring/trajectory/` 落 **10 个 `force_override` 静态 TS 剧本**（各 4 幕：自由运行 → 伦理事件 → 展开 → 收束；只控 `target`/`delta` + `referenceNotes` 督导要点，**不写台词**、不落库/无 migration/不碰 `counselor/drills`）；`TrajectoryScriptResolver` 端口（Symbol token + `@Optional` + **查不到返 undefined 不抛错**）；窄接口加**可选** `trajectoryScriptId` 并从握手 query 透传到 `engine.open().trajectory`（**解析到才注入，不传 = 行为与现状逐字一致**）；踩内核真实语义：**trigger 是跨原子 AND**（列表内才 OR）→ 幕 1 只用一种闸门原子、**不发明 `boundary_holds`**；内核整树零改动 / 旧 VisitorService 零改动 / 引擎装配层零 SDK 依赖 | ✅ 代码已交付并复跑绿：eslint **0 error 0 warning** / tsc 0 错 / jest **2 新套件 31 例全绿** + engine-adapters+engine-core **22 套件 410 例全绿**（engine-core 177 零回归）+ voice 3 套件 88 例全绿 / wp8-wiring 护栏 34 例全绿 / `git diff --stat HEAD -- src/engine-core` **为空**；全量 **53 套件 / 820 例通过**（1 套件 2 例失败 = `drill-judge.spec.ts` 既有债）；**待前端联调**（握手 query 补 `scriptId`）。交付记录：[engine-wp10-ethical-blindbox-scripts-backend-implementation-2026-10-30.md](progress/engine-wp10-ethical-blindbox-scripts-backend-implementation-2026-10-30.md) |
| [engine-wp18-session-report-generation-e2e-2026-10-29.md](progress/engine-wp18-session-report-generation-e2e-2026-10-29.md) | **WP18 · 会话结束 → 复盘报告生成链路端到端打通**：① **确认触发链路**（transcript 落库 / 报告 worker 触发 —— 新引擎路径**本来就通**，走 `VoiceSessionBridge` / `VoiceTurnBackend` 两条窄接口，与新旧链路无关）；② **修主报告恒 `parse_error` 的真病**（M3.1-Flash 思考 token 计入上限，旧预算 2500 被思考吃满 → `finish_reason=length` → **正文一字未出** → JSON 必败）→ 新增主报告**专属 LLM 参数档**（`high`/`8192`/`120s`，env 可配 `ENGINE_SUPERVISION_*`）；③ **JSON 容错抽取上移到 `src/shared`**（counselor 侧早有、agent 侧裸 `JSON.parse` —— 消双胞胎）；④ **`finishReason` 贯通**（只增可选字段），截断与格式错误分开报（`truncated_by_length`）；⑤ 报告字段与前端 `vpt_session_report.dart` **逐项 1:1 对齐**（DTO 与前端均无需改动）；⑥ 探针 `--report` 模式（17 项断言 / **两段轮询** —— 主报告与 techStats 是两个队列两个 LLM） | 🟡 代码已交付并复跑绿：eslint **0 error 0 warning** / tsc 0 错（build + scripts）/ jest **3 套件 34 例全绿**（WP18 新增）+ wp8-wiring 护栏 34 例全绿 / `npm start` 真起服务成功 / `git diff --stat HEAD -- src/engine-core` **为空**；**真实上游端到端**：正常场景首轮 `pending` → 31.6s 后 `completed`（六维 48/38/45/28/42/52、4 条 annotations、techStats 非空）、空局 `no_content`（不编造评分）、不存在 sessionId → 404；**待用户跑探针验收**。交付记录：[engine-wp18-session-report-generation-e2e-implementation-2026-10-29.md](progress/engine-wp18-session-report-generation-e2e-implementation-2026-10-29.md) |
| [engine-wp21-report-sse-stream-2026-10-29.md](progress/engine-wp21-report-sse-stream-2026-10-29.md) | **WP21 · 报告生成 SSE 推送端点**：新增 `GET /counselor/supervision/report/:sessionId/stream`（`@Sse()`），报告到终态推**一条完整报告**并关流（推的 JSON 与 GET 端点**逐字段一致**，真机实测 `JSON.stringify` 相等）；等待超时推 `{"status":"timeout"}`；跨用户/不存在走**真 HTTP 404**（归属校验放 **guard** —— 本仓有全局 `LoggerErrorInterceptor`，在 SSE 通道里抛错只能降级成 `200 + event: error`）；轮询**每轮重新装载+重新派生**（与 GET 同一份实现 —— 终态判定只有一个口径，不漏「空局/墙钟兜底」这类不由报告行决定的终态）；客户端断开靠 RxJS `timer` 随取消订阅销毁（不手写 `setInterval`，不泄漏）；决策表收在 domain 纯函数 `decideReportStreamAction` | 🟡 代码已交付并复跑绿：eslint **0 error 0 warning** / tsc 0 错（build + scripts）/ jest **2 新套件 18 例全绿** + 全量 **51 套件 / 789 例通过**（1 套件 2 例失败 = `drill-judge.spec.ts` 既有债）/ 服务真起（路由已 mapped）/ `git diff --stat HEAD -- src/engine-core` **为空**；**真机实测**：404 / 401 / 已终态立即推（首帧 **291ms**）/ 空局与墙钟兜底**立即推真实终态** / 120s 超时推 `timeout` / **GET 与 SSE 载荷逐字段一致** 全通；**待用户联调**（前端需补 `timeout` 分支，见任务单 §6.4）。交付记录：[engine-wp21-report-sse-stream-implementation-2026-10-29.md](progress/engine-wp21-report-sse-stream-implementation-2026-10-29.md) |
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

**最后更新**：2026-10-29（新增 WP9-B MySQL 角色资产池任务单 + 交付记录；WP5 / WP6 / WP7 / WP8-A / MiniMax / WP8-B / WP9-A 交付记录见 [engine-core-wp5-rendering-scheduling-implementation-2026-10-28.md](progress/engine-core-wp5-rendering-scheduling-implementation-2026-10-28.md)、[engine-wp6-llm-render-port-implementation-2026-10-28.md](progress/engine-wp6-llm-render-port-implementation-2026-10-28.md)、[engine-wp7-spec-assembly-turn-reply-implementation-2026-10-28.md](progress/engine-wp7-spec-assembly-turn-reply-implementation-2026-10-28.md)、[engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md](progress/engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md)、[llm-minimax-chat-provider-implementation-2026-10-28.md](progress/llm-minimax-chat-provider-implementation-2026-10-28.md)、[engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md](progress/engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md)、[engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md](progress/engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md)、[engine-wp9b-db-character-pool-backend-implementation-2026-10-29.md](progress/engine-wp9b-db-character-pool-backend-implementation-2026-10-29.md)）；specs/progress 其余内容未改动。当前阶段 = v1.3 自由练习 + 来访池 + 全真语音闭环，引擎 Phase1 的 WP0–WP5（内核纯层）、WP6（渲染适配层）、WP7（决策→说话闭环单元）、WP8-A（NestJS 装配 + 聚合 turn 生产接线）、WP8-B（流式原生渲染 + voice WS 灰度接入）、WP9-A（角色解析端口 + 内置种子注入）与 WP9-B（5Ps 落 MySQL + 真实 vpt slug 命中）已交付并复跑绿 —— 渲染主备/冷却只有一份实现，灰度开关 `ENGINE_VOICE_ENABLED` 缺省关（旧链路逐帧一致），角色映射公式只有一份（`buildCharacterProfile`，DB 与内置两条路径产出逐字一致），真实 `vpt_*` slug 已能命中角色（WP9-A 命中率 0 的缺口闭合），**应用真起服务已验证通过**（本轮补上 `npm start` 闸门 —— 引擎装配链的 DI 容器层 tsc/eslint/jest 覆盖不到），下一步为 WP10（角色强剧本 / 伦理盲盒）与 WP11。
