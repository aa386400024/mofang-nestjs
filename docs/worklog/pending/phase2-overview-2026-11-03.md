# Phase2 专业增强期 — 总览文档

> **路径**：`docs/worklog/pending/phase2-overview-2026-11-03.md`
> **状态**：待开工（Phase1 已封版 2026-11-03）
> **目标**：商业化准备 — 补齐专业能力，拉开与竞品差距，支撑 C 端会员付费
> **上游依据**：[蓝图 V1.1](../../reference/ai-simulation-blueprint-v1.1.md) §Phase2 专业增强期 + [路线图 V1.1](../../architecture/ai-engine-roadmap-v1.1.md) §9 四阶段演进
> **配套**：Phase1 交付记录见 [`../completed/phase1/`](../completed/phase1/)

---

## 1. Phase2 定位

### 1.1 核心目标

**商业化准备**：从"能跑"升级到"能收钱"。

- 专业能力：来访仿真从"基础闭环"升级到"临床级真实感"，拉开与普通竞品的差距
- 商业化根基：支付体系、会员分层、合规留存全部到位，支撑 C 端会员付费
- 运营基础：Admin Dashboard 切真数据、成本可观测，上线后能运维

### 1.2 时间预期

- 蓝图参考：5-12 个月（Phase2 专业增强期）
- 本仓库实际：按 WP 拆分，并行推进，不设硬截止

### 1.3 不做什么（明确边界）

以下内容属 Phase3+，收到正式任务单前不提前开发：

- 多人会谈 / UGC 全流程 / B 端督导工作台 / 微服务拆分
- 会话分支与状态回退 / 沉默非语言事件 / MindGuard 接入
- 万级并发 / 多流派评分标尺 / 流派差异化参数体系

---

## 2. 工作包总览

### 2.1 优先级分层

| 层级 | 含义 | 数量 |
|---|---|---|
| 🔴 P0 商业化根基 | 上线收钱前必须完成，不做不能商业化 | 8 条 |
| 🟡 P1 专业能力主线 | 蓝图 Phase2 核心引擎能力，拉开差距的关键 | 20 条 |
| 🟢 P2 技术债清理 | 顺手做，不阻塞商业化但影响可维护性 | 13 条 |

