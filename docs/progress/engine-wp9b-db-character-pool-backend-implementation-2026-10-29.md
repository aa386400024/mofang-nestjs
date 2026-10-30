# WP9-B · MySQL 角色资产池（5Ps 落库 + 真实 vpt slug 命中）· 后端交付记录

> 任务单: [`engine-wp9b-db-character-pool-backend-2026-10-29.md`](./engine-wp9b-db-character-pool-backend-2026-10-29.md)
> 前置: WP0–WP7 / [WP8-A](./engine-wp8-di-wiring-aggregated-turn-implementation-2026-10-28.md) / [MiniMax chat provider](./llm-minimax-chat-provider-implementation-2026-10-28.md) / [WP8-B](./engine-wp8b-streaming-ws-grayscale-backend-implementation-2026-10-29.md) / [WP9-A](./engine-wp9a-character-profile-seed-injection-implementation-2026-10-29.md)
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-29

---

## 0. 一句话结论

**WP9-A 那个"命中率恒为 0"的缺口，本轮闭合了**：新增 `character_profiles` 表（21 列 + 3 索引，system 级无 `tenant_id`），把 WP9-A 抽好的 `CharacterProfileResolver` 端口从「内置硬编码种子」切到「读 MySQL」，**首批 4 个真实 `vpt_*` slug**（晚晴 / 小满 / 亦舟 / 念安）已入库并 `approved` + 在架 —— 真实握手带来的 `meta.visitor.templateId` 现在能真正命中角色。

**映射公式仍然只有一份**：`DbCharacterProfileResolver` 只做「取行 → 转 `BuiltinCharacterSeed` 形状 → 调 WP9-A 的 `buildCharacterProfile`」，DB 侧零系数。单测用「DB 路径 vs 等价内置种子路径产出**逐字一致**」+「§4 系数数值断言」把这条线钉死。

**红线全部守住**：`src/engine-core/` 整树零改动（`git diff --stat HEAD -- src/engine-core` 为空）；`EngineStreamBackend`（adapter 文件）、voice 窄接口、`voice.service.ts` 零改动；引擎装配层（`engine.module.ts`）**零 ORM / 零 SDK 包名**（WP8-A §8-9 护栏未改、未破）。

**并且：应用真的能起来了**（`npm start` → `Nest application successfully started`，角色管理 5 路由全部 mapped，无 token 访问 → 401）。这一步顺手拆掉了一颗 **WP8-B 就埋下、此前从未被启动验证抓到**的雷：`EngineStreamBackend` 里的 `import type { EngineTurnService }` 让 TS 的 `design:paramtypes[0]` 退化成 `Function`，Nest 解析不到该 token → **只要把它当类 provider 注册，应用就起不来**。修法是回到仓库既定原则（构造逻辑归 `engine.providers.ts` 的纯工厂），**adapter 一行未动**（详见 §2.3）。

---

## 1. 实际建了什么表

### 1.1 表结构（`DESCRIBE character_profiles` 实测输出，21 列）

| 列 | 类型 | Null | 默认 | 键 |
|---|---|---|---|---|
| `id` | char(36) | NO | — | **PRI** |
| `template_id` | varchar(64) | NO | — | **UNI** |
| `display_name` | varchar(100) | NO | — | |
| `attachment_style` | varchar(20) | NO | — | |
| `five_ps` | json | NO | — | |
| `baseline_trust` | float | NO | 0.3 | |
| `baseline_resistance_verbal` | float | NO | — | |
| `baseline_resistance_depth` | float | NO | — | |
| `baseline_resistance_style` | float | NO | — | |
| `baseline_emotion_valence` | float | NO | — | |
| `baseline_emotion_arousal` | float | NO | — | |
| `core_beliefs` | json | NO | — | |
| `underlying_desires` | json | NO | — | |
| `forbidden_behaviors` | json | NO | — | |
| `sensitive_topics` | json | NO | — | |
| `audit_status` | varchar(20) | NO | draft | MUL |
| `enabled` | tinyint(1) | NO | 1 | |
| `version` | int | NO | 1 | |
| `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) | |
| `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) | |
| `deleted_at` | datetime(6) | YES | NULL | |

索引（`SHOW INDEX` 实测）：`PRIMARY` / `uniq_cp_template_id`（`template_id` 唯一）/ `idx_cp_audit_enabled`（`audit_status, enabled`）。

`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`。

**与任务单 §3 的对照**：21 列**逐列 1:1 落地，0 自由发挥**。三条范式纪律全部守住：

- **无 `tenant_id`**（system 级资产，公共模板同款）；
- **无任何计数字段**（`trust_level` / `count` / `score` 一列都没有）；
- **无 DB-level FK**（`template_id → visitor_pool_templates.id` 走应用层校验，ADR-0003）；
- `synchronize` 全程关闭，schema 只走 migration。

### 1.2 迁移（`src/migration/1714900000023-AddCharacterProfiles.ts`）

仓库 64 条 migration 里的第 64 条，**手写 DDL**，与 `1714900000018-AddVisitorPoolTemplates` 同款范式：

- `up`：`CREATE TABLE IF NOT EXISTS` + `SHOW INDEX` 守卫（缺 `uniq_cp_template_id` / `idx_cp_audit_enabled` 才 `ALTER TABLE ADD`）→ **重复跑 up 不报错**，半途中断后重跑能补齐索引；
- `down`：`DROP TABLE IF EXISTS character_profiles` —— 只建了这 1 张表，删表即净回滚，**不残留列、不残留索引**；
- 登记在 `bin/ormconfig.ts` 的**显式数组**末尾 + `src/migration/index.ts` 1:1 导出。
  > 为什么必须显式登记：`bin/ormconfig.ts` 的 entities glob 指向 `../src/entity/**`（sampledb），扫不到本仓实体 → 漏登记 = **静默不建表**。同理不用 `migration:generate`：generate 出来是空壳。

### 1.3 内容不落 migration

首批 4 行内容走**独立 seed 脚本** `bin/seed-character-profiles.ts`（`npm run seed:character-profiles`），理由与仓库同范式：角色内容是**会持续演进的内容资产**（运营改数值 / 改文案 / 上下架 / 过审），灌进 migration 会让"改一句主诉"也要加一条迁移 —— schema 与内容必须解耦。

seed 语义（同 visitor_pool）：

| 情况 | 行为 |
|---|---|
| 不存在 | `INSERT`（初始 `audit_status='approved'` / `enabled=1` —— 人工撰写 = 已过审） |
| 已存在且内容有变 | `UPDATE`（**只改内容字段**） |
| 已存在且内容一致 | no-op（不产生无谓写，避免 `updated_at` 抖动） |

