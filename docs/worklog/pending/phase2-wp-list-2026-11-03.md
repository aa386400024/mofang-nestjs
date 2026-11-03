# Phase2 工作包清单（WP27–WP49）

> **路径**：`docs/worklog/pending/phase2-wp-list-2026-11-03.md`
> **配套**：[`phase2-overview-2026-11-03.md`](phase2-overview-2026-11-03.md)（总览文档，含依赖关系与验收标准）
> **编号规则**：接 Phase1 WP26 之后，从 WP27 开始

---

## 第一批（并行开工，互不依赖）

| WP | 名称 | 优先级 | 一句话描述 | 预估 | 状态 |
|---|---|---|---|---|---|
| **WP27** | billing 接真支付 | 🔴 P0 | 微信支付 V2 + 支付宝当面付接入，订单落库，回调验签，替换现有内存 mock | 中 | 📋 |
| **WP28** ✅ | WP11 回改正式值 | 🔴 P0 | PsyGUARD 超时 500ms→150ms、token 窗口 256→28，内测前改回生产值 | 小 | ✅ [交付记录](../completed/phase2/engine-wp28-psyguard-production-values-implementation-2026-11-03.md) |
| **WP29** | 数据分级留存与销毁 | 🔴 P0 | 用户删除权（对话+记忆+账号）、导出权、数据分级策略落地 | 中 | 📋 |
| **WP30** | Admin Dashboard 切真 API | 🔴 P0 | CharacterDetail + SessionDetail 接 `/admin/api/*` 真数据，去掉 mock 标识 | 中 | 📋 |
| **WP31** | 成本看板与告警 | 🔴 P0 | 成本看板展示 token 消耗/用户/会话，超阈值告警规则接入 | 小 | 📋 |
| **WP32** | BDI 状态持久化 | 🟡 P1 | 内存态 → Redis/DB，进程重启后可恢复 BDI 快照 | 中 | 📋 |

---

## 第二批（第一批完成后，并行）

| WP | 名称 | 优先级 | 一句话描述 | 依赖 |
|---|---|---|---|---|
| **WP33** | 会员分层 TTS | 🔴 P0 | tier→model 可扩展配置表（env 或 DB），会话启动时查一次 tier 并缓存 | WP27 |
| **WP34** ✅ | P1 人格调节算子 | 🟡 P1 | 依恋调节 + 人格特质调节信任增量，安全型快、回避型慢（[交付记录](../completed/phase2/engine-wp34-personality-modulator-operators-implementation-2026-11-03.md)） | WP1 |
| **WP35** | 渲染四手法 | 🟡 P1 | 阻抗-表达映射、口语化/非语言、表达层轻量随机、情绪粒度细化 | WP7 |
| **WP36** | 跨会话间隔自然衰减 | 🟡 P1 | resume 前按间隔对情绪/阻抗/信念差异化半衰期回落，破裂态阻抗反升 | WP12 |
| **WP37** | 记忆会话级摘要压缩 | 🟡 P1 | 单会结束生成摘要替代原始轮次，近原始远摘要，异步生成 | WP2 |
| **WP38** | 角色版本 semver | 🟡 P1 | 主版本进行中锁定 / 次版本平滑 / 修订实时，历史版本可回溯 | WP9 |

---

## 第三批（第二批完成后，并行）

