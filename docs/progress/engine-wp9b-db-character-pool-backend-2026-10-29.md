# WP9-B · MySQL 角色资产池（5Ps 落库 + 真实 vpt slug 命中）后端任务单

> 母版: [`ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) ｜ 进度: [`phase1-integration-backlog-2026-10-28.md`](./phase1-integration-backlog-2026-10-28.md)
> 前置: [WP9-A 内置种子注入（已交付审核通过）](./engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 起草: 2026-10-29
> 性质: 行为化任务单。成功/失败/边界验收写死；闸门命令由后端在 Windows PowerShell 跑；**不落后端 src 实现细节，只定边界与验收**。

---

## 0. 这一轮解决什么（一句话）

把 WP9-A 抽好的 `CharacterProfileResolver` 端口，从"内置硬编码种子"换成"读 MySQL 5Ps 角色表"，并让**真实握手的 `vpt_*` slug 真正命中角色**（WP9-A 命中率为 0 的已知缺口在这一轮闭合）。注入点 `EngineStreamBackend`、voice 窄接口、`engine-core` **整树零改动**。

## 1. 边界（做什么 / 不做什么）

### 做
1. 新建 `character_profiles` 表：5Ps 专业文本 + 内核基线数值 + 结构化心理要素 JSON + 审核/上下架状态。
2. 实现 `DbCharacterProfileResolver implements CharacterProfileResolver`（WP9-A 已定义端口），在 `engine.module.ts` 切换绑定。
3. 首批 **3–5 个**真实 `vpt_*` slug 的角色种子行（与 `visitor_pool_templates.id` 对齐）。
4. 解析口径闭合：真实 `vpt_*` slug → 命中已审核角色 → 注入非中性基线；查不到/未审核/下架 → 回退中性 + warn（与 WP9-A 同边界，不抛错）。
5. 角色 CRUD / 上下架管理端点（内部 admin，非 UGC）。

### 不做（明确划走，别顺手做）
- **渲染 prompt 吃 coreBeliefs / sensitiveTopics**：那是"渲染四手法"（Phase2，backlog 已列）。本轮角色只影响**数值基线与 forbiddenBehaviors 约束**，不改变来访说话口吻。
- **UGC 提交-审核-分成流、多租户、角色 semver 版本迁移**：Phase2。
- **非语言/沉默节奏、同盟三维、间隔衰减**：Phase2。
- **不删旧 `src/agent/visitor` 链路**：那是"旧链路退役"任务（M2 + WP17 绿后），本轮保留灰度回退。
- **不改 `visitor_pool_templates` 表结构**：速查卡字段（codename/age_range/presenting_complaint）继续由 voice 层从该表读，本轮不重复造。

## 2. 现状关键事实（已核实，照此设计，别另起）

- `visitor_pool_templates` 已存在：`id`（varchar 64，即 `vpt_*` slug）、`codename`、`age_range`、`presenting_complaint`、`defense_type`、`issue_domain`、`difficulty`、`style_hint`、`emotion_baseline_default`、`defense_level_default`、`script`(JSON 7 块)、`enabled`。**速查卡与 preset 默认值都在这张表**。
- WP9-A 已有纯函数 `buildCharacterProfile(seed, preset)`（`src/engine-adapters/wiring/character/builtin-character-registry.ts`），把"种子形状 + 临场 preset"映射成内核 `CharacterProfile`，含 clamp01、transference 全零、emotion 不手填 label。**本轮必须复用它，不写第二份映射**。
- 仓库 migration 范式：手写 DDL、`up`/`down` 成对、幂等（`SHOW COLUMNS` 守卫）、禁 `synchronize`、不加 DB-level FK（ADR-0003，跨表引用应用层校验）、system 表不落 `tenant_id`、软删手写 `deletedAt IS NULL`。
- 端口 `CharacterProfileResolver.resolve({templateId, skillCode, preset})` 已冻结，本轮**不改签名**。

## 3. 数据模型（`character_profiles`）

新表，system 级（无 tenant_id）。逻辑外键 `template_id` 关联 `visitor_pool_templates.id`，**不加 DB FK**。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | CHAR(36) PK | 内部主键 |
| `template_id` | VARCHAR(64) NOT NULL, **UNIQUE** | 关联 `visitor_pool_templates.id`（`vpt_*` slug）；一个模板一份角色基线 |
| `display_name` | VARCHAR(100) NOT NULL | **冗余 = 对应模板 codename**（如"晚晴"），让 resolver 返回的展示名与 voice 层速查卡一致，不再出现"引擎叫回避依恋·L1、速查卡叫晚晴" |
| `attachment_style` | VARCHAR(20) NOT NULL | secure/avoidant/anxious/disorganized |
| `five_ps` | JSON NOT NULL | 5Ps 专业长文（presenting/precipitating/maintaining/protective/vulnerability），供专业评审与报告，**不进内核决策** |
| `baseline_trust` | FLOAT NOT NULL DEFAULT 0.3 | 初始信任 [0,1] |
| `baseline_resistance_verbal/depth/style` | FLOAT NOT NULL | 三维阻抗 [0,1] |
| `baseline_emotion_valence` | FLOAT NOT NULL | [-1,1] |
| `baseline_emotion_arousal` | FLOAT NOT NULL | [0,1] |
| `core_beliefs` | JSON NOT NULL | `[{theme, statement, activationTags[]}]`，第一人称，永久不可变 |
| `underlying_desires` | JSON NOT NULL | `[{key, label, baselineWeight}]` |
| `forbidden_behaviors` | JSON NOT NULL | string[]，透传内核意图规划，**不作风险信号** |
| `sensitive_topics` | JSON NOT NULL | string[]，命中触发 sensitive_touch |
| `audit_status` | VARCHAR(20) NOT NULL DEFAULT `draft` | draft / approved / rejected；**只有 approved 可被 resolver 命中** |
| `enabled` | TINYINT(1) NOT NULL DEFAULT 1 | 上下架；下架即不可命中 |
| `version` | INT NOT NULL DEFAULT 1 | 预留（版本迁移本身 Phase2） |
| `created_at/updated_at/deleted_at` | 标准列 | 软删手写 IsNull |

索引：`UNIQUE(template_id)`、`INDEX(audit_status, enabled)`。

> 为什么 `five_ps`（长文）和基线数值分开：5Ps 是专业评审/报告用的人读材料；内核只吃数值 + JSON 心理要素。不要让内核读长文。

## 4. Resolver 实现口径

`DbCharacterProfileResolver.resolve({templateId, preset})`：

1. `SELECT * FROM character_profiles WHERE template_id = ? AND audit_status='approved' AND enabled=1 AND deleted_at IS NULL`。
2. **未命中**（含无此 slug / draft / rejected / disabled）→ 返回 `null`。调用方回退中性基线 + warn（warn 带 templateId；draft/rejected 可在日志里区分原因，但不阻断）。
3. **命中**：把该行**适配成 WP9-A `BuiltinCharacterSeed` 的形状**（纯映射，新一个 `toSeed(row)` 纯函数），**复用既有 `buildCharacterProfile(seed, preset)`** 产出 `CharacterProfile`。
4. 返回 `{ characterProfile, seed: stableSeedFromKey(templateId), displayName: row.display_name }`。
5. preset（handshake 传来的 difficulty/style/emotionBaseline/defenseLevel）叠加规则与 WP9-A 完全一致——**不允许在 DB resolver 里改映射公式**。

> **反双胞胎硬要求**：映射公式（defenseLevel×0.35、难度 bonus、style 微调、clamp01、transference 全零）只存在于 `buildCharacterProfile` 一份。DB resolver 只负责"取行 → 转 seed 形状"。若发现要复制公式，停下来改设计。

## 5. 装配切换

- `engine.module.ts`：把 `CHARACTER_PROFILE_RESOLVER` 的 `useFactory` 从 `BuiltinCharacterProfileResolver` 换成 `DbCharacterProfileResolver`（注入 DataSource/Repository）。
- `ENGINE_CHARACTER_SOURCE`：`builtin` → 用内置种子；`db`（或默认）→ 用 DB resolver。**默认行为与线上期望一致**：默认 db，builtin 仅作回退/测试。配了未实现值仍 warn（WP9-A 已留位）。
- `EngineStreamBackend`、voice 窄接口、voice.service、`engine-core`：**零改动**。

## 6. 首批内容（3–5 个 slug，已拍板 2026-10-29）

首批锁定 **4 个真实 vpt 模板**（2 焦虑 × 2 回避，与 WP9-A 两个内置种子对齐，便于对比验证"换角色基线确实不同"）。`coreBeliefs` 直接从对应 `visitor_pool_templates.script.innerWorkingModel.coreBeliefs` 抽取，不凭空写：

| template_id | 代号 | attachment | 基线锚定（工程种子值，专业后校） | coreBeliefs 来源 |
|---|---|---|---|---|
| `vpt_intimate_avoidance_l1` | 晚晴 | anxious | 仿 WP9-A anxious（trust≈0.28、resistance 中、valence 负、arousal 中高） | script: "我必须先满足别人才值得被留下""表达不满会被抛弃" |
| `vpt_self_worth_intellectualization_l1` | 小满 | anxious | 仿 WP9-A anxious（worthlessness 主题） | script: "我必须先证明自己有用才配被喜欢""优秀是唯一安全的身份" |
| `vpt_workplace_intellectualization_l1` | 亦舟 | avoidant | 仿 WP9-A avoidant（trust≈0.2、resistance 偏高、valence 负、arousal 低） | script: "求助是软弱的表现""把问题分析清楚就能解决" |
| `vpt_grief_avoidance_l1` | 念安 | avoidant | 仿 WP9-A avoidant（压抑型） | script: "我不能倒下，撑着就行""提起她我会撑不住" |

- 4 行初始 `audit_status='approved'`、`enabled=1`（人工撰写 = 已过审，与 visitor_pool seed 同口径）。
- `baseline_*` 数值先抄 WP9-A 两个种子的档位（anxious/avoidant 各一档），**是工程种子值不是临床标定**；专业校准归后期。
- `display_name` = 对应 codename（晚晴/小满/亦舟/念安）。
- 其余 2 个模板（`vpt_parenting_projection_l1` 阿禾、`vpt_social_anxiety_avoidance_l1` 小舟）本期**不建角色行**——握手到时回退中性，符合 §4 未命中边界；下批再扩。
- seed 脚本与 visitor_pool 内容治理同范式（按稳定 template_id 幂等 upsert，不进 migration）。

## 7. 验收（行为化，逐条过）

**A. 命中与回退**
1. 握手 `template_id` = 某 approved vpt slug → resolver 返回非 null，`characterProfile.coreBeliefs` 非空、baseline 数值落在 [0,1]/[-1,1]、transference 全零、displayName = 该模板 codename。
2. 同一 approved slug 连续两次 resolve **深相等**（确定性，含 seed）。
3. 未知 slug / draft 行 / rejected 行 / disabled 行 / 无 templateId → 一律 `null`，会话照常走中性基线，**不抛 500**。
4. resolver 抛错（DB 短暂不可用）→ 回退中性 + warn，**会话不开天窗**（与 WP9-A `resolveCharacter` 的容错一致）。

**B. 注入与快照**
5. 用真实 `InMemoryEngineSession`：命中角色开场 → 初始快照带该角色 coreBeliefs 与非中性基线；换角色 → 基线明显不同。
6. **resume 不丢角色**：角色 A 开场跑一轮落库 → close → `resumeFromSessionId` 接续 → 快照里 coreBeliefs/基线仍是 A 的（不被默认值覆盖，也不被 preset 改写）。
7. `preset` 叠加生效：同角色不同 difficulty/defenseLevel → 产出 resistance 不同；越界 preset 被 clamp（与 WP9-A 清单 5 同断言）。

**C. 数据与迁移**
8. migration up 后表结构与 §3 一致；down 可干净回滚（DROP 表 + 不残留列）；重复跑 up 不报错（幂等）。
9. **`engine-core` 整树零改动**：`git diff --stat HEAD -- src/engine-core` 为空；内核零新增 `@nestjs/`/typeorm/网络。
10. CRUD/上下架：admin 可创建/编辑/disable 角色；disable 后该 slug 下一场即回退中性。
11. 既有用例零回归：WP9-A 两套测试在 `ENGINE_CHARACTER_SOURCE=builtin` 下仍绿（证明切换没破坏内置回退路径）。

## 8. 不做的验收门槛

- 不要求 E2E 真 WS 连 JWT/TTS 通（那是端到端联调轮）。
- 不要求来访说话口吻因角色改变（渲染吃信念归 Phase2）。
- 不要求多角色并发/性能。

## 9. 闸门（后端 Windows PowerShell 跑，结果填交付记录）

- `npx tsc -p tsconfig.build.json --noEmit` → 0 错；
- `npx eslint "src/**/*.ts"` → 0 error；
- `npx jest test/engine-adapters` → 全绿（含新增 wp9b 用例）+ WP9-A 既有用例零回归；
- `pnpm migration:run` 与 `migration:revert` 各跑一次验证可逆；
- `git diff --stat HEAD -- src/engine-core` → 空。

## 10. 交接 WP9-C / 后续

- WP9-B 交付后，真实 `vpt_*` slug 才有角色。下一轮端到端联调前，确认 `visitor-pool-templates.seed.ts` 里那 3–5 个 slug 都有 approved 角色行。
- 角色语义进渲染 prompt（coreBeliefs 影响口吻）→ 渲染四手法（Phase2）。
- 观测：WP13 留痕里加 `characterSource: builtin|db` 与命中的 templateId，便于排查"这场为什么是中性"。

## 11. 终局形态预留（企业级；不假装 Phase1 切分就是终局）

> 原则：本期为快上线接受的临时切分，必须在单子里写明"哪几处是临时的、终局收敛成什么"，避免日后把临时切分误当架构、两张同构表长期并行腐烂。

1. **两张表 = 同一个来访者的临时切分**：`visitor_pool_templates`（前端图鉴/速查卡）与 `character_profiles`（引擎基线）现在按 `template_id` 逻辑关联。终局应收敛为**单一角色注册中心（character service）**：5Ps/基线/速查展示字段/版本/审核状态同源，引擎与前端都从同一服务取。本期不动 visitor_pool_templates 是为不阻塞灰度；Phase2 立项合并，**不留两张同构表长期并行**。
2. **resolver 端口即抽离缝**：`CharacterProfileResolver` 今天查 MySQL，终局换成对"角色服务"的 HTTP/gRPC 调用即可，注入点零改动——这是开放 API / 多消费者的前置，端口签名本期冻结。
3. **displayName / 速查卡是展示关切，不是引擎决策输入**：resolver 返回 displayName 仅为 persona 快照与报告显示，内核决策不读它；**不要把 ageRange/riskTags/occupation 等展示字段塞进 CharacterProfile**（那是 BFF/前端的事）。
4. **schema 带版本号**：`version` 列预留，终局多消费者（前端/督导台/开放 API）按版本协商，不做静默改字段。
5. **契约不随当前 Flutter UI 冻结**：WS 帧/报告结构是当前前端的产物，后端任务单不按它写死终局；后续前端改版时契约走显式版本协商，不在后端悄悄适配。
