# WP38 · 角色版本 semver + 调试 trace 接引擎事件标签（后续单 D 并入） · 交付记录

> 日期：2026-11-06
> 任务单：[`wp38-character-semver-and-debug-event-tags-2026-11-06.md`](./wp38-character-semver-and-debug-event-tags-2026-11-06.md)
> 范围：① 角色版本 semver（major 进行中锁定 409 / minor 平滑 / patch 实时 + 历史版本快照可回溯 + 会话绑定版本）；② 调试 trace 接引擎事件分类真值（`eventTags`）
> 边界：engine-core **2 个文件**（预批准例外 —— 纯加只读观测字段，决策与数值逐字不变）

---

## 一、一句话

角色版本从「每次 update 自增一个 int」升级成 **semver 三元组**：

- **major（主版本）** = 进行中锁定 —— 还有活跃会话在用这个角色时，改主版本被拒（**409 / CharacterVersionLocked**）；
- **minor（次版本）** = 平滑 —— 随时可改；
- **patch（修订）** = 实时 —— 缺省档，文案 / 小参数微调走它；
- 每次改版留一份**完整快照**（新表 `character_profile_versions`），可回溯「这一版当时是怎么配的」；
- 会话创建时把**角色与版本**写进 `training_sessions`（`character_template_id` + `character_version`）。

调试 trace 这边：内核补了**只读事件出口**（`EngineTurnOutput.events`），适配层原样透传，
调试面板的 trace 带出 `eventTags`（数组）+ **后端权威中文标签**（覆盖内核全部 11 类事件）。

**engine-core 改了 2 个文件**（本单预批准例外）：只加可选观测字段，
**决策路径与数值逐字不变**（`boundary.spec.ts` 11 条断言全绿，公开面白名单零改动）。

---

## 二、做了什么

### 2.1 角色版本 semver：schema（一条迁移做完三件事）

新迁移 `src/migration/1714900000029-AddCharacterVersionSemver.ts`（手写 DDL + INFORMATION_SCHEMA 幂等守卫，同 0025/0027/0028 范式）：

| 对象 | 变更 | 说明 |
|---|---|---|
| `character_profiles` | 加 `version_major` / `version_minor` / `version_patch` | INT NOT NULL DEFAULT 1 / 0 / 0 —— 存量行加列后自动是 **1.0.0**，行为与加列前逐字一致（零回归） |
| `character_profile_versions` | **新表**（9 列 + 2 索引） | `id` / `template_id` / 三版本号 / `change_type` / `snapshot` JSON / `changed_by` / `created_at`；UNIQUE(template_id, 三版本号) + INDEX(template_id, created_at) |
| `training_sessions` | 加 `character_template_id` / `character_version` | VARCHAR(64) / VARCHAR(32)，均可空 —— 存量行是 NULL（**不回填**：回填等于伪造「当时用的是哪版」） |

**为什么必须同时加 `character_template_id`**（任务单 §3.1 只提了 `character_version`）：
任务单 §3.1 写「查 `training_sessions` 里 `character_template_id = ?` 判活跃会话」——
**该列当时并不存在**（角色只留在 `turn_debug_trace` 的 JSON 里）。照字面做会查不到：
主版本锁定无从判定（查什么？），会话存的版本也无从归属（谁的版本？）。所以两列一起加。

**部署顺序**：migration 必须先跑（entity 加了列 → 运行时读写会带上这些列 → 否则报 Unknown column）。

### 2.2 版本语义与「进行中锁定」

管理端 `PATCH /engine/admin/character-profiles/:templateId` 新增入参 `versionBump`（`major` / `minor` / `patch`，**缺省 patch**）：

- 每次更新按此档位递增 semver（`major` → M+1.0.0 / `minor` → M.m+1.0 / `patch` → M.m.p+1），并把**变更后**的完整行存一份历史快照；
- `major` 档先查活跃会话：`training_sessions` 里 `character_template_id = ?` 且 `ended_at IS NULL` 且 `deleted_at IS NULL`（= **还没结束**）→ 有则拒绝，抛 `BizCode.CharacterVersionLocked` → HTTP **409**；
- `minor` / `patch` 档**随时可改**（锁定只针对主版本）。

**409 业务码**：仓库 `BizCode` 原本没有 Conflict 段（通用 1xxx / 鉴权 11xxx / 各业务段 26xxx–48xxx）。
新增 `CharacterVersionLocked = 49_001`（角色资产池段）并归进 `CONFLICT_CODES` ——
因为「现在不能改，等一下就行」与「你参数填错了」是**两件事**，前端要能分开提示。

