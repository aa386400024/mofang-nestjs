# WP59 交付记录 — 记忆召回策略配置端口统一

> 状态: ✅ 已交付
> 任务单: [`wp59-recall-policy-config-port-2026-11-04.md`](wp59-recall-policy-config-port-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ✅ **engine-core 只改 2 个文件**（任务单 §5.1 预批准清单，**一字不多**）—— `git diff --stat HEAD -- src/engine-core` = 2 files
> 边界断言: ✅ `boundary.spec.ts` 11 条全绿（含 ⑪ 适配层深路径 import 与 ⑥ barrel 公开面双向白名单）

---

## 1. 实际改了哪些文件

### 1.1 内核：2 改（预批准清单内，一字不多）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/memory/recall-policy.ts` | ① 新增 `RecallPolicyOptions` 接口（`halfLifeMs?` / `minEffectiveImportance?`，**两个字段都可选**）；② `evaluateRecallCandidate` 加第 5 个可选参 `options: RecallPolicyOptions = {}`；③ 内部改走 `resolveRecallPolicy(options)` helper（省略的字段回落到内核默认常量 `DEFAULT_DECAY_HALF_LIFE_MS` / `RECALL_MIN_EFFECTIVE_IMPORTANCE`）；④ 文件头加 WP59 段 + 判定规则第 7 条补注"阈值可注入" |
| `src/engine-core/in-memory/in-memory-memory.store.ts` | ① `InMemoryMemoryStoreOptions` 加 `recallPolicy?: RecallPolicyOptions` 配置端口；② 构造器存下 `this.recallPolicy`；③ `recall` 调用处把策略喂进内核判定；④ 文件头加 WP59 段 |

### 1.2 适配层：4 改（任务单 §5.2 只列了 1 个 → **偏差登记**，见 §2.1）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/persistence/qdrant-memory.store.ts` | ① **消除双层判定**：内核判定直接吃配置值，删掉 B 层第二道门槛；② 排序用的有效重要度改用内核算出的**同一个值**（不再自己复算一遍）；③ 内置回落仓喂同一份策略（降级路径与正常路径结果一致）；④ 去掉已无用的 `effectiveImportance` import；⑤ 文件头加 WP59 段 |
| `src/engine-adapters/persistence/memory-config.ts` | ① 新增 `toRecallPolicyOptions(config)` 映射函数（映射**只留这一处**）；② 顶部"内核地板不可绕过 / 阈值只能收紧"的说明**已过期**，改写成 WP59 后的真实口径 |
| `src/engine-adapters/wiring/engine.providers.ts` | ① `createEngineMemoryStore` 把**同一份**配置喂给内存版（纯内存部署此前**完全忽略** env 配置）；② `EngineMemoryStoreDeps.config` 的注释同步 |
| `src/engine-adapters/wiring/engine.module.ts` | **仅注释**：把"这两个值只对 Qdrant 版生效 / 阈值只能收紧"改成 WP59 后的真实口径 |

### 1.3 测试：2 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp2-memory.spec.ts` | **扩展**：新增「⑨ WP59 · 召回策略配置端口统一」describe 块 **5 例**（零回归 / `halfLifeMs` 生效 / `minEffectiveImportance` 生效 / 只覆盖一个字段 / 内存版 `recallPolicy` 端口生效） |
| `test/engine-adapters/wp12-memory-closeout.spec.ts` | **扩展**：① `StubQdrant.search` 从"恒返回空数组"改成可注入检索点（**之前召回路径从没被真正走通过**）；② 新增「WP59 · 召回策略配置端口统一」describe 块 **4 例**；③ memory-config describe 加 **1 例**（映射函数）；④ 文件头补 WP59 段 |

### 1.4 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp59-recall-policy-config-port-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP59 行 ✅ + 交付记录链接；统计进度 13/35 → 14/35 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP59；进度回写 14/35；目录结构说明 +WP59 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策：适配层改了 **4 个文件**，任务单只列 1 个（**偏差**）

任务单 §5.2 写的是「适配层改动（1 个文件）：`qdrant-memory.store.ts`」。本单实际改了 4 个 B 层文件（另 1 个仅注释），理由逐条如下：

| 多改的文件 | 为什么必须改 |
|---|---|
| `memory-config.ts` | ① 需要一个 `MemoryConfig → RecallPolicyOptions` 的映射函数（两套字段名，见 §2.5）；② **它顶部那段说明在本单之后变成了假话** —— 原文写着"内核那道 0.1 地板**不可绕过** / 阈值**只能收紧**"，本单把内核地板变成了**默认值**，配置值直接生效。留着不改 = 注释与代码矛盾（仓库纪律：注释是给下一个人的真相源，不能过期）。 |
| `engine.providers.ts` | **不接这一层，内存版的 `recallPolicy` 端口在生产上就是死代码。** 装配层 `createEngineMemoryStore` 里 `new InMemoryMemoryStore()` 是**纯内存部署时的正式记忆仓储**（没配 Qdrant 就直接返回它）—— 它此前**完全忽略** `MEMORY_DECAY_HALF_LIFE_DAYS` / `MEMORY_RECALL_THRESHOLD`。任务单 §4.3 问的"内存版和 Qdrant 版行为会一致吗？会" —— 不接这一层，答案是**不会**，纯内存部署与向量版部署召回结果不同。任务单 §5.3 的原话"配置端口已经有了，只是接线到内核"指的正是这一步。 |
| `engine.module.ts` | **仅注释**。这里写着"⚠️ 这两个值**只对 Qdrant 版生效**（纯内存版的判定在内核里，走内核那份常量）/ 内核地板仍在，阈值只能收紧" —— 本单之后这两句都不成立了。 |

**没有越界**：这 4 个文件全在 `src/engine-adapters/`（B 层），没碰 `engine-core` 红线之外的地方，没碰 `.env` / 配置文件，没改 `MemoryStore` 端口方法签名，没碰 `MemoryRecallQuery` / `MemoryHit` / `MemoryEntry` / `conflict-resolution.ts`。

### 2.2 决策：内核判定里抽 `resolveRecallPolicy` helper（而不是内联两个 `??`）

`evaluateRecallCandidate` 改动前的圈复杂度已经是 **19**（eslint 上限 20，越线即 error）。任务单 §3.1 的草图把两个 `??` 直接内联进函数体 —— 那是 **21**，直接越线。

按 WP51 的既有教训（抽 helper，不写 `eslint-disable`），本单把配置解析抽成 `resolveRecallPolicy(options)`：helper 自己复杂度 3，判定函数本体**仍是 19**，一行没涨。功能上与任务单草图**完全等价**。

### 2.3 决策：内核端口类型**不进 barrel**，适配层用**结构化类型**

内核端口 `RecallPolicyOptions` 是个**公开端口类型**，按仓库既有惯例（`DeltaCapConfig` / `AllianceConfig` / `SessionDecayConfig` 都是这样）应该从 barrel 导出。但本单不能这么做：

- 边界断言 ⑪：适配层**只能** import `engine-core/index.js` 或 `engine-core/in-memory/**`，深路径 import 内核内部模块会红；
- 边界断言 ⑥：barrel 的公开出口面是**双向精确白名单** —— 加一个导出就要同步改断言 ⑥ 的 `expectedPublic`，那是**第三个内核文件**（`index.ts`）+ 第四个文件（断言本身）；
- 任务单 §6.2 的闸门原文：「`git diff --stat HEAD -- src/engine-core` → **只改 2 个文件**」。

动第三个内核文件超出任务单的预批准范围（AGENTS.md §5.1：例外必须由大炮明确批准）。所以本单选**结构化类型**：B 层用 `{ readonly halfLifeMs: number; readonly minEffectiveImportance: number }` 声明返回类型 —— TypeScript 结构性兼容保证它就是内核那个端口，**调用点仍被编译期校验**（内核端口字段若改名，调用点立刻编译报错）。

**留档**：若将来有消费方需要**显式声明**这个端口的类型（比如自定义召回策略实现），走一个"往 barrel 加端口类型 + 同步断言 ⑥ 白名单"的独立 WP（与 WP36 / WP42 加端口类型的做法一致）。

### 2.4 决策：Qdrant 版的接受集合**只会变宽，不会变严**（这是数学结论，不是感觉）

把两版判定写成布尔式：

```
旧 (双层判定): accept ⟺ [eff_默认30天 ≥ 0.1] ∧ [eff_配置 ≥ 阈值]
新 (单层判定): accept ⟺ [eff_配置 ≥ 阈值]
```

新条件是旧条件的**后件** → `新接受集合 ⊇ 旧接受集合` **恒成立**。也就是说：

- **默认配置下（30 天 / 0.1）两者完全相同** → 零回归（用例 ① 钉死）；
- 改了配置之后，接受集合**只可能变大，不会变小** —— 绝不会出现"配了 env，召回反而少了"这种反直觉的结果；
- 变大的典型场景：配置半衰期**长于** 30 天（衰减更慢），或阈值**低于** 0.1 —— 这两种情况下旧的内核地板反而在"误杀"。

用例 ② 正是这个场景的钉子：一条 100 天前的记忆，内核默认 30 天口径只剩 `0.5 * 2^(-100/30) ≈ 0.0496`（旧口径下被内核那道拦下），配置 90 天口径剩 `≈ 0.2315` → 新口径放行。

### 2.5 决策：B 层 `MemoryConfig` 与内核端口**保持两套字段名**，用映射函数连接

`MemoryConfig` 用 `decayHalfLifeMs` / `recallThreshold`，内核端口用 `halfLifeMs` / `minEffectiveImportance` —— 是同一组数字，但字段名不同。本单**不合并成一套**（合并要改 `MemoryConfig` 的公开形状 + env 接线，属 WP12 的契约），而是加一个映射函数 `toRecallPolicyOptions(config)`，**映射只留这一处**。

理由是仓库的一条老教训：判定/转换逻辑一旦写两份，就会在某个 WP 里悄悄分叉。三个消费点（Qdrant 版的内核调用、Qdrant 版的内置回落仓、装配层的内存版）全部走这一个函数。

### 2.6 决策：Qdrant 版的**内置回落仓**也喂同一份策略

`QdrantMemoryStore` 自带一个内存回落仓（向量库不可达 / embed 失败时兜底）。降级路径的 visitor 范围召回**也要过同一道判定**，若回落仓用内核默认值而正常路径用配置值，就会出现"向量库抖一下 → 召回结果变一套"这种最难查的漂移。

因此构造器里把回落仓改成 `new InMemoryMemoryStore({ recallPolicy: toRecallPolicyOptions(this.config) })`（构造器里 `this.config` 的赋值顺序相应前移）。

### 2.7 决策：**不改** `MemoryConfig` 的字段名，也**不改** `.env` 键名

`MEMORY_DECAY_HALF_LIFE_DAYS` / `MEMORY_RECALL_THRESHOLD` 两个 env 键**一字未动**（任务单 §5.3）。本单只改"配置值怎么进内核"这一段，不动配置面本身。

### 2.8 决策：`StubQdrant.search` 从"恒返回空数组"改成可注入检索点

改之前这个 stub 的 `search` 永远返回 `[]` —— 意味着**Qdrant 版的召回路径从来没被任何测试走通过**，"Qdrant 版的召回判定"只能靠读代码确认，测不到。本单要验"配置值直接生效"，就必须让它搜得出东西。

这是**测试基础设施的补齐**，不是为了让用例通过 —— 用例断言的是具体的数值关系（`0.2315 ≥ 0.1` 放行 / `0.0693 < 0.3` 拒绝），stub 返回空数组的话这些断言根本不会执行。

### 2.9 任务单 §2 盘点与实测的偏差：backlog 里 WP59 的一句话范围更大

`phase2-wp-list-2026-11-03.md` 里 WP59 的一句话描述是"召回策略还很原始——没有 Top-N 截断、没有过期过滤、相似记忆没有冲突消解……落法：先做最简单的 Top-K + 时间衰减加权"。实际盘点：

| backlog 提到的那几件事 | 实际状态 |
|---|---|
| Top-N 截断 | **WP56 已做**（prompt 侧只取 Top3） |
| 过期过滤 | **内核早已有**（`evaluateRecallCandidate` 判定规则第 3 条：过期 → 拒绝） |
| 冲突消解（召回时） | **内核早已有**（第 4 条：`supersededBy` 非空 → 拒绝；写侧由 WP12 标 `supersededBy`） |
| 时间衰减加权 | **内核早已有**（`effectiveImportance`），本期把它**变成可配置** |

所以剩余的真缺口就是"**策略不可配置**"，也就是任务单的范围。本单做完，backlog 那句"落法：先做最简单的 Top-K + 时间衰减加权"已全部落地。

### 2.10 决策：数值是**工程种子值**，本单不引入任何新的临床数字

本单没有新增任何阈值或系数，只把**已有的两个种子值**（30 天 / 0.1）变成可配置项。配置值本身仍由 `resolveMemoryConfig` 归一（非法值回退默认，不抛错）。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **97 个测试文件 / 1536 例全绿**（WP56 基线 97 文件 / 1526 例 + 本轮新增 **10 例**，**零回归**：1526 + 10 = 1536 ✓） |
| `npx vitest run test/engine-core/wp2-memory.spec.ts` | **44 例全绿**（原 39 例 + 本轮新增 **5 例**） |
| `npx vitest run test/engine-adapters/wp12-memory-closeout.spec.ts` | **40 例全绿**（原 35 例 + 本轮新增 **5 例**） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（11 条不变量 + 1 条扫描自检） |
| `git diff --stat HEAD -- src/engine-core` | **恰好 2 个文件**（`memory/recall-policy.ts` + `in-memory/in-memory-memory.store.ts`），纯函数扩展 ✓ |

**回归确认**：

- **内核零回归** —— 不传 `options` 时 `evaluateRecallCandidate` 的行为与改动前**逐字一致**（用例 ① 用 `toEqual` 钉死 4 参调用与 5 参空对象调用完全相同）；
- **默认配置零回归** —— Qdrant 版默认配置（30 天 / 0.1）下召回结果与改动前一致（用例 ① 钉死：60 天前召回、100 天前不召回）；
- **阈值口径没变** —— 阈值卡的是"配置半衰期算出来的**有效重要度**"，不是原始重要度（用例 ③ 专门区分这两者）；
- **排序口径没变** —— 排序用的有效重要度与门槛判定用同一个值（改动前 B 层复算一遍，本单改为直接取内核算出的值，数值完全相同）；
- **既有断言零改动** —— WP2 / WP12 的既有用例**一条没改**，只新增 describe 块；
- **边界零破坏** —— 内核零 `process.env` / 零 `globalThis` / 零 NestJS / 零 typeorm（断言 ① ⑤ ⑩）；barrel 公开出口面**一字未动**（断言 ⑥ 的双向白名单原样通过）；适配层**零**深路径 import 内核内部模块（断言 ⑪）。

**一次偶发失败已复核**：全量跑第一遍时 `test/counselor/wp21-report-stream.spec.ts` 挂过 1 例（报告 SSE 推送，与本单无关）。单独复跑该文件 **15 例全绿**，全量复跑 **97 文件 / 1536 例全绿** —— 判定为并行负载下的偶发（该用例自带 `report_stream_reload_failed` 的定时重载逻辑），**不是本单引入的回归**。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **召回结果的多样性保证**（任务单 §7 第 1 条）—— 现在召回可能返回 5 条同主题记忆，需要多样性保证。那是后面的事。
2. **召回时的去重/聚类**（任务单 §7 第 2 条）—— 现在是写入时做冲突消解，召回时不做。那是后面的事。
3. **Admin Dashboard 展示召回配置**（任务单 §7 第 3 条）—— 那是前端的事，本期只做后端。
4. **召回策略的临床校准**（任务单 §7 第 4 条）—— 本期是工程种子值，内测后按真实对练校准。
5. **内核端口类型进 barrel**（见 §2.3）—— 需要同步改 `index.ts` 与边界断言 ⑥ 的白名单，超出本单预批准的"只改 2 个内核文件"范围，留给后续独立 WP。
6. **阈值配到 < 0.1 的现实后果** —— 本单让阈值可以低于内核默认值（§2.4），这在**技术上**正确（配置值直接生效），但"放宽记忆召回门槛"属于产品决策，生产 env 暂不建议这么配；本单**未改任何 env 默认值**。

---

_创建：2026-11-04_
_深度通知：`evaluateRecallCandidate` 现签名与内部判定 8 条 / `effectiveImportance` 已有的 `halfLifeMs` 参数 / 内核常量 `DEFAULT_DECAY_HALF_LIFE_MS` 与 `RECALL_MIN_EFFECTIVE_IMPORTANCE` / 内存版调用点 / Qdrant 版双层判定 4 行 / `MemoryConfig` 形状与 env 归一 / 装配层 `createEngineMemoryStore` 分流逻辑 / 边界断言 ⑪ 与 ⑥ 的真实约束 / eslint `complexity` 上限 20 与 `evaluateRecallCandidate` 实测复杂度 19 / 全量基线 97 文件 1526 例 —— 逐条 grep 核实_