> **seed 无权推翻运营决策**：已存在行的 `enabled` / `audit_status` **不被 seed 改写** —— 运营下架过的角色不该被 seed 悄悄重新上架，审核结论也不该被种子推翻。

**幂等实测**：首次 `新增 4 / 更新 0 / 未变 0` → 连跑第二次 `新增 0 / 更新 0 / 未变 4`。

---

## 2. resolver 怎么挂的

### 2.1 端口实现（`src/engine-adapters/wiring/character/db-character-profile.resolver.ts`）

`DbCharacterProfileResolver implements CharacterProfileResolver`（WP9-A 冻结的端口，**签名未改**）。命中口径（任务单 §4.1）：

```ts
where: { templateId, auditStatus: 'approved', enabled: true, deletedAt: IsNull() }
```

职责严格限定三步：

```
取行 → toCharacterSeed(row)  ← 纯映射，只转形状 → buildCharacterProfile(seed, preset)  ← WP9-A 唯一一份映射
```

`toCharacterSeed` 把「数据库一行」翻译成「WP9-A 认识的那个形状」（`BuiltinCharacterSeed`），**不含任何系数** —— 若哪天这里出现 `× 0.35`，就是第二份映射公式长出来了。

返回值与内置路径完全同构：`{ characterProfile, seed: stableSeedFromKey(templateId), displayName: row.displayName }`。

### 2.2 装配：**角色池自成一个 Nest 模块**

这是本轮**唯一一处偏离任务单字面**的地方，必须说明：任务单 §5 写的是"在 `engine.module.ts` 把 `useFactory` 换成 `DbCharacterProfileResolver`"。字面照做会**破掉 WP8-A 的架构护栏**：

> `test/engine-adapters/wp8-wiring.spec.ts` §8-9 断言：`src/engine-adapters/wiring/*.ts`（**仅顶层、非递归**）不得直接 import `@nestjs/typeorm` / `typeorm` / qdrant / axios / openai 等 SDK 包。
> 角色池**必须连库** → 把它的 provider 直接写进 `engine.module.ts`，该文件就得 import `@nestjs/typeorm` → **护栏立刻红**。
> "为了让护栏变绿去改护栏"是错的。

所以角色池整体拆成独立模块 `src/engine-adapters/wiring/character/character-pool.module.ts`：

| 装配点 | 内容 |
|---|---|
| `CharacterPoolModule` | `TypeOrmModule.forFeature([CharacterProfileEntity])` + `UserModule` + 管理端 controller/service + `AdminRoleGuard` + **`CHARACTER_PROFILE_RESOLVER` 的 `useFactory` 绑定** |
| `engine.module.ts` | **只** `imports: [CharacterPoolModule]`；**移除**了 `@nestjs/typeorm` / `typeorm` / `AdminRoleGuard` / `UserModule` / 管理端直引；零 SDK 包名 |

**换数据源仍然只改一处**（任务单 §5 的原意完整保留）：改 `CharacterPoolModule` 里那个 `useFactory` 即可，`engine.module.ts` 与注入点一行都不用动。

> 副带好处：将来做「单一角色注册中心」（任务单 §11.1）时，角色池整体迁移即可，引擎装配层与 voice 侧一行都不用动。

#### Nest 的导出规则（踩过的坑，写在这里别再踩）

`EngineWiringModule.exports` 里**不能**写 `CHARACTER_PROFILE_RESOLVER` 这个 symbol —— provider 的声明位置在 `CharacterPoolModule`，而 Nest 的 `Module.validateExportedProvider` 只接受两种导出：

1. 本模块**自己** `providers` 里声明过的 provider；
2. 一个**整个 imported module 类**（内部判断是 `imports.includes(token)`）。

导出「imported module 里的单个 provider」会直接抛：

```
UnknownExportException: Nest cannot export a provider/module that is not a part of
the currently processed module (EngineWiringModule). Please verify whether the
exported Symbol(CHARACTER_PROFILE_RESOLVER) is available in this particular context.
```

→ **应用起不来**（扫描期就炸）。所以 `EngineWiringModule.exports` 里转出的是**整个 `CharacterPoolModule`**：

```ts
exports: [EngineTurnService, ENGINE_SESSION_PORT, ENGINE_RENDER_PORT, VOICE_TURN_BACKEND, CharacterPoolModule]
```

外部模块照样能拿到 `CHARACTER_PROFILE_RESOLVER`（由 `CharacterPoolModule` 的 `exports` 提供），对外取用口子与 WP9-A 一致；`EngineStreamBackend` 在本模块内注入它时，Nest 走 `lookupComponentInImports`，要求该 token **同时**在 `CharacterPoolModule` 的 `providers` 与 `exports` 里 —— 本轮两边都有 ✓。

### 2.3 拆模块之后暴露的启动炸弹（WP8-B 遗留，本轮修掉）

启动验证时又炸出一个**更早埋下**的雷：`EngineStreamBackend` 从 WP8-B 起就没被成功实例化过。

**根因**：`engine-stream-backend.adapter.ts` 里 `EngineTurnService` 是 **type-only 导入**：

```ts
import type { EngineTurnService } from './engine-turn.service';
```

TypeScript 的 `emitDecoratorMetadata` 遇到 type-only 导入的类类型时**产不出值引用**，只能降级成 `Function` —— 编译产物实测：

```js
__metadata("design:paramtypes", [Function, Object])
```

而 Nest 正是靠 `design:paramtypes` 决定构造参数注入什么：它去容器里找一个 token 叫 `Function` 的 provider —— **不存在** → 启动直接抛：

```
UnknownDependenciesException: Nest can't resolve dependencies of the EngineStreamBackend
(?, Symbol(CHARACTER_PROFILE_RESOLVER)). Please make sure that the argument Function
at index [0] is available in the EngineWiringModule module.
```

（对照：`engine-wiring.controller.ts` 用的是**值导入** `import { EngineTurnService }`，所以它一直正常。）

**为什么以前没炸**：WP8-A / WP8-B 的闸门只跑 `tsc` / `eslint` / `jest`，**从没真起过服务**；WP9-B 的导出错误又发生在**扫描期**，比实例化期更早，把这颗雷挡在了后面。