| WP | 名称 | 优先级 | 一句话描述 | 依赖 |
|---|---|---|---|---|
| **WP39** | TTS emotion 映射 | 🔴 P0 | BDI valence/arousal → voice_setting.emotion 映射表，真机听感校准 | WP33 |
| **WP40** | TTS 内联语气词标签 | 🔴 P0 | prompt 注入 `(sighs)` `(pant)` `(breath)` 等标签，TTS 真发声 | WP33 |
| **WP41** | 表达风格渲染接入 | 🟡 P1 | WP10A 预留 3 列（话量基线/叙事风格/语态倾向）接入 spec-assembler | WP35 |
| **WP42** ✅ | 咨询同盟三维 | 🟡 P1 | trust/safety/bond 独立建模，建立/破裂/修复算子，调节阻抗下降速率（[交付记录](../completed/phase2/engine-wp42-counseling-alliance-three-dimensions-implementation-2026-11-03.md)） | WP34 |
| **WP43** | 评估引擎基础版 | 🟡 P1 | 旁路异步消费 BDI 快照/对话/伦理标签，输出基础技术+伦理维度评分 | WP8-B |
| **WP44** | 成长档案体系 | 🟡 P1 | 全链路数据沉淀 → 档案生成，用户可查看实训成长记录 | WP43 |

---

## 技术债清理（随时穿插，不排批次）

| WP | 名称 | 优先级 | 一句话描述 |
|---|---|---|---|
| **WP45** | P3 技术债 8 条 | 🟢 P2 | Qdrant `client: any`、`TemplateParameter = any[]`、死配置、cancelled 状态只写不读、状态衰减/边际递减/饱和、Prometheus 告警规则、QdrantMemoryStore 默认值耦合 |
| **WP46** | Sentry 通道脱敏 | 🟢 P2 | 本地日志已脱敏，Sentry 还是原样上报，补一层脱敏中间件 |
| **WP47** | supervisor 督导报告切真 DB | 🟢 P2 | V0.x 内存 mock → TypeORM 落库 |
| **WP48** | env 守卫盲区：分不出「读进 config」与「真被消费」 | 🟢 P2 | `wp25-env-example-coverage.spec.ts` 的 AST 只知道「代码里读没读这个键」，**分不出读进 config 命名空间与真被消费** —— 这类键能一路绿灯过断言①。已在 `.env.example` 底部「预留键（读得到但未消费）」区出现两个实例（`QDRANT_COLLECTION` / `VOICE_SESSION_IDLE_TIMEOUT_MS`）。修法：让守卫顺着 `process.env.X` → `config.get('命名空间.x')` 追一层消费点，把「读得到但无人消费」单列成一类（与「未接线」区分），并守住新区语义 |
| **WP49** | 角色大五人格字段落地 | 🟢 P2 | WP34 已交付人格调节算子，但**大五人格没有数据源** —— DB 的 `character_profiles.five_ps` 是临床 5Ps（易感/维持/诱发/保护/持续），与大五人格不是一回事 → 宜人性调节在生产上休眠（契约与端口已就位，规则永不触发）。另一项：依恋类型 → 基线阻抗的缺省映射缺统一规则（角色种子已按档位给基线，但缺通用取值口径）。~~附带的 `.env.example` 18 个 `ENGINE_CAP_*` 数值清理（改留空继承内核种子）已于 2026-11-03 完成~~ |

---

## 统计

| 层级 | 数量 | WP 编号 |
|---|---|---|
| 🔴 P0 商业化根基 | 8 条 | WP27, 28, 29, 30, 31, 33, 39, 40 |
| 🟡 P1 专业能力 | 10 条 | WP32, 34, 35, 36, 37, 38, 41, 42, 43, 44 |
| 🟢 P2 技术债 | 5 条 | WP45, 46, 47, 48, 49 |
| **合计** | **23 条** | **WP27–WP49** |

**进度：3 / 23 完成**（WP28 ✅、WP34 ✅、WP42 ✅，2026-11-03）。

### 🚧 上线前必须一起做的真机项（WP28 遗留）

| # | 事项 | 归属 |
|---|---|---|
| 1 | 生产机 `/opt/mofang-nestjs/.env` 的 `PSYGUARD_TIMEOUT_MS` —— **删掉该行**（不设 = 继承内核常量 150）。⚠️ 若线上还留着旧的 `500`，它会盖掉内核常量 → 线上实际仍是 500ms | 运维 |
| 2 | 生产机 `mofang-psyguard` 容器重建/重启（`PSYG_MAX_LENGTH` 是环境变量，**不重启不生效**） | 运维 |
| 3 | `admin-dashboard` 的 `PsyGuardMonitor.vue` p90 告警阈值 500 → 150 + i18n 文案同步 | 前端 AI |

