# WP42 交付记录 — 咨询同盟三维（trust / safety / bond 独立建模）

> 状态: ✅ 已交付
> 任务单: [`wp42-counseling-alliance-three-dimensions-2026-11-03.md`](wp42-counseling-alliance-three-dimensions-2026-11-03.md)
> 日期: 2026-11-03
> 红线: **engine-core 预批准例外**（已在 Phase2 WP 清单登记；改完 `boundary.spec.ts` **11 条断言全绿**）

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`，预批准例外）：1 增 + 7 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/cognition/alliance-config.ts` | **新增**：同盟三维端口（`AllianceConfig` / `AllianceDeltaOverride` / `AllianceDeltaOverrides` / `AllianceThresholds` / `DEFAULT_ALLIANCE_CONFIG`）+ 门槛校验回退 |
| `src/engine-core/domain/bdi-snapshot.ts` | `BdiSnapshot` 加 `safety` / `bond` 两维；`cloneBdiSnapshot()` 一起带走 |
| `src/engine-core/domain/bootstrap.ts` | 新增 `DEFAULT_SAFETY = 0.5` / `DEFAULT_BOND = 0`，初始快照装配 |
| `src/engine-core/cognition/state-transition.ts` | `DeltaVector` 加 `safety` / `bond`（9 维 → 11 维）；`ZERO` / `DELTA_TABLE` / `CAP_DIMS` / `DEFAULT_DELTA_CAP_CONFIG` 同步；`aggregateTurnDelta()` 接端口覆写；`addDeltaVectors()` / `applyDeltaVector()` 补两维；`TransitionStateOptions` 加 `alliance?` |
| `src/engine-core/cognition/intention-planner.ts` | 决策改三维：探索门槛 `min(trust, safety) >= open`，抗拒触发 `trust < resistTrust || safety < resistSafety` |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | 构造注入 `allianceConfig?`；turn 管线**三处**消费同一端口（事件 delta / 临时快照 / 意图规划） |
| `src/engine-core/cognition/trajectory/trajectory-applier.ts` | 剧本偏移 → delta 向量时 `safety` / `bond` 补 0（本期剧本不覆盖这两维） |
| `src/engine-core/index.ts` | barrel 追加 5 个公开符号（WP26 P2-16 同款理由：公开面由断言⑥守住） |

### 1.2 适配层（`src/engine-adapters/**`）：1 增 + 3 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/wiring/alliance-config.ts` | **新增**：`resolveAllianceConfig(config)` —— 25 个 `ENGINE_ALLIANCE_*` 键**逐个字面量**读，非法值不覆写（= 回退内核种子值） |
| `src/engine-adapters/wiring/delta-cap.config.ts` | cap 维度 9 → 11（新增 `ENGINE_CAP_SAFETY_UP/DOWN`、`ENGINE_CAP_BOND_UP/DOWN`） |
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineSessionTuningDeps` 加 `allianceConfig?`，透传给内核会话 |
| `src/engine-adapters/wiring/engine.module.ts` | `ENGINE_SESSION_PORT` 的 useFactory 注入 `allianceConfig: resolveAllianceConfig(config)` |

### 1.3 配置

| 文件 | 改了什么 |
|---|---|
| `.env.example` | cap 族 18 → 22 键；**新增** `ENGINE_ALLIANCE_*` 25 键（**全部留空** = 继承内核种子值） |
| `typings/global.d.ts` | 显式声明 4 个新 cap 键 + 25 个 `ENGINE_ALLIANCE_*` 键（仓库约定：不许用 bracket / 计算键绕过） |

### 1.4 测试

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp42-alliance-three-dimensions.spec.ts` | **新增**，23 例（三维独立 / 回归 / 边界 / 端口注入 / cap / 会话层一致） |
| `test/engine-adapters/wp42-alliance-config.spec.ts` | **新增**，7 例（env 装配 / 非法值回退 / 22+3 键逐个可配） |
| `test/engine-core/boundary.spec.ts` | 断言⑥ 白名单 +5 个符号；断言⑦ 目录清单 +`cognition/alliance-config.ts` |
| `test/config/wp25-env-example-coverage.spec.ts` | cap 族清单 18 → 22；**新增断言③d**（`ENGINE_ALLIANCE_*` 25 键逐个字面量读 + 内核树零该族字符串） |
| `test/engine-core/wp15-delta-cap.spec.ts` | 3 处 `DeltaVector` 字面量补两维（新增必填字段的机械适配，断言值不变） |
| `test/engine-adapters/wp26-delta-cap-config.spec.ts` | 维度数 9 → 11、env 键数 18 → 22 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 同盟三维的系数**留在 DELTA_TABLE**，端口只做"覆写"——不是为了偷懒，是为了单一真相源

任务单 §3.3 要求「DELTA_TABLE 加基础规则」，§4 又要求「新字段走注入（`AllianceConfig` 端口），不硬编码到内核」。两者会打架：如果 `AllianceConfig` 里放**完整**的系数表，`DELTA_TABLE` 里再放一份完整表，就是两个会漂移的真相源（仓库反双胞胎纪律明确禁止）。

**实现口径**：`DELTA_TABLE` 保留任务单 §3.3 的 11 种事件 × safety/bond 基础系数（数值逐字照搬任务单表格）；`AllianceConfig.deltas` 是**按维度覆写**（`{ safety?: number; bond?: number }`）——

- 只覆写 `safety` 时，`bond` 仍走 `DELTA_TABLE` 基础值；
- 端口缺项 → 走基础值；
- 内核零 env 读取（`boundary.spec.ts` 断言⑩ 守着）。

于是"系数走端口注入"成立（有效系数 = 端口覆写 ?? 基础表），同时基础表只有一处。