> 🆕 **2026-11-05 新增混合式 BDI PoC 组（WP63–WP68，6 条）**：基于 Coze 下线趋势判断的架构方向校准。详见 [`../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../architecture/hybrid-bdi-agent-blueprint-v1.0.md)。

### 2.2 完整清单

#### 🔴 P0 商业化根基（8 条）

| # | 工作包 | 现状 | 验收标准 | 依赖 |
|---|---|---|---|---|
| P0-1 | **billing 接真支付** | 4 endpoint 全是内存 mock，返"5元尝鲜包(mock)" | 微信支付 V2 + 支付宝当面付接入，订单落库，回调验签 | 无 |
| P0-2 | **会员分层 TTS** | env 写死 `speech-2.8-turbo`，所有用户一样 | tier→model 可扩展配置表（env 或 DB），会话启动时查一次 tier 并缓存 | P0-1 |
| P0-3 | **TTS emotion 映射** | 协议支持 `voice_setting.emotion`，没接 | BDI valence/arousal → emotion 映射表，真机听感校准 | P0-2 |
| P0-4 | **TTS 内联语气词标签** | 协议支持 `(sighs)` `(pant)` 等，没注入 | prompt 里告诉 LLM 必要时插入语气词标签，TTS 真发声 | P0-2 |
| P0-5 | **WP11 回改正式值** | PsyGUARD 超时 500ms→150ms、token 窗口 256→28 | 内测前改回生产值，性能测试通过 | 无 |
| P0-6 | **数据分级留存与销毁** | 无删除权、导出权、年限分级 | 用户删除权（对话+记忆+账号）、导出权、数据分级策略落地 | 无 |
| P0-7 | **Admin Dashboard 切真 API** ✅ 全部页面已切真（WP30 + 四合一任务单 2026-11-05） | — | 全部页面接 `/admin/api/*` 真数据，去掉 mock 标识 | 无 |
| P0-8 | **成本看板与告警** 🚧 看板已交付（WP31 ✅ 2026-11-05），告警未做 | 指标采集有了，告警规则没接 | 成本看板展示 token 消耗/用户/会话，超阈值告警 | 无 |

#### 🟡 P1 专业能力主线（17 条，核心项如下）

> 完整 WP 清单见 [`phase2-wp-list-2026-11-03.md`](phase2-wp-list-2026-11-03.md)。

| # | 工作包 | 蓝图依据 | 验收标准 | 依赖 |
|---|---|---|---|---|
| P1-1 | **P1 人格调节算子**（WP34 ✅ 2026-11-03） | §4.5 P1 级：依恋调节 + 人格特质调节 | 安全型依恋信任增量 > 回避型，同场景不同角色反应不同 | WP1 基础算子 |
| P1-2 | **渲染四手法** | §4.6：阻抗-表达映射、口语化/非语言、表达层随机、情绪粒度 | 高阻抗→短句/浅内容/硬态度，低阻抗→自然倾诉，表达层轻量随机不重复 | WP7 spec-assembler |
| P1-3 | **表达风格渲染接入** | PatientHub 三维阻抗量化 | WP10A 预留 3 列（话量基线/叙事风格/语态倾向）接入 spec-assembler | P1-2 |
| P1-4 | **咨询同盟三维** | 临床级关系修复 | trust/safety/bond 独立建模，建立/破裂/修复算子，调节阻抗下降速率 | P1-1 |
| P1-5 | **跨会话间隔自然衰减** | AnnaAgent 衰减机制 | 隔 N 天后 resume，情绪/阻抗/信念按差异化半衰期回落 | WP12 resume |
| P1-6 | **记忆会话级摘要压缩** | AnnaAgent 三级记忆 | 单会结束生成摘要，近原始远摘要，异步生成不阻塞会话结束 | WP2 长时记忆 |
| P1-7 | **评估引擎基础版** | PatientHub 临床评估 | 旁路异步消费 BDI 快照/对话/伦理标签，输出基础技术+伦理维度评分 | WP8-B 流式 |
| P1-8 | **成长档案体系** | 蓝图 Phase2 第 6 条 | 全链路数据沉淀 → 档案生成，用户可查看自己的实训成长记录 | P1-7 |
| P1-9 | **角色版本 semver** | 蓝图版本管理 | 主版本进行中锁定 / 次版本平滑 / 修订实时，历史版本可回溯 | WP9 角色池 |
| P1-10 | **BDI 状态持久化** | 蓝图会话状态域 | 内存态 → Redis/DB，进程重启后可恢复 BDI 快照 | 无 |
| P1-11 | **BDI 信念层深度扩展** | 蓝图 BDI 完整模型 | 核心信念激活规则、短期信念置信度衰减、信念干预算子（不追求完整 BDI 推理循环，那是 Phase3+） | P1-1 |
| P1-12 | **引擎调试面板 / BDI 状态 trace** 🚧 后端已交付 | 内测调参刚需 | 每轮 BDI delta trace、事件触发链、prompt 快照、delta cap 砍幅，Admin Dashboard 会话调试视图。⚠️ **WP58（2026-11-05）只交付后端三接口**（`/admin/api/debug/session` 三个端点，调试会话**落 JSON 文件**（`data/debug-sessions/`，每轮追加写，**仍不写** `training_sessions` / `turn_debug_trace`），每轮返回 BDI 快照 / delta / 意图 / 渲染规格 / **prompt 全文** / 审议 trace）；**"事件触发链 / cap 砍幅"仍未做**（内核不对外逐轮明细，另开单） | P0-7 |

#### 🟢 P2 技术债清理（11 条，主要项如下）

> 完整 WP 清单见 [`phase2-wp-list-2026-11-03.md`](phase2-wp-list-2026-11-03.md)。

| # | 工作包 | 来源 |
|---|---|---|
| P2-1 | P3 技术债 8 条（Qdrant `client: any`、`TemplateParameter = any[]`、`VOICE_SESSION_IDLE_TIMEOUT_MS` 死配置、`cancelled` 状态只写不读、状态衰减/边际递减/饱和、Prometheus 告警规则、QdrantMemoryStore 默认值耦合） | WP25 审查 |
| P2-2 | Sentry 通道脱敏（本地日志已脱敏，Sentry 还是原样上报） | WP26 遗留 |
| P2-3 | supervisor 督导报告切真 DB（现在是 V0.x 内存 mock） | 代码扫描 |
| P2-4 | env 守卫盲区（WP48）：`.env.example` 的机器守卫分不出「读进 config」与「真被消费」，读得到但无人消费的键能绿灯通过断言① | WP28 收尾 |
| P2-5 | 角色大五人格字段落地（WP49 ✅ 2026-11-04）：大五人格没有数据源（DB 的 `five_ps` 是临床 5Ps，不是大五）→ WP34 的宜人性调节在生产上休眠；另含「依恋 → 基线阻抗」缺省映射（`.env.example` 18 个 `ENGINE_CAP_*` 的重复数值已于 2026-11-03 清理完毕）。⚠️ **大五人格字段本期已落地**（内核零改动；适配层 3 文件 + 手写 migration 加 `personality_traits JSON NULL` 一列，无 DEFAULT）；**「依恋 → 基线阻抗」缺省映射仍未做** —— 任务单 §4.4 明确留到后面 | WP34 收尾 |
| P2-6 | 记忆召回策略优化（WP59）：Top-K 截断 + 时间衰减加权，相似记忆冲突消解（先做最简单的，复杂消解放后面） | WP56 后续 |
| P2-7 | delta 规则表配置化（WP60）：事件→delta 映射从硬编码抽成配置文件，内核读配置不变纯层纪律。⚠️ 现在不急——单人开发阶段硬编码最快，等真需要自定义规则了再抽 | 架构评审 |
| P2-8 | 内核端口类型 barrel 收口（WP62）：`RecallPolicyOptions` 等端口类型没进 barrel —— 适配层深路径 import 被边界断言 ⑪ 拦下，加导出要动 `index.ts` + 边界断言 ⑥ 的白名单。⚠️ 现在不急——结构化类型够用，等攒到 3-5 个端口类型要补时一起补 | WP59 收尾 |

#### 🧪 混合式 BDI PoC 组（2026-11-05 新增，WP63–WP68）

> 来源：Coze/Dify 等静态工作流工具集体收缩，BDI 引擎从"规则驱动"演进为"LLM 审议 + 状态骨架"。详见 [`../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../architecture/hybrid-bdi-agent-blueprint-v1.0.md)。
>
> **这组 WP 是 PoC 验证，不是替换生产。** 影子模式并行跑，用数据证明这条路走得通。engine-core 零改动。

| # | 工作包 | 优先级 | 一句话描述 |
|---|---|---|---|
| P1-13 | **审议输出 Schema 与可解释性设计**（WP63 ✅ 2026-11-05） | 🟡 P1 | JSON schema + operatorTags 枚举 + 审议 prompt 模板设计（系统/用户双 prompt + 考核/自由双模式）—— 本期只定契约不接管道（影子模式归 WP64）；`operatorTags` 由 12 个补到 13 个（补回 `sensitive_touch`），输出取数组形态（每条 delta 自带标签 + 理由） |
| P1-14 | **LLM 审议层 PoC（影子模式）**（WP64 ✅ 2026-11-05） | 🟡 P1 | 影子模式跑 LLM 审议，结果不生效，对比规则算子 delta，积累 100 场对话数据验证质量 —— ⚠️ 旁路调用点接在**编排门面**（不是任务单写的 counselor 域）；`ruleDelta` 用前后快照差反推；每场**第一轮**跳过（起始快照适配层自记）；`maxCompletionTokens` 提到 2048（thinking 计入上限）；`deltaDiff` 全量 11 维 |
| P0-9 | **会话级串行队列与状态一致性**（WP65 ✅ 2026-11-05 · **仅队列化**） | 🔴 P0 | per-session mutex，防止并发写覆盖导致状态错乱（上线前必须解决的硬约束）。⚠️ 本单交付**队列化**那一半：影子审议改走 **BullMQ 队列**（`DeliberationProcessor` = Queue + Worker + 端口实现；`LlmDeliberationService` 降级为执行器 `executeShadowMode`），解决并发打爆上游 / 进程重启丢任务 / 没有可观测性；Worker 并发默认 3（env 可配），job 持久化在 Redis，**编排门面零改动**。⚠️ **per-session mutex + 快照版本号仍未做** —— 影子模式结果不写状态所以暂无覆盖风险，**切灰度前必须补**（[交付记录](../completed/phase2/engine-wp65-deliberation-shadow-queue-implementation-2026-11-05.md)） |
| P1-15 | **审议输出格式校验与重试**（WP66 ✅ 2026-11-05） | 🟡 P1 | **智能重试**：按错误类型分流 —— 形状类（JSON 没吐出来 / 形状不符 / SSE 解析失败）+ 上游限流与 5xx → 抛给 BullMQ 自动重试（`ENGINE_DELIBERATION_MAX_RETRIES` 默认 1 次）；鉴权 / 网络超时 / 代码 bug → 不重试；**先写 trace 再抛**（失败记录不丢），trace 加 `retryCount`；⚠️ zod schema 与 `response_format: json_object` 本期未做（改结构化出口影响 6 个调用方，建议单独一单）（[交付记录](../completed/phase2/engine-wp66-deliberation-format-retry-implementation-2026-11-05.md)） |
| P1-16 | **三级降级策略**（WP67 ✅ 2026-11-05 · **仅熔断器**） | 🟡 P1 | **会话级熔断器**：同一个会话连续失败 3 次 → 熔断（影子审议**不入队**，省一次入队 + 省一次 LLM 调用），冷却 10 分钟后半开放**一个**请求进去试；三态（closed/open/half-open）是**算出来的**不是存出来的；熔断写一条 `errorCode='circuit_open'` 的 trace（可观测）；阈值 / 冷却 env 可配（默认 3 次 / 600000ms）。⚠️ 母版三档里「超时跳过」与「切回规则算子」在影子模式下**天然成立**（审议结果从不生效，主流程永远走规则算子）；**`degraded: true` 会话打标仍未做**（[交付记录](../completed/phase2/engine-wp67-deliberation-circuit-breaker-implementation-2026-11-05.md)） |
| P2-9 | **意图锁定机制（基础版）**（WP68 ✅ 2026-11-05） | 🟢 P2 | 审议输出加**可选**的 `intentionShift`（LLM 建议切到哪个策略 + 理由，不需要就返回 null）；**影子期旁路模拟**锁定：锁定 N 轮内忽略 LLM 的切换建议，trace 里记下三方对比（规则算子选的 / LLM 建议的 / 锁定后实际生效的）；锁定轮数 `ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS` 默认 3（**工程种子值，非临床数字**，填 0 = 关掉锁定做对照实验）。⚠️ 母版里的**触发事件白名单未做**（PoC 阶段不做 —— NLP 级判断）；⚠️ 锁定逻辑放 **service 层**（trace 是 service 写的，锁定结果要进 trace 就必须先算好）；⚠️ 锁状态拆 `ruleStrategy` + `effectiveStrategy` 两字段（单字段写法在影子模式下会让锁永远不过期，把"拦住率"撑爆）（[交付记录](../completed/phase2/engine-wp68-deliberation-intention-lock-implementation-2026-11-05.md)） |

---

## 3. 依赖关系与推荐顺序

### 3.1 关键路径

```
P0-1 billing 接真支付
  └→ P0-2 会员分层 TTS
       └→ P0-3 TTS emotion 映射
       └→ P0-4 TTS 内联语气词标签

P1-1 人格调节算子
  └→ P1-4 咨询同盟三维

P1-2 渲染四手法
  └→ P1-3 表达风格渲染接入
```

### 3.2 推荐并行批次

**第一批（并行，不互相依赖）：**
- P0-1 billing 接真支付
- P0-5 WP11 回改正式值
- P0-6 数据分级留存与销毁
- P0-7 Admin Dashboard 切真 API
- P0-8 成本看板与告警
- P1-10 BDI 状态持久化

**第二批（第一批完成后）：**
- P0-2 会员分层 TTS（依赖 P0-1 会员体系）
- P1-1 P1 人格调节算子
- P1-2 渲染四手法
- P1-5 跨会话间隔自然衰减
- P1-6 记忆会话级摘要压缩
- P1-9 角色版本 semver
- P2 技术债清理（随时穿插）

**第三批（第二批完成后）：**
- P0-3 TTS emotion 映射
- P0-4 TTS 内联语气词标签
- P1-3 表达风格渲染接入
- P1-4 咨询同盟三维
- P1-7 评估引擎基础版
- P1-8 成长档案体系

---

## 4. 与 Phase1 的衔接

### 4.1 Phase1 已就位的基础

| 能力 | Phase1 交付 | Phase2 怎么用 |
|---|---|---|
| BDI 核心算子 | WP1（基础会谈事件、三维阻抗、移情、核心信念） | P1-1 在其上加人格调节算子 |
| 记忆 V1 | WP2（长时记忆 Qdrant + 召回） | P1-6 加会话级摘要压缩 |
| 轨迹三模式 | WP3（强覆盖 / 加权纠正 / 基线漂移） | P1-5 加跨会话衰减 |
| 伦理双层 | WP4（规则 + PsyGUARD） | P0-5 调优正式参数 |
| 渲染调度 | WP5（RenderPort 抽象 + LLM 适配） | P1-2/P1-3 加渲染四手法 |
| 流式 WS | WP8-B（SSE 流式 + 断连重连追平） | P1-7 旁路异步评估 |
| 角色池 | WP9 / WP10A（visitor_pool + character_profiles） | P1-9 加版本 semver |
| 长时记忆 | WP12（resume 链路通） | P1-5 加间隔衰减 |
| 可观测 | WP13（Prometheus 指标采集） | P0-8 加告警规则 |
| delta cap | WP15（单回合非对称 cap） | P2-1 加跨回合衰减/边际递减/饱和 |
| 断连重连 | WP23（catch-up/stale/reattached 三帧） | P1-10 状态持久化配合 |
| P2 全修 | WP26（34 条 P2 全修） | P2-1 清 P3 技术债 |

### 4.2 Phase2 开工前要确认的事

- [ ] 会员体系最终方案（5 档 DTO 已有，但具体几级、叫什么、对应哪个 TTS 模型）
- [ ] 微信支付 / 支付宝商户号申请状态
- [ ] 数据留存年限法务确认（不写死，待法务/等保确认）
- [ ] 真机听感测试环境（TTS emotion 映射需要真人校准）

---

## 5. 验收标准（Phase2 封版闸门）

### 5.1 商业化验收

- [ ] 用户可以在 App 内完成支付（微信/支付宝）
- [ ] 不同会员等级看到不同的 TTS 模型质量
- [ ] 用户可以删除自己的全部数据（对话 + 记忆 + 账号）
- [ ] 用户可以导出自己的数据
- [ ] Admin Dashboard 全部页面展示真实生产数据 —— ⚠️ **全部页面已切真 API**（WP30 + 四合一任务单 2026-11-05），但 **token / 轮次 / 成本受留痕开关约束**（生产缺省关留痕 → 恒 0，场次数准确）、**本场记忆恒空**、**PsyGUARD 真指标未采集**
- [ ] 成本看板能看到 token 消耗，超阈值能告警

### 5.2 专业能力验收

- [ ] 安全型依恋角色和回避型依恋角色，同一场景信任增量不同
- [ ] 高阻抗来访说话短、浅、硬，低阻抗来访自然倾诉
- [ ] 隔一周再回来，情绪/阻抗按半衰期回落
- [ ] 单会结束自动生成摘要，下次召回用摘要而非原始轮次
- [ ] 进程重启后 BDI 快照可恢复
- [ ] Admin Dashboard 能看到每轮 BDI delta trace 和 prompt 快照（调试面板）—— ✅ **后端接口就绪 + 前端接线已补**（WP58 ✅ 2026-11-05，前端随 WP31 提交 `8b9fa6f` 入库）；⚠️ **调试会话已落 JSON 文件**（刷新 / 重启不丢，2026-11-05 四合一任务单）；**"事件触发链 / cap 砍幅"仍未做**（内核不对外逐轮明细）
- [ ] 短期信念置信度随轮次衰减，核心信念有激活条件（不追求完整 BDI 推理循环）

### 5.3 工程验收

- [ ] 全部测试绿（Phase1 1252 例 + Phase2 新增用例）
- [ ] engine-core 边界断言不破坏（零 NestJS / 零网络 / 零 prompt）
- [ ] P3 技术债清零
- [ ] 文档全部回写（交付记录 + 路线图状态）

---

## 6. 参考文档

| 文档 | 路径 |
|---|---|
| 蓝图 V1.1（上游愿景） | [`docs/reference/ai-simulation-blueprint-v1.1.md`](../../reference/ai-simulation-blueprint-v1.1.md) |
| 路线图 V1.1（引擎方向母版） | [`docs/architecture/ai-engine-roadmap-v1.1.md`](../../architecture/ai-engine-roadmap-v1.1.md) |
| 混合式 BDI 架构蓝图（2026-11-05 新增） | [`docs/architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) |
| 微服务演进规划 | [`docs/architecture/microservices-evolution-plan.md`](../../architecture/microservices-evolution-plan.md) |
| Phase1 交付记录索引 | [`docs/worklog/completed/phase1/phase1-backlog-archived-2026-11-03.md`](../completed/phase1/phase1-backlog-archived-2026-11-03.md) |
| WP25 封版审查报告 | [`docs/worklog/audits/wp25-phase1-audit-report-2026-11-03.md`](../audits/wp25-phase1-audit-report-2026-11-03.md) |
| 团队规范 | [`docs/team/conventions.md`](../../team/conventions.md) |

---

_最后更新：2026-11-05（新增混合式 BDI PoC 组 WP63–WP68，基于 Coze 下线趋势判断的架构方向校准）_
_本文档是 Phase2 的总览入口，具体 WP 任务单开工时再单独写。_