### 2.3 历史版本表与回溯端点

新表 `character_profile_versions`（append-only 的版本事实）：

- **快照形状独立于 `character_profiles`**（`CharacterProfileSnapshot` 冻结类型）—— 快照记的是「某个时刻的内容」，若直接引用实体字段，实体以后加一列，老快照记的就不再是「当时的样子」了；
- 快照**不含**时间戳 / 软删位 / int 计数列 —— 那些是「行」的属性，不是「这一版的内容」；
- `change_type`：`create`（首版）/ `major` / `minor` / `patch`；`changed_by` 记变更人 id（取 JWT 的 `userId`）；
- 主键由 `(template_id + 版本号)` 内容派生 → 同一版重复写是**幂等覆盖**，不会出第二行。

新增两个管理端端点（挂在既有 `CharacterProfileAdminController`，class 级 `JwtAuthGuard + AdminRoleGuard` 自动继承）：

| 端点 | 用途 |
|---|---|
| `GET /engine/admin/character-profiles/:templateId/versions` | 历史版本列表（按版本号从新到旧） |
| `GET /engine/admin/character-profiles/:templateId/versions/:major/:minor/:patch` | 某一版的完整快照（回溯读取） |

### 2.4 会话绑定版本（跨层插槽）

`training_sessions` 的两列由 **vpt 语音会话落库桥**（`VptSessionBridgeService.open()`）写入：
建会话那一刻读**实时**版本号（角色刚被改过，这里读到的就是新值），读不到就写 NULL，**不阻断建会话**。

**跨层怎么走**：角色版本在 `character_profiles`（引擎侧表），要写进 `training_sessions`（咨询业务域表），
而 engine → counselor 是仓库**明令禁止的反向依赖**（见 `student-risk-audit-slot.ts` 的同款说明）。
于是走仓库既有的 **voice 层 @Global 插槽**范式（本单新增 2 个）：

| 插槽 | 数据持有方（注册实现） | 消费方 | 方向 |
|---|---|---|---|
| `CharacterVersionRegistry` | engine-adapters（`CharacterVersionService` 读 `character_profiles`） | counselor（vpt 落库桥写 `training_sessions`） | engine → business |
| `CharacterUsageRegistry` | counselor（`CharacterUsageService` 数 `training_sessions` 活跃会话） | engine-adapters（管理服务判主版本锁定） | business → engine |

两个插槽都在 `src/voice/`，注册进 `@Global` 的 `VoiceSessionModule` —— 与 `VoiceTemplateRegistry` / `StudentRiskAuditRegistry` 同款。

### 2.5 调试 trace 接引擎事件标签（内核只读出口）

**方案 A**（内核加只读出口）落地，4 步：