**修法**：按仓库自己的架构原则（`engine.module.ts` 文件头：「构造全在 `engine.providers.ts` 的纯工厂里，本文件只声明 token ↔ 工厂的映射」）——新增纯工厂 `createEngineStreamBackend`，模块改用 `useFactory` 注册：

```ts
{
  provide: EngineStreamBackend,
  useFactory: (engine: EngineTurnService, resolver: CharacterProfileResolver): EngineStreamBackend =>
    createEngineStreamBackend({ engine, resolver }),
  inject: [EngineTurnService, CHARACTER_PROFILE_RESOLVER],
}
```

走工厂后 Nest **不再读**它的 `design:paramtypes`（工厂的 `inject` 是显式给的），雷被拆掉，而且**`engine-stream-backend.adapter.ts` 一行都没改**（守住 WP9-B「注入点零改动」红线）。

**新增护栏**（`test/engine-adapters/wp9b-engine-stream-backend-wiring.spec.ts`，4 例）：断言模块必须用 `useFactory` 注册它、裸类 provider 写法不得出现、`inject` 必须显式带上 `CHARACTER_PROFILE_RESOLVER`，以及工厂确实把 resolver 转发出去了。


### 2.4 barrel 收紧为 ORM-free

`src/engine-adapters/wiring/character/index.ts` 收紧成**只导出** `builtin-character-registry` + `character-profile.resolver`（端口与内置种子），**DB 那套（实体 / resolver / 管理端）不进 barrel**。

理由：barrel 是"装配层 import 角色解析"的入口，若把 ORM 那套也塞进去，任何人 `import { CHARACTER_PROFILE_RESOLVER } from './character'` 都会顺带拖进整套 TypeORM —— 装配层零 SDK 依赖的纪律会从"靠自觉"变成"靠结构"。收紧后 `EngineStreamBackend`（WP9-A 冻结、零改动）也保持零 ORM 依赖。

### 2.5 数据源默认值：`builtin` → `db`

| `ENGINE_CHARACTER_SOURCE` | 行为 |
|---|---|
| 未配置 / `db` | **`DbCharacterProfileResolver`**（默认，与线上期望一致） |
| `builtin` | `BuiltinCharacterProfileResolver`（**回退 / 测试档**） |
| 其它值 | 打一条 `warn`（`[WP9-B] ENGINE_CHARACTER_SOURCE=xxx 尚未实现, 本轮回退 db 数据源`）后回退 db —— **不静默假装生效** |

> 改默认值是**必须的**：WP9-A 内置种子的 key 是 `builtin_avoidant_l1` / `builtin_anxious_low_mood_l1`，与公共模板 id（`vpt_*`）**不同命名空间**，命中率恒为 0 —— 这正是本轮要闭合的缺口。`builtin` 档保留，用来证明"切换没破坏内置回退路径"。

### 2.6 内部管理端（5 端点）

路径 `/engine/admin/character-profiles`（跟着**表的归属**走：这张表是引擎侧资产；将来并入统一角色中心时不用搬路由）。

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/engine/admin/character-profiles` | 列表（含未过审 / 已下架 / 已软删），可按 `auditStatus` / `enabled` / `templateId` 过滤 |
| GET | `/engine/admin/character-profiles/:templateId` | 详情（含 5Ps 专业材料） |
| POST | `/engine/admin/character-profiles` | 新建，**缺省 `audit_status='draft'`**（需显式过审才被引擎命中） |
| PATCH | `/engine/admin/character-profiles/:templateId` | 编辑内容 / 上下架 / 过审；**`version` 递增**表示内容变更 |
| DELETE | `/engine/admin/character-profiles/:templateId` | **软删**（同时下架，不物理删除） |

鉴权：**class 级** `@UseGuards(JwtAuthGuard, AdminRoleGuard)` —— 身份走仓库既有的 `JwtAuthGuard`（cookie/Bearer + 黑名单），内部角色走 `AdminRoleGuard`（直读 `users.admin_role`）。**不新造第 4 套内部能力守卫**。class 级挂一次，新增端点自动继承（逐个 method 挂守卫漏一个就开天窗）。

错误统一走 `BizException` + `BizCode.InvalidParameter` / `BizCode.ResourceNotFound`。

---

### 2.7 LLM 超时被读成字符串（又一颗"只有真起服务才会炸"的雷）

WS 端到端探针第一次真连上游时暴露：`src/agent/llm/llm.service.ts` 读超时用的是**裸 env 键**：

```ts
this.timeoutMs = config.get<number>('MINIMAX_LLM_TIMEOUT_MS') ?? 30_000;   // ← 拿到的是字符串 '60000'
```

`ConfigService` **不做类型转换**，`.env` 里的 `MINIMAX_LLM_TIMEOUT_MS=60000` 原样进来 → 一路传到 `AbortSignal.timeout(timeoutMs)` → Node 抛：

```
The "delay" argument must be of type number. Received type string ('60000')
```

后果：**只要 `.env` 里配了 `MINIMAX_LLM_TIMEOUT_MS`，每一次 LLM 调用都炸**（语音 / 督导 / 场景生成全断）。没配时反而正常（走 `?? 30_000` 的数字兜底）—— 这种"配了就炸"的雷最阴。

修法：改走**已归一化的配置命名空间**（`config/envs/default.ts` 里 `llmTimeoutMs: Number(process.env.MINIMAX_LLM_TIMEOUT_MS ?? 30_000)`），与 `tts-bidi-client` 等同款读法 —— **数值只在一处归一，别处只消费**。`llmMaxRetries` 同理。

## 3. 首批 4 行数据（实际入库值）

| `template_id` | 代号 | `attachment_style` | trust | resist V/D/S | valence / arousal | `audit_status` | `enabled` | `version` | `id`（内容派生） |
|---|---|---|---|---|---|---|---|---|---|
| `vpt_intimate_avoidance_l1` | 晚晴 | anxious | 0.28 | 0.42 / 0.50 / 0.38 | −0.45 / 0.62 | approved | 1 | 1 | `f83261e0-a66c-3867-4d91-602dc1ad514a` |
| `vpt_self_worth_intellectualization_l1` | 小满 | anxious | 0.28 | 0.42 / 0.50 / 0.38 | −0.45 / 0.62 | approved | 1 | 1 | `28f8b913-4d95-1bbf-6732-dddc982679ca` |
| `vpt_workplace_intellectualization_l1` | 亦舟 | avoidant | 0.20 | 0.62 / 0.68 / 0.60 | −0.55 / 0.18 | approved | 1 | 1 | `8130362a-feb9-a8cd-7730-20281ddbda8f` |
| `vpt_grief_avoidance_l1` | 念安 | avoidant | 0.20 | 0.62 / 0.68 / 0.60 | −0.55 / 0.18 | approved | 1 | 1 | `ddf207b2-9e8a-e317-8d43-bbea5d1c62b2` |

- **基线数值先抄 WP9-A 两档**（anxious / avoidant 各一档）—— **是工程种子值，不是临床标定**（任务单 §4 尾注）；专业校准归后期专业评审。
- **`coreBeliefs` 不是手写的**，逐条取自 `visitor_pool_templates.script.innerWorkingModel.coreBeliefs`（入库实测原文）：

| template_id | theme :: statement |
|---|---|
| 晚晴 | `conditional_self_worth :: 我必须先满足别人才值得被留下` ｜ `abandonment :: 表达不满会被抛弃` |
| 小满 | `worthlessness :: 我必须先证明自己有用才配被喜欢` ｜ `conditional_worth :: 优秀是唯一安全的身份` |
| 亦舟 | `intellectualization :: 把问题分析清楚就能解决` ｜ `self_sufficiency :: 求助是软弱的表现` |
| 念安 | `self_sufficiency :: 我不能倒下，撑着就行` ｜ `grief_avoidance :: 提起她我会撑不住` |

- **只声明结构信息**（theme / 激活标签 / 数量），statement 一律**从来访池按下标抽取** → "速查卡里的晚晴"和"引擎里的晚晴"永远是**同一个人**。seed 脚本不 import 引擎层、引擎层不 import counselor 层：依赖方向是**单向的**（脚本 → 两边），引擎层零 counselor 依赖。
- **内部 `id` 由 `template_id` sha1 派生**（UUID 形态），不是随机 UUID —— 同一模板永远同一个 id，seed 重跑不产生重复行，不同库之间可对照。
- 其余 2 个模板（`vpt_parenting_projection_l1` 阿禾、`vpt_social_anxiety_avoidance_l1` 小舟）本期**不建角色行** → 握手到时回退中性（符合 §4 未命中边界），下批再扩。

---

## 4. 命中与回退行为

### 4.1 命中链路（闭环）

```
握手 meta.visitor.templateId (vpt_*)
  → voice 窄接口只透传 templateId/preset        （voice 侧零改动）
  → EngineStreamBackend.resolveCharacter        （WP9-A 冻结，零改动）
  → CharacterProfileResolver.resolve            （本轮换数据源）
  → DbCharacterProfileResolver: 取行(approved+enabled+未软删)
  → toCharacterSeed → buildCharacterProfile(seed, preset)   ← 唯一一份映射
  → engine.open({ characterProfile, seed })      → 内核初始快照带该角色信念与基线