---

_每个 WP 开工前单独写任务单（按 `team/conventions.md` 的交付格式），本清单只做索引。_

---

## 开工前置条件与边界提醒

### ⛔ 被用户决策阻塞的 WP（开工前先确认）

| WP | 阻塞点 | 需要用户确认什么 |
|---|---|---|
| WP27 billing 接真支付 | 微信/支付宝商户号未申请 | 商户号申请状态、费率、回调域名 |
| WP29 数据分级留存 | 数据留存年限未确认 | 法务/等保确认后才能写死年限策略 |
| WP33 会员分层 TTS | 会员体系最终方案未定 | 5 档 DTO 已有，但具体几级、叫什么、对应哪个 TTS 模型 |

> 以上 WP 在用户拍板前不要开工。其他 WP 不依赖用户决策，可以直接派单。

### 🔴 engine-core 红线例外（预批准）

按 `team/conventions.md` §1.1，engine-core 默认一行不动。以下 WP **预批准**改 engine-core，但必须通过 `boundary.spec.ts` 的 11 条断言：

| WP | 改 engine-core 的什么 | 为什么必须改内核 |
|---|---|---|
| WP28 WP11 回改正式值 ✅ | `cognition/safety/assess-safety.ts` 的 `DEFAULT_PROBE_TIMEOUT_MS`（500 → 150） | **探测超时的权威值就住在这个常量里**，适配层与 env 都只是覆盖它；不改内核则 150ms 在咨询师输入面（不传 `timeoutMs` 的那条路径）根本不生效。授权来源：WP25 审查 §1.4 的回改 checklist A1 + 常量文件头自带的回改清单 + **用户 2026-11-03 当面拍板** |
| WP34 人格调节算子 ✅ | BDI 算子库（WP1 基础算子扩展） | 算子是决策层逻辑，放适配层破坏纯层 |
| WP36 跨会话衰减 | 状态转移函数（WP15 cap 扩展） | 衰减是状态迁移规则，必须在纯层 |
| WP42 咨询同盟三维 ✅ | BDI 状态模型（trust → trust/safety/bond） | 状态结构变化，必须在内核 |

> 其他 WP 一律在 `engine-adapters/` 或业务层改，不碰 `src/engine-core/`。

### 🔗 需要前端联调的 WP（后端不写前端代码，但要出接口契约）

| WP | 前端要做什么 | 后端要交付什么 |
|---|---|---|
| WP30 Admin Dashboard | Vue3 页面切真 API | 后端出 `/admin/api/*` 接口文档（Swagger） |
| WP33 会员分层 TTS | Flutter 客户端展示会员等级 + TTS 质量差异 | 后端出 tier 字段 + TTS 模型映射接口 |
| WP39 TTS emotion | Flutter 客户端适配新的 TTS 音质 | 后端出 emotion 映射配置表 |
| WP40 TTS 语气词 | Flutter 客户端适配语气词标签 | 后端出 prompt 模板变更说明 |

### 🗄️ 需要 DB migration 的 WP

| WP | 新增表/字段 | 注意事项 |
|---|---|---|
| WP27 billing | orders / products / membership 表 | 手写 migration，禁 synchronize |
| WP29 数据分级 | data_retention_policies 表 | 按用户确认的年限写 |
| WP32 BDI 持久化 | Redis key 设计 + 可能的 DB 快照表 | Redis 为主，DB 兜底 |
| WP47 supervisor | supervision_reports 表 | 已有 entity，补 migration |

### ✅ 交付时必跑的闸门（每个 WP 都要）

```powershell
npx eslint "src/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit  # → 0 error
npx vitest run                    # → 全绿（Phase1 1252 例 + 新增用例零回归）
git diff --stat HEAD -- src/engine-core   # → 空（或预批准例外）
```