1. `src/engine-core/domain/engine-session.types.ts` —— `EngineTurnOutput` 加 `readonly events?: readonly CounselorEventKind[]`；
2. `src/engine-core/in-memory/in-memory-engine-session.ts` —— `turn()` 把**已经算出来的** `events.map((e) => e.kind)` 填进出参（空则不挂，零回归）；
3. `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— `TurnRenderResult` 透传（`turn()` / `turnStream()` / `blockedResult()` 三个返回点）；
4. `src/admin-debug/debug-session.service.ts` —— 读进 trace 的 `eventTags` + `eventTagLabels`。

**内核为什么自己填（而不是适配层预判）**：事件分类是内核的**唯一真相**（状态迁移 / delta 聚合 / 意图规划全都吃它）；
适配层另算一套就会与内核漂移，而调试面板的职责恰恰是「看内核到底怎么判」—— 预判出来的标签会骗人。

**中文标签映射**（新文件 `src/admin-debug/event-tag-labels.ts`）：内核 `CounselorEventKind` 有 **11** 类，
而调试面板（`admin-dashboard/src/views/DebugChat.vue`）那份手写映射只有 8 个键 ——
**缺的 7 个**（`acceptance` / `affirmation` / `judgment` / `preaching` / `minimizing` / `boundary_cross` / `sensitive_touch`）
面板上会直接显示英文原值；**多的 3 个**（`micro_expression` / `emotion_reflection` / `open_discussion`）**内核根本不产**（模型轨的旧占位名）。
两份映射各抄一半 = 标签既不全也不准 → 映射的唯一真相在后端，前端按序取用 `eventTagLabels` 即可。

顺带把 `deltaDetail.events` 从「恒为空数组」改成**填真值**（此前那条注释写着「事件明细是内核内部产物，适配层拿不到」—— 现在能拿到了，
继续留着就是给下一个人的假话）。

---

## 三、偏差表

| # | 任务单写的 | 实际做的 | 理由 |
|---|---|---|---|
| B1 | §3.1：「查 `training_sessions` 里 `character_template_id = ?` 判活跃会话」 | **该列当时不存在**，本单**同时加** `character_template_id` + `character_version` 两列 | 任务单的前提与代码现状不符（角色只在 `turn_debug_trace` 的 JSON 里）。不加前者，主版本锁定查什么？版本号又归属谁？—— 补齐后任务单的口径才成立 |
| B2 | §1.1：「管理员改了角色参数，旧会话会**突然变味**」 | 该现象在**现架构下不成立** —— 角色基线只在 `openSession` 解析一次，注入内核后钉在开场，改 DB 不影响进行中的会话 | 核实结论必须诚实写出来：major 锁定因此是**防御性**的（保护续场 re-resolve 与督导口径可比），patch 的「实时生效」在现架构下也做不到（不会影响进行中会话）。**没把不成立的动机写成已实现的收益** |
| B3 | §2.1 验收：「改 major 会被拒绝（返回 409）」 | 新增 `BizCode.CharacterVersionLocked = 49_001` 并归入 `CONFLICT_CODES` | 仓库 `BizCode` **没有 Conflict 码**（通用 1xxx / 鉴权 11xxx / 各业务段 26xxx–48xxx）。复用通用 1001 会让前端把「等会话结束再改」显示成「你参数填错了」 |
| B4 | §2.1：「`character_profiles` 加 major/minor/patch 三列」 | 三列**加**了；旧的 int `version` 列**保留但不再当真相源** | 旧列有既有对外契约与既有单测依赖（`version` 每次 update +1），直接删是破坏性变更。已在实体注释写明它是「修改计数」而非版本真相源，并让所有版本判定一律读三列 |
| B5 | §2.1：「每次更新都存一份快照」 | **每次更新都递增版本 + 都存快照**（缺省 patch） | 任务单没规定「哪些更新算版本变更」。按「调用方声明意图」最简单可预测：运营在改内容时自己说这是 major / minor / patch。若改成「只内容字段变才算」，就得先定义「哪些字段算内容」—— 那是另一套口径，且会与「调用方声明」的意图冲突 |
| B6 | §2.1 第 4 条：「会话创建时绑定版本」 | 经 **voice 层 @Global 插槽**实现（engine ↔ counselor 双向走插槽） | engine → counselor 是仓库明令禁止的反向依赖（`student-risk-audit-slot.ts` 已记这条纪律）。voice 层是两侧都能站的位置，仓库已有 4 个同款插槽 |
| B7 | §五 第 1 问：major 锁定粒度 | **有活跃会话（`ended_at IS NULL`）才锁**；已结束的不锁 | 按任务单自带建议执行（假设已记）。「活跃」= 还没结束 —— 已聊完的会话不影响改定位 |
| B8 | §五 第 2 问：历史版本保留策略 | **保留所有**（不做 N 截断） | 按任务单自带建议执行（假设已记）。单人开发阶段数据量不大 |
| B9 | §5.1：「旧会话继续用旧版本角色」 | 架构上**本就成立**（resolver 只在开场解析一次），本单补的是**可追溯**（记下当时是哪一版） | 不夸大：绑定版本列不改变会话行为，它让「这场用的是哪一版」**可查** |
| B10 | §2.2 第 4 步：「读进 trace 的 `eventTags`（并给中文标签映射）」 | `eventTags`（原始 kind 数组）+ `eventTagLabels`（同序中文）**两个字段** | 只给 kind 数组的话前端还得自己补映射（而前端那份映射缺 7 个、多 3 个 —— 等于把坑留着）。两个字段一起给，前端零成本切换 |
| B11 | §三「前端接线」 | **不碰前端**（AGENTS.md 硬约束） | 后端出数据 + 契约，前端接线归前端 AI（见 §八） |
| B12 | §三「边界：engine-core 2 个文件（预批准例外）」 | 改 2 个文件，**但连带改了 1 个既有内核单测断言**（`test/engine-core/wp5-rendering.spec.ts` 的「turn 出参字段集合逐字一致」） | WP5 那条断言钉的是「出参字段集合 = WP4 的 4 个」，WP38 加了 `events` 后集合变成 5 个 → 断言必红。该断言的**本意**是「没有多出任何**渲染相关**字段」（下面两行 `render` / `renderResult` 仍 undefined 继续盯着）—— 于是只把期望清单 +1 并改标题（「无新增字段」→「无渲染相关字段」），**没有删断言、没有放宽成模糊匹配**。边界断言 `boundary.spec.ts` 11 条**一条未动** |

---

## 四、改动文件清单

### 4.1 engine-core（预批准例外 · 2 个文件）

| 文件 | 改什么 |
|---|---|
| `src/engine-core/domain/engine-session.types.ts` | `EngineTurnOutput` 加 `readonly events?: readonly CounselorEventKind[]`（只读观测字段） |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | `turn()` 出参填 `events`（内核自己算的 kind，空则不挂） |

### 4.2 新增文件（10 个）

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/wiring/character/character-version.ts` | semver 纯工具（格式化 / 解析 / 递增）+ `CharacterVersionBump` / `CharacterVersionChangeType` 类型 |
| `src/engine-adapters/wiring/character/character-profile-version.entity.ts` | `character_profile_versions` 实体 + 冻结的快照类型 `CharacterProfileSnapshot` |
| `src/engine-adapters/wiring/character/character-version.service.ts` | 角色版本查询实现（读主表 → 注册进 voice 插槽） |
| `src/voice/character-version-slot.ts` | voice 层插槽：角色版本查询 |
| `src/voice/character-usage-slot.ts` | voice 层插槽：角色占用（活跃会话数）查询 |
| `src/counselor/providers/character-usage.service.ts` | 角色占用查询实现（数 `training_sessions` 活跃会话 → 注册进 voice 插槽） |
| `src/admin-debug/event-tag-labels.ts` | 事件分类 → 中文标签的**权威映射**（11 类全覆盖） |
| `src/migration/1714900000029-AddCharacterVersionSemver.ts` | 手写 DDL 迁移（三件事一条做完） |
| `test/engine-adapters/wp38-character-version-semver.spec.ts` | 角色版本 semver 单测 |
| `test/admin-debug/wp38-debug-event-tags.spec.ts` | 调试 trace eventTags 单测 |