```

### 4.2 未命中 = 常态，一律回退中性基线，不抛错

| 情况 | resolver 行为 | 日志 | 会话 |
|---|---|---|---|
| 无 `templateId`（空白） | 直接返 `null`，**不查库** | — | 中性基线 |
| 未知 slug（没建档） | 返 `null` | `debug`：无角色行 | 中性基线 |
| `audit_status='draft'` | 返 `null` | `warn`：审核状态=draft | 中性基线 |
| `audit_status='rejected'` | 返 `null` | `warn`：审核状态=rejected | 中性基线 |
| `enabled=0`（已下架） | 返 `null` | `warn`：已下架 | 中性基线 |
| 已软删 | 返 `null` | `debug`：无角色行 | 中性基线 |
| **DB 抛错** | **异常上抛**给调用方 | `EngineStreamBackend` `warn`：角色解析异常, 回退中性基线 | 中性基线，**不开天窗** |

> **为什么未命中要多查一次**：主查询按 §4.1 过滤，查不到时无法区分「压根没这一行」与「这一行存在但没过审 / 已下架」—— 前者是"还没建档"（常态，debug 级），后者是"建了但不能用"（需要运营介入，warn 级）。多查一次换一条能定位的日志，值得；诊断本身再失败也不影响主流程。
>
> **为什么 DB 异常上抛而不是在 resolver 里吞掉**：容错边界在 WP9-A 就立在 `EngineStreamBackend.resolveCharacter` 那一层（统一 warn + 回退中性）。本轮**不改那一层**，resolver 若自己吞异常，就会出现"数据库完全挂掉"和"角色不存在"两种完全不同的故障**看起来一模一样** —— 排查时无从下手。

### 4.3 运营动作 → 引擎行为的即时联动

| 运营动作 | 下一场会话 |
|---|---|
| 新建（缺省 draft） | **不命中** → 中性基线 |
| 改 `audit_status` → `approved` | **命中** → 注入非中性基线 |
| 改 `enabled` → `false`（下架） | **不命中** → 中性基线 |
| 软删 | **不命中**，但**管理端仍可见**（可恢复） |

> 这条是**跨层契约**：任一侧单测都证明不了，必须让管理服务改同一份数据、再让 resolver 读它 —— 所以 admin 单测与管理服务共用同一个内存仓储 stub。

---

## 5. 关键设计决策

### 5.1 绝不复制映射公式（任务单 §4 反双胞胎硬要求）

映射公式（防御水平×0.35 / 难度 bonus L1 0·L2 +0.08·L3 +0.16 / style 微调 cooperative −0.1·mixed 0·defensive +0.08·avoidant +0.1·resistant +0.15 / clamp01 / transference 全零 / `emotion.label` 不手填）**只存在于 WP9-A 的 `buildCharacterProfile` 一份**。

若在 DB resolver 里另写一份，症状是"同一个角色，内置种子档和 DB 档的阻抗不一样" —— 而这种差异**没有任何报错**，只会在真实会话里表现为"换了个数据源，角色味道变了"。

**两条护栏**：
1. 单测断言「DB 路径 vs 等价内置种子路径产出**逐字一致**」；
2. 单测按 §4 数值断言叠加系数（`defenseLevel=0.5` + `L3` + `resistant` → 各维 `toBeCloseTo(..., 6)`）。

### 5.2 角色池归 engine-adapters 自持

消费者是引擎、引擎是更底层 → 实体 / resolver / 管理端 / 内容基线全部放 `src/engine-adapters/wiring/character/`。
`visitor_pool_templates` 的速查卡字段（codename / age_range / presenting_complaint）**继续留原表**，两表按 `template_id` 逻辑关联（任务单 §11 明确这是**临时切分**，终局收敛为单一角色注册中心）。

### 5.3 引擎装配层零 SDK 依赖 → 角色池独立成模块

见 §2.2。护栏（WP8-A §8-9）**未改、未破**，反而因为模块拆分更硬：装配层要碰 ORM 就必须先改模块边界，而不是"顺手加一行 import"。

### 5.4 内容基线自检**入库前就炸**

`validateCharacterProfileSeedSpecs` 在 seed 脚本里先跑一遍：模板对不上 / 展示名与 codename 不一致 / 信念数量对不上 / 数值越界 / 缺愿望 / 缺负向约束 / 缺敏感议题 → **当场抛错，不进库**。
理由：角色内容是用户第一眼看到的东西，结构性错误应该在 seed 阶段炸，而不是等线上发现"引擎基线和速查卡对不上"。

### 5.5 admin 新建缺省 draft

admin 端点建出来的角色**默认 `draft`**，需显式过审才被引擎命中。理由：管理端是内部操作但仍是**写入口**；默认 approved 等于"漏一次审核就直接上引擎"。seed 脚本写 `approved` 是另一回事 —— 那是**人工撰写的内容基线**，本身就代表已过审（与 visitor_pool 同口径）。

---

## 6. 与任务单的差异（显式说明）

| 任务单 | 实际落地 | 说明 |
|---|---|---|
| §5「在 `engine.module.ts` 把 `useFactory` 换成 `DbCharacterProfileResolver`」 | 绑定移进**新模块 `CharacterPoolModule`**，`engine.module.ts` 只 `imports: [CharacterPoolModule]` | 字面照做会让装配层 import `@nestjs/typeorm` → **破 WP8-A §8-9 护栏**。护栏优先；"换数据源只改一处"的原意完整保留 |
| §5（隐含）「`engine.module.ts` 导出 `CHARACTER_PROFILE_RESOLVER`」 | 改为导出**整个 `CharacterPoolModule`** | Nest **不允许**把 imported module 里的单个 provider 再导出一次（`UnknownExportException`，扫描期即炸 → 应用起不来）。只能导出「本模块自己的 provider」或「整个 imported module 类」。外部取用口子不变（`CharacterPoolModule` 的 `exports` 里就有那个 token） |
| §5「`EngineStreamBackend` 零改动」 | **adapter 仍为零改动**（一行未动），但装配方式由「裸类 provider」改为**工厂装配**（`createEngineStreamBackend`） | WP8-B 遗留的启动炸弹：`import type` 让 `design:paramtypes[0]` 退化成 `Function` → Nest 解析不到该 token → **应用起不来**。按仓库既定原则（构造归 `engine.providers.ts` 纯工厂）修在装配层，注入点零改动红线不破 |
| §3「首批 3–5 个 slug」 | **恰好 4 个**（晚晴/小满/亦舟/念安） | 用户本轮明确"首批就 4 个，别自己加" |
| §6「`coreBeliefs` 直接从 `visitor_pool_templates.script.innerWorkingModel.coreBeliefs` 抽取」 | 一致，但**按下标抽取 + 结构化参数注入**（`VisitorTemplateBeliefSource`），引擎层零 counselor import | 依赖方向单向（脚本 → 两边），避免引擎层依赖 counselor 层 |
| §7.11「WP9-A 两套测试在 `ENGINE_CHARACTER_SOURCE=builtin` 下仍绿」 | 全量 21 套件 440 用例复跑全绿（含 WP9-A 两套 28 例） | WP9-A 单测直接构造 `BuiltinCharacterProfileResolver`，不依赖装配层绑定口径 → 内置回退路径未被破坏 |
| §3 索引 `INDEX(audit_status, enabled)` | 落成 `idx_cp_audit_enabled` | 索引名显式化（`CREATE TABLE IF NOT EXISTS` 下的索引守卫按名查），与仓库既有命名风格一致 |
| §9 闸门 `pnpm migration:run` | 用 `npm run migration:run`（本仓 npm 脚本） | 仓库 `package.json` 里是 npm scripts |

---

## 7. 已知缺口（必须如实看）

1. **渲染 prompt 仍不吃角色信念**（任务单 §1 明确划走）。本轮角色只影响**数值基线**与 `forbiddenBehaviors` 约束，**不改变来访说话口吻**。角色语义进 prompt 归「渲染四手法」（Phase2）。

2. **只剩 4 个角色有行**。阿禾（`vpt_parenting_projection_l1`）、小舟（`vpt_social_anxiety_avoidance_l1`）**未建角色行** → 握手到这两个 slug 时回退中性基线。这是**按拍板范围做的**，不是 bug；下批扩。

3. **`visitor_pool_templates` 与 `character_profiles` 两表并存**（任务单 §11.1 写明的**临时切分**）。`coreBeliefs` 已做到"同一个人只有一个真相"（statement 从来访池抽取），但 5Ps / 基线 / 速查展示字段 / 版本 / 审核状态**仍未同源**。终局收敛为单一角色注册中心，Phase2 立项合并 —— **不留两张同构表长期并行**。

4. **管理端无分页/无批量操作/无审核工作流**。当前 5 端点是"够用且边界清楚"的最小面：列表返回全量（`findAndCount` 已有 count，但未接分页参数）、审核是单字段切换、无批量过审。内部 admin 量级下不构成瓶颈；对外 UGC 提交-审核-分成流是 Phase2。

5. **可观测性缺口**（任务单 §10 已列，属 WP13）：留痕里还没有 `characterSource: builtin|db` 与命中的 `templateId` —— 现在排查"这场为什么是中性"只能靠 resolver 的日志（`[resolve] 角色不可用 ...` / `[resolve] 无角色行 ...`）。这条**没有在本轮偷偷做**，因为它落在 WP13 的留痕结构里，插进去会与 WP13 的字段设计打架。

6. **`enabled` 与 `audit_status` 是两个正交闸门，但管理端没有"只下架不过审"的组合校验**。例如 `audit_status='rejected'` + `enabled=1` 这种组合在库里合法、行为上也正确（rejected 就不命中），只是运营视角有点别扭 —— 属 Phase2 工作流范畴。

7. **未做端到端真 WS 联调**（任务单 §8 明确不要求）：真实 WS + JWT + 命中 `vpt_*` slug 的会话需要端到端联调轮验证。本轮单测用**真实 `InMemoryEngineSession`** 证明了"命中 → 内核初始快照带该角色信念与基线"，链路在引擎侧是通的。

8. **WS 端到端仍差最后一步：LLM 的 token 预算字段用错了**（探针实测）。
   本轮用仓库里的 `scripts/e2e-voice-ws-probe.mjs` 真连了一次上游（顺手修了探针的两处 bug，见 §9.2）：握手 ✓、速查卡代号 = 晚晴 ✓、`llm_start` → `llm_done` ✓、**没有 error 帧** ✓，但 **来访一个字都没吐**（`llm_text` 0 条）。后端日志给出根因：

   ```
   [stream_truncated] finish_reason=length — max_tokens 可能不够
   ```

   根因：MiniMax-M3.1-Flash 是**推理模型**，**thinking token 计入生成长度上限**，而所有调用方传的还是**旧字段 `max_tokens`**（`visitor.service.ts` 传 `maxTokens: 200`；引擎侧 `llm-render.adapter.ts` 走 `ChatCompletionRequest.maxTokens`）。预算被思考吃光 → `content` 为空。
   `llm.service.ts` 自己的注释早已写明这条契约（*"传了就用 max_completion_tokens, 不传则沿用旧的 max_tokens"*、*"thinking token 也计入本上限"*），**是调用方没按契约传**。
   本轮**没改**：改它要定 token 预算（成本/时延口径）并动 `src/agent/**` 与引擎渲染适配器 —— 两处都是 WP9-B 的红线目录，且属于**模型口径决策**，该由产品/你拍板，不该后端擅自定。
   → 下一轮建议：调用方统一传 `maxCompletionTokens`（并按模型决定是否下发 `reasoning_effort`），`llm.service.ts` 侧已支持，改的是调用方。

9. **WS 帧信封契约与网关注释不一致**（探针实测，需前端确认）。
   Nest 的 `@nestjs/platform-ws` 默认 `messageParser` 只做 `JSON.parse`，随后按 `event` 找 handler、把 `data` 当 payload —— 所以客户端必须发 **`{ event: 'message', data: { type: 'user_text', text: '…' } }`**。发裸帧 `{ type, text }` 会被 `handlersMap.get(undefined)` 命中 `catch` 分支**静默丢弃**：服务端一帧不回、不报错、不留日志。
   而 `voice.gateway.ts` 的注释写的是 *"发 {"type":"user_text","text":"你好"}"* —— **注释与实现不符**。
   需要确认：**Flutter 客户端实际发的是哪种**？若发的是裸帧，那真机上的语音对话轮次从来没跑起来过（与 §2.3 那颗雷同一类"没被真实验证过"）。本轮只改了探针（按实现发信封），**没有动网关注释与契约** —— 契约归前后端共同口径，不该后端单方面改。

10. **引擎灰度开关未开**：`.env` 里没有 `ENGINE_VOICE_ENABLED`，缺省**关** → WS 走的是**旧 visitor 链路**（`VisitorService.openSession`），**根本不会碰角色解析器**。WP9-B 的角色注入挂在**引擎路径**上，所以要在 WS 上看到"晚晴"的角色基线生效，需要开 `ENGINE_VOICE_ENABLED=1`（WP8-B 的灰度口径，缺省关是既定行为）—— **本轮没有擅自改 `.env`**（环境改动需授权）。

---

## 8. 单测清单对照（任务单 §7）

### `test/engine-adapters/wp9b-db-character-resolver.spec.ts`（25 例）

| 清单 | 用例 | 断言要点 |
|---|---|---|
| A.1 | 命中 → 完整基线 | 非 null；`coreBeliefs` / `forbiddenBehaviors` / `sensitiveTopics` / `underlyingDesires` 非空；信任与三维阻抗 ∈ [0,1]、valence ∈ [-1,1]、arousal ∈ [0,1]；**transference 全零**；**`emotion.label` 未定义**（不手填）；`displayName` = 模板代号「晚晴」 |
| A.2 | 可复现 | 同 slug 连两次 resolve **深相等**（含 seed）；seed 是数字 |
| A.3 | 未命中一律 null | 未知 slug / draft / rejected / 已下架 / 已软删 / 无 `templateId` → **全部 null**，不抛；无 `templateId` 时**连库都不查** |
| A.4 | DB 抛错 | resolver 把异常**冒泡**给调用方；`EngineStreamBackend` 捕到 → 不带 `characterProfile`、persona 名回落「来访者」、**不抛** |
| B.5 | 注入内核 | 真实 `InMemoryEngineSession` 开场 → 快照 `coreBeliefs` 逐条对上该角色、trust / 三维阻抗 / 底层愿望对上；换角色 → 基线**明显不同** |
| B.6 | resume 不丢角色 | 角色 A 开场跑一轮 → `resumeFromSessionId` 接续但**带另一个角色** → 快照仍是 A 的信念与信任（内核契约，不被新角色覆盖） |
| B.7 | preset 叠加 | 同角色 L1/defense0 vs L3/defense0.8 → resistance 不同；越界 preset（`emotionBaseline=1.9` / `defenseLevel=-0.2`）被 clamp（arousal=1、阻抗不越界、无 NaN） |
| C | **公式只有一份** | DB 路径 vs 等价内置种子路径 `characterProfile` **逐字相等**、`seed` 相等；§4 系数逐维 `toBeCloseTo(..., 6)`（含 style 维 +0.15 resistant、trust 不被覆盖、valence 不被覆盖、arousal 由临场给）；`toCharacterSeed` 只转形状不改数值且**拷贝而非共享引用** |
| D | 内容基线对齐 | 恰好 4 个 slug 且全部来自已存在的公共模板；**`coreBeliefs` 逐字等于来访池 `coreBeliefs`**；`displayName` = codename；`attachmentStyle` = 来访池 `attachmentType`；自检通过 / 模板缺失时**报错而不是静默**；两档可区分；`id` 内容派生（36 位、同模板恒同、异模板必异） |
| E | 与 WP9-A 档位一致 | 焦虑型行抄 `BUILTIN_ANXIOUS_LOW_MOOD_L1` 档、回避型行抄 `BUILTIN_AVOIDANT_L1` 档（trust / 三维阻抗 / valence / arousal 逐项对上） |

### `test/engine-adapters/wp9b-character-admin.spec.ts`（13 例）

| 清单 | 用例 | 断言要点 |
|---|---|---|
| ⑩ 新建 | 落库 / 缺省 draft / 出参完整 | `audit_status='draft'`、`enabled=true`、`version=1`、信念与 5Ps 完整 |
| ⑩ 新建 | `templateId` 重复 | **明确报错**（`BizException`），**不覆盖旧行** |
| ⑩ 新建 | 显式指定 approved | 按指定写入 |
| ⑩ 查询 | 列表过滤 | `auditStatus` / `enabled` / `templateId` 三种过滤各自生效 |
| ⑩ 查询 | 详情不存在 | `BizCode.ResourceNotFound` |
| ⑩ 查询 | 详情内容 | 含 5Ps 与信念原文 |
| ⑩ 编辑 | 内容变更 + 版本递增 + 未提供字段原样保留 | `version` 1→2；没传的字段**不是 undefined**，仍是原值 |
| ⑩ 编辑 | 编辑不存在 | `BizCode.ResourceNotFound` |
| 联动 | draft → 不命中 | resolver 返 `null` |
| 联动 | approved → 命中 | 注入非中性基线（信念非空、trust 对得上、displayName 对得上） |
| 联动 | **下架 → 下一场即回退中性** | `enabled=false` 后 resolver 返 `null` |
| 联动 | **软删 → 不命中但管理端仍可见** | resolver 返 `null`；`service.get` 仍能查到（`enabled=false`），可恢复 |
| 联动 | id 内容派生 | `id === deriveCharacterProfileId(templateId)` |

### `test/engine-adapters/wp9b-engine-stream-backend-wiring.spec.ts`（4 例 · 启动炸弹护栏）

| 用例 | 断言要点 |
|---|---|
| 工厂把 resolver 装进后端 | `openSession` 时 resolver **真的被调用**，且请求里带上了握手透传的 `templateId` |
| 不传 resolver → 中性基线 | persona 名回落「来访者」，**不抛**（角色是可选增强） |
| 模块必须用工厂注册 | `engine.module.ts` 里 `provide: EngineStreamBackend` 后面必须是 `useFactory`；**不得**出现裸类 provider 写法（那一行会让 Nest 按 `design:paramtypes` 解析 → token `Function` → 启动即炸） |
| `inject` 显式带上角色解析端口 | 工厂的 `inject` 段里必须同时出现 `EngineTurnService` 与 `CHARACTER_PROFILE_RESOLVER`（WP9-B 的 DB resolver 真的接上了） |

---

## 9. 闸门结果（本机复跑）

### 9.1 闸门命令与结果

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| `npx tsc -p tsconfig.scripts.json --noEmit` | **0 错** |
| `npx eslint "src/**/*.ts"` | **0 error / 0 warning** |
| `npx eslint --fix`（本轮新增的 3 个测试文件 + seed 脚本） | **0 error / 0 warning**（本轮新增文件单独干净；仓库 `bin/` `test/` 其余文件存在**既有 lint 债**，非本轮引入） |
| `npx jest test/engine-adapters/wp9b-db-character-resolver.spec.ts test/engine-adapters/wp9b-character-admin.spec.ts test/engine-adapters/wp9b-engine-stream-backend-wiring.spec.ts` | **3 套件 / 42 用例全绿** |
| `npx jest test/engine-core test/engine-adapters test/voice --maxWorkers=2` | **21 套件 / 440 用例全绿**（较 WP9-A 的 18/398 新增 3 套件 42 例；engine-core / WP9-A 既有用例零回归） |
| **`npm start`（真起服务）** | **启动成功**：`Nest application successfully started`；`/engine/admin/character-profiles` 5 个路由全部 mapped；无 token 访问该端点 → **401**（路由在、守卫生效）；全程无 `ERROR` / `ExceptionHandler` |
| `node scripts/e2e-voice-ws-probe.mjs`（真实 WS 探针） | 握手 ✓（`ready` 帧 + 速查卡代号 **晚晴** + `dbSessionId` 落库）；`llm_start` → `llm_done` ✓、**无 error 帧** ✓；但 **`llm_text` 0 条**（来访没开口）—— 根因是 LLM 的 token 预算字段用错，见 §7 缺口 8 |
| `npm run migration:run` | `AddCharacterProfiles1714900000023 executed successfully`；复跑 → `No migrations are pending` |
| `npm run migration:revert` | **成功**（表被删，报 `Table 'mofang_dev.character_profiles' doesn't exist`）；再 `migration:run` → 表恢复 |
| `npm run seed:character-profiles` | 首跑 `新增 4 / 更新 0 / 未变 0`；连跑 `新增 0 / 更新 0 / 未变 4`（**幂等**） |
| `DESCRIBE character_profiles` | **21 列**（与 §1.1 表逐列一致） |
| `SHOW INDEX FROM character_profiles` | `PRIMARY` / `uniq_cp_template_id` / `idx_cp_audit_enabled` |
| `git diff --stat HEAD -- src/engine-core` | **空**（内核整树零改动） |
| `git diff --stat HEAD -- src/voice src/agent/visitor` | **空**（voice 窄接口 / `voice.service.ts` / TTS / ASR / bridge / visitor 零改动） |