### 2.2 抗拒模式**保留了原有的整体防御聚合前提**（与任务单 §3.4 的一处偏差，重要）

任务单原文：「抗拒模式的触发：`trust < 0.4 || safety < 0.3`」。**字面照做会引入一个回归**：

默认基线 `trust = 0.3`（`DEFAULT_TRUST`），内置角色的 trust 是 0.2 / 0.28。若把 `trust < 0.4` 单独当抗拒触发（去掉 `aggregate >= 0.6` 这个"整体防御强"前提），那么**每一场全新会话、每一个内置角色，从第一轮起就是 `resistance` 策略** —— 那不是"三维化"，是行为大改。

**实现口径**：抗拒分支 = `aggregate >= HIGH_RESISTANCE_AGG && (trust < resistanceTrust || safety < resistanceSafety)`。

- `aggregate`（阻抗三维）是与信任无关的独立条件，保留；
- 三维化只替换了原来那一项 `snapshot.trust < 0.4` → 变成二维 OR。

**效果**：旧行为逐字保留（`trust` 维判定与 WP1 一致），新增的只是「safety 塌到低位也进抗拒」这一条路径（已有用例覆盖）。

### 2.3 探索门槛用 `min(trust, safety)`，**纽带感不进门槛**

任务单 §3.4 明确 `min(trust, safety) >= OPEN_TRUST`。`bond` 不进门槛的理由：**纽带感是"关系深度"的刻度，不是"敢不敢说话"的刻度** —— 一个来访完全可以还没产生情感连接，但已经足够安全（这正是安全型来访的典型路径）。把 bond 塞进门槛会把"初识但安全"误判成"不安全"。

### 2.4 门槛值也走端口（`AllianceConfig.thresholds`）

任务单只要求系数走端口，但 §3.4 给的三条门槛（0.6 / 0.4 / 0.3）同样是**部署形态**的决定（内测期大概率要调"多信任一点才敢探索"这条线），所以一并放进端口：内核种子值仍是任务单给的三个数，env 可覆写，非法值（不在 [0,1]）逐项回退种子值。

### 2.5 初始值 safety = 0.5 / bond = 0（任务单 §3.1），**不接角色种子**

任务单没给角色的 safety / bond 基线。硬造一个"回避型起始安全感更低"就是发明临床数字 —— 与 §3.5「不发明临床数字」同一纪律。角色侧要分化时，走 `AllianceConfig` 端口或后续 WP 扩角色基线。

`bond` 初始为 0 的口径：纽带是情感连接，开场不存在，只能靠共情 / 接纳 / 肯定一轮轮长出来。

### 2.6 剧本（trajectory）偏移**不覆盖** safety / bond

`SnapshotDelta` 契约本期没有这两项，任务单也没给剧本的同盟三维口径 → `toDeltaVector()` 里固定补 0。

**已知后果（写在这里，别在 review 时当成 bug）**：一个只写 `delta: { trust: 0.3 }` 的剧本幕会抬 trust 但不抬 safety，于是 `min(trust, safety)` 仍可能卡在探索门槛外。剧本要推进同盟三维，需要后续 WP 给 `SnapshotDelta` 补两项并过同一把 cap。

### 2.7 依恋系数**仍然只调 trust**（任务单 §3.5，照做）

`personality-modulator.ts` 一行没动：WP34 的依恋系数只作用于 trust 的增益方向与阻抗下降方向，safety / bond 不参与。理由同任务单：没给依恋对安全感 / 纽带的影响系数，不发明临床数字。端口与契约已就位，内测有反馈再补。

### 2.8 env 面：25 个 `ENGINE_ALLIANCE_*` + 4 个新 cap 键

- 25 = 11 种事件 × 2 维覆写 + 3 个门槛；
- **全部留空**（`.env.example` 里是生效行但值为空）→ 继承内核种子值，与 `ENGINE_CAP_*` / `ENGINE_MOD_*` 同一口径（模板里不写数值 = 不会盖掉内核改过的种子）；
- 适配层**逐个字面量**读（不走计算键）→ env 覆盖断言的 AST 抽取看得到，漏写一个键断言立刻变红（新增断言③d）。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | **0 error**（exit 0） |
| `npx eslint "test/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **88 个测试文件 / 1320 例全绿**（其中新增 WP42 用例 30 例：内核 23 + 适配层 7） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **11 条断言全绿**（含断言⑥ 公开面双向白名单、断言⑩ 内核零 env / 零 globalThis） |
| `git diff --stat HEAD -- src/engine-core` | 7 改 + 1 增（**预批准例外，不是空**）：`cognition/alliance-config.ts`（新）、`cognition/intention-planner.ts`、`cognition/state-transition.ts`、`cognition/trajectory/trajectory-applier.ts`、`domain/bdi-snapshot.ts`、`domain/bootstrap.ts`、`in-memory/in-memory-engine-session.ts`、`index.ts` |

**回归确认**：既有 WP1 / WP15 / WP26 / WP34 用例零改动通过（只有 `DeltaVector` 字面量因新增必填字段做了机械补字段，断言值一个没改）。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **渲染层不看 safety / bond** —— `RenderSpec` / prompt 仍只有 `trust`。任务单 §3 没要求；渲染要按"安全感低就降压"来措辞，是另一件事。
2. **角色种子不带 safety / bond**（见 §2.5）。
3. **剧本偏移不带 safety / bond**（见 §2.6）。
4. **依恋系数不调 safety / bond**（见 §2.7，任务单 §3.5 明写）。
5. **BDI 快照落库**仍是内存态（WP32 的活）—— safety / bond 随快照一起走，落库那一轮不用额外设计。

---

_创建：2026-11-03_