### 4.3 改动文件（既有）

| 文件 | 改什么 |
|---|---|
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | `TurnRenderResult` 加 `events?`；三个返回点原样透传 |
| `src/admin-debug/debug-session.service.ts` | trace 加 `eventTags` / `eventTagLabels`；`deltaDetail.events` 填真值 |
| `src/engine-adapters/wiring/character/character-profile.entity.ts` | 加三列 semver；旧 `version` 列注释改成「修改计数，非真相源」 |
| `src/engine-adapters/wiring/character/character-profile.admin.service.ts` | 版本递增 / 主版本锁定 / 快照留痕 / 历史查询；字段拷贝抽成 `applyContentUpdates`（降复杂度） |
| `src/engine-adapters/wiring/character/character-profile.admin.controller.ts` | 2 个历史端点；`update` 带 `changedBy`；路径参数版本号校验 |
| `src/engine-adapters/wiring/character/character-profile.dto.ts` | `versionBump` 入参 + 版本出参 + 历史版本出参 DTO |
| `src/engine-adapters/wiring/character/character-pool.module.ts` | 注册新实体 + `CharacterVersionService` + 显式 import `VoiceSessionModule` |
| `src/counselor/entities/training-session.entity.ts` | 加 `characterTemplateId` / `characterVersion` 两列 |
| `src/counselor/providers/vpt-session-bridge.service.ts` | `open()` 绑定角色与版本 |
| `src/counselor/counselor.module.ts` | 注册 `CharacterUsageService` |
| `src/voice/voice-session.module.ts` | 注册 2 个新插槽 |
| `src/common/exceptions/biz-code.enum.ts` | 新增 `CharacterVersionLocked = 49_001` |
| `src/common/exceptions/biz.exception.ts` | 归入 `CONFLICT_CODES`（409）+ 默认文案 |
| `src/migration/index.ts` / `bin/ormconfig.ts` | 迁移登记（严格 1:1） |
| `test/engine-adapters/wp9b-character-admin.spec.ts` | 脚手架补版本快照仓储（管理服务多了第二个依赖） |
| `test/engine-core/wp5-rendering.spec.ts` | 「turn 出参字段集合逐字一致」断言的期望清单 +1（`events`）—— 见偏差表 B12（**没删断言、没放宽匹配**） |