### 9.2 真实 WS 探针（`scripts/e2e-voice-ws-probe.mjs`）顺手修的两处

探针是仓库里已有的脚本（本轮之前从未在**能启动的服务**上跑过），实测时暴露两处与仓库既定契约冲突的地方，已就地修正：

| # | 现象 | 根因（仓库已写明的契约） | 修法 |
|---|---|---|---|
| 1 | 连接即 `socket hang up`，服务端**零日志** | WS 路径必须**精确等于** `/voice/training`（`ws` 的 `shouldHandle` 是精确比较），子路径 `/voice/training/<sid>` 在 **HTTP upgrade 阶段**就被 `abortHandshake(400)`；`sessionId` 要走 query | URL 改成 `ws://host:3000/voice/training?sessionId=…&token=…&templateId=…&mode=…`（仓库 2026-10-24 已修过这个坑，`voice-handshake.ts` 里有注释） |
| 2 | 连接成功、发了 `user_text` 后**一帧不回、不报错、无日志** | Nest `platform-ws` 默认 `messageParser` 只做 `JSON.parse`，随后按 `event` 找 handler、把 `data` 当 payload；裸帧 `{type,text}` 的 `event` 是 `undefined` → `handlersMap.get(undefined)` → 命中 `catch` 分支**静默丢弃** | 帧改成 Nest 信封 `{ event: 'message', data: { type: 'user_text', text } }`；另加 `mode` 参数（`text` 只跑 LLM 不碰 TTS —— `mode=voice` 下 TTS 起不来会**整轮静默丢弃**，连 `llm_start` 都不发） |

