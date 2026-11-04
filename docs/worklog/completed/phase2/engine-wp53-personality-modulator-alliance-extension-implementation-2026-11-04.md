# WP53 交付记录 — 人格调节算子扩展到同盟三维（safety / bond）

> 状态: ✅ 已交付
> 任务单: [`wp53-personality-modulator-alliance-extension-2026-11-04.md`](wp53-personality-modulator-alliance-extension-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ⚠️ **engine-core 已改（预批准例外）** —— `git diff --stat HEAD -- src/engine-core` 含 **1 个文件**（`cognition/personality-modulator.ts`，87 insertions / 11 deletions），**无其他文件**

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`）：1 改（无新增文件）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/cognition/personality-modulator.ts` | ① `AttachmentModulation` 加 `safetyScale` / `bondScale` 两列（**必填**，带种子值与方向说明）；② `DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment` 四种依恋类型各补两个种子值（secure 1.0/1.0、avoidant 0.5/0.5、anxious 0.7/1.3、disorganized 0.6/0.8）；③ `NEUTRAL_ATTACHMENT` 补两个 1.0；④ `sanitizeTrustScale` → **改名** `sanitizeGainScale`（现在同时管 trust / safety / bond 三个增益型倍率）；⑤ `resolveAttachment` 补两项「非法 → 逐项回退种子值」；⑥ `modulateDeltaByPersonality` 输出补 safety / bond 两维（**只调增益方向**） |

### 1.2 适配层 + 配置：3 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/wiring/personality-modulator.config.ts` | `resolveAttachment` 从 2 参数扩到 4 参数（trust / resist / safety / bond）；4 种依恋类型各加 2 个**字面量** env 读取（8 个新键）；文件头「10 个键」口径改 18 |
| `.env.example` | 新增 8 个 `ENGINE_MOD_*_SAFETY/BOND_SCALE` **生效行**（**故意留空** = 继承内核种子值）；段头注释 10 → 18 键并补 SAFETY/BOND 的语义说明 |
| `typings/global.d.ts` | 新增 8 个 `ProcessEnv` **显式声明**（仓库约定：不用计算键 / bracket 访问绕过；WP34 的同款做法） |

### 1.3 测试：3 改 + 1 增

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp53-personality-alliance-extension.spec.ts` | **新增**，**24 例**（safety 差异化 / bond 差异化 / **只调增益方向** / 四系数叠加 / 非法回退 / 零回归 / AllianceConfig 叠加顺序 / cap 位置 / 会话层落库路径） |
| `test/engine-core/wp34-personality-modulator.spec.ts` | **适配**：4 条种子值 `toEqual` 断言补两列；7 处 `PersonalityModulatorConfig` 字面量补两列（**否则编译不过**） |
| `test/engine-adapters/wp34-personality-modulator-config.spec.ts` | **适配 + 扩展**：「配了 10 个键」→「配了 18 个键」；非法值用例补新系数的脏值；**新增 1 例**「只配新同盟系数 → 该系数生效、同组另一个回退种子值」 |
| `test/config/wp25-env-example-coverage.spec.ts` | 断言③c 的 `PERSONALITY_MOD_ENV_KEYS` 清单 **10 → 18 键**（**不改则断言立刻红**） |

### 1.4 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp53-personality-modulator-alliance-extension-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP53 行 ✅ + 交付记录链接；统计进度 7/35 → 8/35；engine-core 例外表 +WP53 行 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP53；进度回写 8/35；目录结构说明 +WP53 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 偏差①（最重要）：**实际要改 7 个文件，不是任务单说的 4 个** —— 其中 3 个是**机器断言**逼出来的

任务单 §5.2 列了 3 个适配层文件（`config.ts` / `.env.example` / 适配层测试）。实际 grep 核实后发现**还有 3 个必须跟着改**，否则**编译不过或测试直接红**：

| 多出来的文件 | 谁逼的 | 不改会怎样 |
|---|---|---|
| `typings/global.d.ts` | 仓库 env 治理约定（文件头自述「显式声明到 ProcessEnv」） | 8 个新键在类型层「不存在」；且与 WP34 的做法不一致（那 10 个键都显式声明了） |
| `test/config/wp25-env-example-coverage.spec.ts` | 断言③c 把 `ENGINE_MOD_*` 键**硬编码成 10 条清单**，逐条比对适配层里的字面量读取点 | 适配层多读 8 个键 → **断言③c 立刻红** |
| `test/engine-core/wp34-personality-modulator.spec.ts` | `AttachmentModulation` 的新字段**必填** → 7 处 `PersonalityModulatorConfig` 字面量缺字段 → **编译错误**；另有 4 条种子值 `toEqual` 断言会因多出两个键而失配 | 编译不过 / 断言红 |

**这 3 个都不在 `src/engine-core/**`** —— 不触碰「只改 `cognition/personality-modulator.ts` 一个内核文件」的约束（闸门实测：`git diff --stat HEAD -- src/engine-core` 只有 1 个文件）。

**为什么不把新字段改成选填来绕开编译错误**：选填会让「漏配 = 该维度不调节」变成**静默**行为；而必填字段让每一个构造点都被编译器盯着（WP34 交付记录 §2「端口是公开契约」的同款思路）。代价只是补 7 个字面量。

### 2.2 偏差②：`sanitizeTrustScale` 改名 `sanitizeGainScale`

任务单没提。改名理由：这个私有函数现在同时校验 `trustScale` / `safetyScale` / `bondScale` 三个**增益型倍率**（极性相同：≥ 0 的乘数），沿用「信任系数」的名字会让后来人以为它只服务 trust —— **名字会骗人**。按**极性**命名（增益型 vs 水平型）而不是按**维度**命名，与内核里 `sanitizeResistanceScale`（水平型除数）的命名轴一致。

纯私有函数改名，**零行为变化、零公开 API 变化**。

### 2.3 决策：新字段**必填**（任务单 §3.1 口径）

任务单 §3.1 写的是 `readonly safetyScale: number`（非选填），照办。

必填的好处是**编译期兜底**：任何构造 `AttachmentModulation` 的地方（内核 1 处 + 测试若干处）都必须显式给值 —— 新增字段时不会漏改某一处而让它悄悄变成 `undefined`。内核的 `sanitizeGainScale` 仍然接受 `number | undefined`（运行时来自 JSON / DB 的脏值照样回退）。

### 2.4 决策：`NEUTRAL_ATTACHMENT` 的新系数必须**显式**写 1.0

「没有依恋类型的角色 → delta 逐字不变」是零回归的前提。新系数若忘了补 → `undefined` → `sanitizeGainScale(undefined, seed)` 恰好也会回退到 1.0，但**依赖回退**而不是**依赖显式值** = 脆弱。显式写 1.0，让「中性」这件事一眼可见。

### 2.5 决策：受损方向仍然不调，但必须是**逐维度**独立

任务单 §4.2 说「受损方向保持基准速率」。实现上要保证是**逐维度**的：`delta.safety < 0` 时 safety 不乘系数，但 `delta.bond > 0` 时 bond 仍然乘 —— 两者互不影响。

测试里专门用 `sensitive_touch` 事件（safety −0.01 受损、trust 0 不动、bond 0 不动）钉住这一点：如果实现误写成「trust 受损就整体不调」或「一维受损就整条 delta 都不调」，这条用例会红。

### 2.6 决策：不碰 `state-transition.ts` / `in-memory-engine-session.ts`（任务单 §5.4 ✓）

算子是纯函数，扩展发生在它**内部** → 两处调用点（`transitionState` 的临时快照 / 会话层的落库路径）自动跟着受益，**调用方一行不用改**。

已用会话层用例验证两件事：① 「落库路径真的带上调节」（回避型 safety 0.5 + 0.02×0.5 = 0.51、bond 0 + 0.01×0.5 = 0.005）；② 「落库路径与内核 `transitionState` 路径逐字一致（provisional 不漂）」。

### 2.7 决策：cap 位置不变（调节仍在 cap **之前**）

safety / bond 是 cap 的 11 维之一（WP42 加的）→ 被调节放大的值同样受单回合 cap 约束。测试里把 `safetyScale` 放大到 100 → 0.02×100 = 2.0 → 被砍到 0.2；cap 报告的 raw 是**调节后**的 2.0（与 trust 的口径一致 —— 报告只显示真实被砍掉的量）。

### 2.8 遗留登记：任务单的**优先级**与母版不一致（**未改**，需大炮拍板）

- 任务单头部写 🟡 **P1**；
- 母版 `phase2-wp-list-2026-11-03.md` 把 WP53 列在 🟢 **P2**（且在「技术债清理」段）。

**优先级分桶未改** —— 改它会连带 P1 / P2 统计数字（17→18 / 10→9）与批次计划，属规划口径，不是本单该顺手拍的事。仅登记在此。

### 2.9 种子值逐字照搬任务单 §3.2（工程种子值，非临床标定）

| 类型 | trustScale | resistanceScale | safetyScale | bondScale |
|---|---|---|---|---|
| secure | 1.0 | 1.0 | **1.0** | **1.0** |
| avoidant | 0.6 | 1.3 | **0.5** | **0.5** |
| anxious | 1.2 | 0.8 | **0.7** | **1.3** |
| disorganized | 0.8 | 1.2 | **0.6** | **0.8** |

与任务单 §6.1 的两条验收逐条自洽：「回避型 safety 只有安全型一半」（0.02 → 0.01）、「焦虑型 bond 比安全型大 30%」（0.01 → 0.013）。

⚠️ 全部是**工程种子值，非临床标定** —— 待真实对练校准（与 WP34 / WP42 / WP36 / WP57 同一纪律）。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **95 个测试文件 / 1458 例全绿**（WP57 基线 94 文件 / 1433 例 + 本轮新增 **1 文件 / 24 例** + 适配层新增 **1 例**，**零回归**：1433 + 24 + 1 = 1458 ✓） |
| `npx vitest run test/engine-core/wp53-personality-alliance-extension.spec.ts` | **24 例全绿** |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（边界断言全过：零 @nestjs / 零网络 / 零 env / 零 prompt） |
| `npx vitest run test/config/wp25-env-example-coverage.spec.ts` | **通过**（断言①②③c 全绿 —— 18 个 `ENGINE_MOD_*` 键逐字面量读、`.env.example` 生效行一一对应、内核树零 `ENGINE_MOD_*` 字符串） |
| `git diff --stat HEAD -- src/engine-core` | **1 个文件**（`cognition/personality-modulator.ts`），87 insertions / 11 deletions —— **正是任务单 §6.2 要求的范围，无其他** |

**回归确认**：

- 没有依恋类型的角色 → delta **逐字不变**（`NEUTRAL_ATTACHMENT` 四列全 1.0）；
- `secure` 型 → delta **逐字不变**（四列全 1.0）；
- 未知依恋类型（运行时脏值）→ 回落 ×1.0，delta 逐字不变；
- WP34 的 **20 例**内核用例与 **5 例**适配层用例**全部保留**（只补了新字段，未改断言口径）；
- 宜人性**不扩展**到 safety / bond（只放大 trust）—— 有例钉住；
- 被调节放大的 safety / bond **依然受单回合 cap 约束**（0.02×100 = 2.0 → 0.2）。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **宜人性扩展到 safety / bond**（任务单 §4.1）—— 宜人性是 WP34 的示例级实现，只调 trust 的增益；本期只把**依恋系数**补完整。
2. **受损方向调节**（任务单 §4.2）—— 「被否定时回避型安全感掉得更快」这类系数没有临床依据，**不发明临床数字**。
3. **依恋类型对记忆召回的影响**（任务单 §7 第 3 条）—— 那是记忆层的事（WP2 / WP59 范围）。
4. **env 键的实际值**（任务单 §7 第 4 条）—— 端口已就位，env 留空继承内核种子值，内测后再调。
5. **WP49 的大五人格数据源** —— 依然没有：宜人性在生产上仍休眠。本单只补依恋系数，不碰那条线。
6. **优先级分桶**（母版 P2 vs 任务单 P1）—— 见 §2.8，需大炮拍板。

---

_创建：2026-11-04_
_深度通知：任务单 §2.1（现有接口）/ §2.2（调用位置与管道顺序）/ §2.4（DELTA_TABLE 基础值）/ §3.2（种子值）/ §4.3（与 AllianceConfig 的叠加关系）/ §5.3（env 键清单）逐条核实 + 真实代码 grep（env 治理断言①②③c / WP34 既有测试影响面 / alliance-config 的覆写口径）_