---

## 五、闸门数字（本单实跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| lint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error** ✅ |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| WP38 新增单测 | `npx vitest run test/engine-adapters/wp38-character-version-semver.spec.ts test/admin-debug/wp38-debug-event-tags.spec.ts` | **29 例全绿（2 文件：semver 21 + eventTags 8）** ✅ |
| WP9-B 回归 | `npx vitest run test/engine-adapters/wp9b-character-admin.spec.ts` | **13 例全绿** ✅ |
| 全量单测 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **118 文件 / 2000 例全绿** ✅ |
| **engine-core 红线** | `git diff --stat HEAD -- src/engine-core` | **恰好 2 个文件**（预批准例外清单内） ✅ |

---

## 六、验收逐条

### 6.1 角色版本 semver（任务单 §2.1）

- [x] `character_profiles` 有 `major` / `minor` / `patch` 三列（出参 `versionMajor` / `versionMinor` / `versionPatch` / `versionLabel` 可见）
- [x] 有会话正在用某角色时，改 major 被拒绝（**409 / CharacterVersionLocked**）
- [x] `character_profile_versions` 表存历史版本（**每次更新都存一份**，含首版 `create` 档）
- [x] `training_sessions` 有 `character_version` 字段（+ `character_template_id`），会话创建时绑定
- [x] 旧会话继续用旧版本角色（架构本就成立；本单补的是**可追溯**：记下当时是哪一版）

### 6.2 调试 trace 接事件标签（任务单 §2.2）

- [x] `EngineTurnOutput` 有 `events?: readonly CounselorEventKind[]` 可选字段
- [x] 内核 `turn()` 真的填了这个字段（有事件时非空；未命中类别时是 `neutral`）
- [x] 调试 trace 里有 `eventTags: string[]`（+ `eventTagLabels` 中文同序）
- [x] `boundary.spec.ts` 11 条断言全绿
- [x] engine-core 只改 2 个文件（`engine-session.types.ts` + `in-memory-engine-session.ts`）

---

## 七、遗留 / 后续项

1. **回溯只做读取，没做「一键回滚」** —— 本单给的是「看回某一版当时怎么配的」（列表 + 单版详情）；
   「把这一版写回当前」是**写操作**，会触发版本递增与快照，需要单独的口径（回滚算 patch 还是 minor？回滚要不要走 major 锁定？），本单**不做**。
2. **迁移前的老会话 `character_version` 是 NULL** —— 不回填（回填等于伪造当时用的是哪版）。
   主版本锁定因此**只覆盖迁移后开始的会话**（零回归）。
3. **「patch 实时生效」在现架构下做不到** —— resolver 只在 `openSession` 解析一次，改角色不影响进行中的会话。
   真要做「实时生效」，得让 resolver 在每轮重解析（那是性能与状态一致性的另一件事，不属本单）。
4. **主版本锁定判定 fail-open** —— 占用插槽没人应答时（判不出来 ≠ 0 场）**放行 + 告警**，不硬挡运营操作；
   理由：把「查不到」当成「没人用」会让锁定静默失效，而硬挡又会在基础设施抖动时卡死管理操作。
5. **admin-dashboard 前端接线未做**（归前端 AI，见 §八）。

---

## 八、前端接线说明（归前端 AI）

1. **调试面板事件标签**：`trace.eventTags`（原始 kind 数组）+ `trace.eventTagLabels`（同序中文）**两个字段都给了** ——
   `DebugChat.vue` 里那份 `eventTagMap` 只有 8 个键，**缺 7 个内核真实事件、多 3 个内核不产的占位名**；
   建议直接用后端给的 `eventTagLabels`（后端映射是唯一真相，覆盖内核全部 11 类）。
   ⚠️ 另注：`DebugChat.vue` 里 `trace.eventTags` 被**同时**当数组（`eventTagList`）和对象（`innerStateCards` / 模板的 `eventTags.rationale`）用，
   本单后端契约是**数组** —— 那几处对象用法是旧 mock 残留，需前端一并收敛。