> **注意**：第 2 条说明**网关注释里的裸帧契约与实现不符**（见 §7 缺口 9，需前端确认 Flutter 实际发的是哪种）。

---

## 10. 实际落点清单

### 新增（8 个源文件 + 1 个迁移 + 1 个脚本 + 3 个测试）

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/wiring/character/character-profile.entity.ts` | `character_profiles` 实体（21 列映射 + `uniq_cp_template_id` + `idx_cp_audit_enabled`；`CharacterAuditStatus` / `CharacterFivePs` 类型） |
| `src/engine-adapters/wiring/character/db-character-profile.resolver.ts` | `DbCharacterProfileResolver` + `toCharacterSeed` 纯映射（**零公式**） |
| `src/engine-adapters/wiring/character/character-profile.seed.ts` | 4 个 slug 内容基线 + `validateCharacterProfileSeedSpecs` + `buildCharacterProfileSeeds` + `deriveCharacterProfileId`（sha1→UUID）+ `seedCharacterProfiles` 幂等 upsert + `canonicalJson` 键序比较 |
| `src/engine-adapters/wiring/character/character-profile.admin.service.ts` | CRUD / 上下架 / 过审 / 软删（业务逻辑） |
| `src/engine-adapters/wiring/character/character-profile.admin.controller.ts` | 5 端点（class 级 `JwtAuthGuard` + `AdminRoleGuard`） |
| `src/engine-adapters/wiring/character/character-profile.dto.ts` | Create / Update(`PartialType`) / Admin / List / Query DTO（class-validator + swagger） |
| `src/engine-adapters/wiring/character/character-pool.module.ts` | **独立 Nest 模块**（`forFeature` + `UserModule` + 管理端 + `CHARACTER_PROFILE_RESOLVER` 绑定 + `readCharacterSource`） |
| `src/migration/1714900000023-AddCharacterProfiles.ts` | 手写 DDL migration（up 幂等 / down 净回滚） |
| `bin/seed-character-profiles.ts` | 最小 DataSource seed 执行入口（内容自检 → 幂等 upsert） |
| `test/engine-adapters/wp9b-db-character-resolver.spec.ts` | 任务单 §7 A / B 段 + C 口径护栏 + D 内容基线 + E 档位一致（25 例） |
| `test/engine-adapters/wp9b-character-admin.spec.ts` | 任务单 §7 C.10 管理端与联动（13 例） |
| `test/engine-adapters/wp9b-engine-stream-backend-wiring.spec.ts` | 引擎版对话后端的**工厂装配 + 启动炸弹护栏**（4 例） |

### 修改（8 个文件）

| 文件 | 改动 |
|---|---|
| `src/engine-adapters/wiring/engine.module.ts` | 只 `imports: [CharacterPoolModule]`；移除 `@nestjs/typeorm` / `typeorm` / `AdminRoleGuard` / `UserModule` / 管理端直引；**零 SDK 包名**；`exports` 里的角色端口改为转出**整个 `CharacterPoolModule`**（Nest 不允许转出 imported module 的单个 provider）；`EngineStreamBackend` 改为**工厂装配**（`useFactory` + `inject: [EngineTurnService, CHARACTER_PROFILE_RESOLVER]`），拆掉 WP8-B 遗留的启动炸弹 |
| `src/engine-adapters/wiring/engine.providers.ts` | 新增纯工厂 `createEngineStreamBackend`（+ `EngineStreamBackendDeps`）—— 构造逻辑归工厂、`@Module` 只声明 token ↔ 工厂的映射（仓库既定原则）；**绕开 adapter 的 `design:paramtypes` 退化**（`import type` → `Function`），adapter 一行未动 |
| `src/engine-adapters/wiring/character/index.ts` | barrel **收紧为 ORM-free**（只导出端口 + 内置种子/映射） |
| `src/agent/llm/llm.service.ts` | 超时/重试数改读**已归一化的配置命名空间**（`minimax.llmTimeoutMs` / `minimax.llmMaxRetries`），不再用 `config.get<number>('MINIMAX_*')` 读**裸 env 键**（那会拿到字符串 → `AbortSignal.timeout('60000')` 抛错 → **每次 LLM 调用都炸**）。详见 §2.7。**这是 WP9-B 之外的既有缺陷修复**，与角色池无关，但阻塞了 WS 端到端验证 |
| `src/migration/index.ts` | 1:1 导出新 migration |
| `bin/ormconfig.ts` | 显式数组末尾登记新 migration（漏登记 = 静默不建表） |
| `package.json` | 新增 `"seed:character-profiles"` 脚本 |
| `scripts/e2e-voice-ws-probe.mjs` | 修 WS URL（路径必须精确 + `sessionId` 走 query）与帧信封（Nest 要 `{event,data}`）+ 加 `mode` 参数。详见 §9.2。**该脚本本轮之前从未在能启动的服务上跑过** |

### 红线核查

- `git diff --stat HEAD -- src/engine-core` → **空**
- `src/voice/**`（含 tts / asr-token / `voice-session-bridge.ts`）→ **零改动**
- `src/voice/voice.service.ts`、`src/voice/voice-turn-backend.port.ts` → **零改动**
- `src/agent/visitor/**` → **零改动**（`src/agent/llm/llm.service.ts` 是 §2.7 的 LLM 超时修复，与角色池无关）
- `src/engine-adapters/wiring/engine-stream-backend.adapter.ts`（WP9-A 冻结） → **零改动**
- 引擎装配层 `src/engine-adapters/wiring/*.ts`（仅顶层）→ **零 SDK 包名**（WP8-A §8-9 护栏绿）
- `src/engine-core` 零新增 `@nestjs/` / typeorm / 网络
- **未改 `.env`**（灰度开关 `ENGINE_VOICE_ENABLED` 缺省关，是既定行为）


---

## 11. 交接 WP9-C / 后续

- **真实 `vpt_*` slug 现在有角色了**。下一轮端到端联调前确认：`visitor-pool-templates.seed.ts` 里那 6 个 slug 中，**晚晴 / 小满 / 亦舟 / 念安 4 个有 approved 角色行**，阿禾 / 小舟 仍回退中性（§7 缺口 2）。
- **角色语义进渲染 prompt**（coreBeliefs 影响口吻）→ 渲染四手法（Phase2）。
- **可观测性**：`characterSource: builtin|db` + 命中的 `templateId` 进 WP13 留痕（§7 缺口 5）。
- **单一角色注册中心**：Phase2 合并 `visitor_pool_templates` + `character_profiles`（任务单 §11.1）。
- **resolver 端口即抽离缝**：今天查 MySQL，终局换成对"角色服务"的 HTTP/gRPC 调用即可，**注入点零改动**（任务单 §11.2）。