2. **角色版本 semver 的前端展示**（任务单 §五 第 3 问，归前端）：
   `GET /engine/admin/character-profiles` 的出参多了 `versionMajor` / `versionMinor` / `versionPatch` / `versionLabel`；
   `PATCH` 入参多了 `versionBump`（`major` / `minor` / `patch`，缺省 patch）；
   历史回溯两个端点：`GET /engine/admin/character-profiles/:templateId/versions` 与
   `GET /engine/admin/character-profiles/:templateId/versions/:major/:minor/:patch`。
3. **409 的处理**：`CharacterVersionLocked` 会以 HTTP 409 + `{ code: 49001 }` 返回 —— 前端要提示「还有会话在用，等结束再改」，
   而不是「请求参数错了」。

---

## 九、补做（2026-11-06 · 审核后追加）：调试会话恢复能力

> **审核意见**：WP38 本体 94/100，前两件事做得好；**第三件事漏了** —— 调试会话恢复能力完全没做，
> 也没登记成后续单。本节记录补做内容。
>
> **需求出处复核**（按 AGENTS.md「任务单与代码不符时先 grep 核实」）：WP38 任务单正文**并无** §2.3；
> 「调试会话跑完就丢 / 进程重启后丢失」这条实际写在 **WP58 任务单 D1** 与
> **2026-11-05 Admin Dashboard 四合一任务单 §5.1 / §5.2**（见
> `completed/phase2/admin-dashboard-mock-to-real-and-debug-session-persistence-2026-11-05.md`）。
> 本次按**验收标准原文**（内核状态快照 + resume 接口 + 重启后可继续 + BDI 状态一致）实现，
> **不新造 WP 编号**（作为 WP38 的补做项落账）。

### 9.1 一句话

调试会话每轮把「内核状态快照」（BDI 快照 + 记忆条目 + 轨迹块）写进**持久化文件**，
新增 `POST /admin/api/debug/session/:id/resume` 从快照重建内核句柄 ——
后端重启后能接着聊，而且**从最后一轮的状态继续**（不是从头开始）。

### 9.2 做了什么

**① 内核状态快照落盘**（每轮覆盖一次）

`DebugSessionRecord` 新增 `kernelState` 字段（`data/debug-sessions/{id}.json` 里）：

| 块 | 内容 | 来源 |
|---|---|---|
| `snapshot` | 完整 BDI 快照（信任 / 安全感 / 纽带 / 情绪 / 阻抗 / 信念 / 愿望） | 内核本轮出参（`EngineTurnOutput.snapshot`） |
| `revision` | BDI 状态版本号（乐观锁） | 服务侧逐轮 +1（与内核的落库版本同节奏） |
| `turnIndex` | 快照对应的轮次 | 会话累计轮次 |
| `memories` | 记忆条目（咨询师半边 + 来访者半边，带确定性 id） | 本轮对话（降级轮的来访者半边**不记**） |
| `trajectory` | 轨迹节点（剧本走到哪一幕） | 内核轨迹观测（调试会话**不注入剧本** → 恒为 `null`） |

**② 恢复接口**

`POST /admin/api/debug/session/:id/resume` → 从持久化快照重建内核句柄，
返回恢复结果（`resumed / alreadyActive / turnIndex / turnCount / restored{...}`）。
失败一律**如实报错**：会话不存在 → 404；没有可恢复的快照 / 角色没了 → 400；
状态回灌异常 → 500（带明确文案）。**绝不**静默建一场中性新会话
（那会让调试者以为「恢复好了」，实际是从头开始）。

**③ 回灌三步（顺序不能换）**

1. **回灌内核状态**：BDI 快照 → BDI 状态仓储；记忆条目 → 记忆仓储。
   必须**先于**开会话 —— 内核在**第一轮**才去状态仓储取状态，回灌晚了第一轮就会用中性初始快照。
2. **开内核句柄**：同一个 `sessionId`（状态仓储按 `sessionId` 取）。
3. **还原渲染上下文**：把快照里的记忆条目还原成引擎的渲染上下文 ——
   否则恢复后的第一轮发给模型的是**空上下文**，来访者会像第一次见面那样反应。

### 9.3 关键设计决策

1. **快照落「文件」而不是只靠 Redis**：
   BDI 状态的 Redis 形态是**部署选择**（`ENGINE_BDI_STATE_STORE` 缺省 = 内存版）——
   只靠 Redis 恢复不了**默认部署**；而调试会话本来就有自己的 JSON 文件，
   把快照放进同一份文件，恢复能力**不依赖任何额外基础设施**（把文件拷到另一台机器也能恢复）。
2. **BDI 状态仓储单例化**（新增 `ENGINE_BDI_STATE_REPOSITORY` token）：
   内核会话与恢复器必须读写**同一个**仓储实例 —— 两个实例 = 两个真相
   （恢复器写进去的快照，内核那一侧读不到），恢复功能会**静默失效**
   （接口返回成功，但恢复出来的状态对不上）。所以把 `createBdiStateRepository`
   从 `ENGINE_SESSION_PORT` 的工厂里**提出来**成独立 provider 并导出。
3. **面板轮次用「会话累计轮次」，不用内核轮次**：
   恢复后内核句柄是新的 → 内核轮次从头算起（1,2,3…），而面板要回答「这是第几轮」——
   恢复后必须**接着上一轮往下数**（4,5,6…）。全新会话时两者恒等，**老路径逐字无影响**。
   ⚠️ 审议 trace 的 Redis key 仍用**内核轮次**（审议侧写的也是内核轮次，两边用同一个数 key 才对得上）。
4. **记忆条目与渲染上下文同源**：引擎写进记忆仓储的，正是上一轮说过的话 ——
   一份条目兼两个职责（回灌记忆 + 还原上下文）；两处口径若分叉，
   恢复出来的会话就会「记忆里有、上下文里没有」（或反过来）。
5. **降级轮的来访者半边不记**：兜底句不是来访者真说的话
   （喂回模型等于教模型输出兜底话术）—— 与编排层落账逐字同源。
6. **记忆 id 确定性**（`{sessionId}:{turnIndex}:{role}`）：重复点「继续调试」不会写出两条一样的记忆
   （仓储「同 id 后写为准」= 幂等）。
7. **不覆盖仓储里更新的状态**：内核**先落库、后落文件** → 仓储里的状态比文件新（那是活着的真相）；
   只有「仓储里没有」或「仓储里的版本更旧」才写回文件快照。
8. **engine-core 零改动**：本单在内核 diff 上仍是 WP38 那 2 个文件（本单 **+0 行**）。

### 9.4 偏差表（B13–B18）

| # | 偏差 | 理由 |
|---|---|---|
| B13 | 需求出处不是 WP38 §2.3（该节不存在） | 实际出处是 WP58 任务单 D1 + 2026-11-05 四合一任务单 §5.1/§5.2；按验收标准原文实现，**不新造 WP 编号**（作为 WP38 补做落账） |
| B14 | 快照落**文件**（不是只靠 Redis 状态仓储） | Redis 形态是部署选择（缺省内存版）→ 只靠 Redis 恢复不了默认部署；调试会话本就有 JSON 文件 → 恢复不依赖额外基础设施（见 9.3-1） |
| B15 | 恢复后**内核轮次从头算起**（内核句柄是新的） | 内核无「设初始轮次」的入口（改它要动内核 = 破红线）。面板改用「会话累计轮次」；**代价**：恢复后第 1 轮的审议 trace Redis key 与重启前的第 1 轮**重号**（旧的第 1 轮审议 trace 在 Redis 里被覆盖 —— 文件里那份历史 trace 不受影响，面板读的是文件） |
| B16 | 内核**工作窗口**（`runtime.workingWindow`）**恢复不了** | 它没有对外的写入口（`workingContext()` 只读且不在端口契约里），要恢复得动内核 → 本单不做；改用**渲染上下文**还原（那才是真正进 prompt 的对话上下文） |
| B17 | 恢复后的会话**不携带 openingContext**（跨会话召回） | 内核那条路径要求 `resumeFromSessionId` + 长时记忆 + 单一来访者 id；而调试会话所有场次共用 `debug-admin` 这个来访者 id，强行复用会把**别的调试场次**的记忆带进来 → 明确不做 |
| B18 | 快照缺失 / 角色没了 → **400 明确报错** | 不静默降级成「从头开始」的新会话（那等于骗调试者） |

### 9.5 改动文件清单（本单）

**新增（2 个）**

| 文件 | 作用 |
|---|---|
| `src/admin-debug/debug-kernel-state.ts` | 内核状态快照的形状 + 构造 / 解析 + **回灌器**（`DebugKernelStateRestorer`） |
| `test/admin-debug/wp38-debug-session-resume.spec.ts` | 恢复能力单测（10 例：落盘 / 端点 / 重启恢复 / 如实报错 / BDI 一致性） |

**改动（10 个）**

| 文件 | 改了什么 |
|---|---|
| `src/admin-debug/debug-session-store.ts` | 记录加 `kernelState` 字段；每轮**覆盖**写入；新增 `markActive`（恢复后把文件状态改回 active） |
| `src/admin-debug/debug-session.service.ts` | 每轮构造内核快照并落盘；新增 `resumeSession`；轮次基线改为「会话累计轮次」；摘要/详情带 `resumable` |
| `src/admin-debug/debug-session.controller.ts` | 新增 `POST session/:id/resume` |
| `src/admin-debug/admin-debug-chat.module.ts` | 装配回灌器（依赖引擎装配层导出的两个端口） |
| `src/engine-adapters/wiring/engine.tokens.ts` | 新增 `ENGINE_BDI_STATE_REPOSITORY` token |
| `src/engine-adapters/wiring/engine.module.ts` | BDI 状态仓储提为独立 provider（**单例**）并导出；导出 `ENGINE_MEMORY_STORE` |
| `src/engine-adapters/wiring/engine-turn.service.ts` | 新增 `restoreRenderContext`（门面转发） |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | 新增 `restoreHistory`（预置句柄的渲染上下文） |
| `test/admin-debug/{wp58,wp69,wp38-debug-event-tags,debug-session-persistence}.spec.ts` | 服务构造加第 7 个依赖；会话摘要加 `resumable` |

### 9.6 闸门数字（本单实跑）

| 闸门 | 结果 |
|---|---|
| `npx eslint "{src,test,bin}/**/*.ts"` | **0 error** |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error** |
| `npx vitest run --exclude "**/e2e/**/*.ts"` | **119 文件 / 2010 例全绿** |
| `git diff --stat HEAD -- src/engine-core` | **仍是 2 个文件**（WP38 那两个：+17/+14）—— 本单内核 **+0 行** |

> ⚠️ 全量首轮曾出现 1 例偶发红（`test/counselor/wp21-report-stream.spec.ts` 的 SSE 轮询超时用例）——
> 单跑绿、全量红，属仓库既有的**时序 flaky**（该仓多处单测注释里都记着「全量并行抢 CPU → 固定拍数等不起」）；
> 重跑全量即绿。**与本单改动无因果关系**（该用例不碰 admin-debug / engine-adapters）。

### 9.7 验收逐条

- [x] 调试会话每轮结束后，持久化文件里有内核状态快照（BDI + 记忆 + 轨迹块）
- [x] 有 `POST /admin/api/debug/session/:id/resume` 接口，传入 sessionId 能恢复会话
- [x] 后端重启后，调 resume 接口能恢复会话，**继续发消息**（轮次接着往下数）
- [x] 恢复后的会话，**BDI 状态与最后一轮一致**（真内核断言：恢复后的第一轮 = 恢复出的基线 + 与基线相同的增量，
      且 ≠ 中性基线的结果）
- [x] 失败如实报错（404 / 400），不静默建中性新会话
- [x] engine-core 零改动（内核 diff 仍是 WP38 那 2 个文件）

### 9.8 前端接线说明（归前端 AI）

1. **「继续调试」按钮的显示条件**：会话列表每行新增 `resumable` 字段 ——
   **`active === false && resumable === true`** 时才显示「继续调试」按钮。
   （`resumable === false` = 这场会话从没跑过一轮 → 没有内核状态快照 → 恢复不了，点了只会 400。）
2. **点击后**：`POST /admin/api/debug/session/:id/resume`（无 body）。
   成功后把该行本地置 `active = true` 即可继续发消息，**不必刷新页面** ——
   后端恢复后 `GET /admin/api/debug/sessions` 返回的 `active` 本来就会变成 true。
3. **返回体**：
   `{ sessionId, debugSessionId, resumed, alreadyActive, turnIndex, turnCount, characterSlug, characterLabel,
   restored: { snapshot, memories, contextTurns, trajectory } }`
   —— `resumed === false && alreadyActive === true` 表示「这场本来就在跑」（重复点击的幂等返回，不是错误）。
4. **失败文案**：
   404（会话不存在）/ 400（没有可恢复的快照、角色已删）→ 如实提示，别静默。
5. **详情接口** `GET /admin/api/debug/sessions/:id` 也带 `resumable`（同一口径）。

