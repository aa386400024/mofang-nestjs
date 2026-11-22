# Phase2.5 · S-1 探索深度门槛端口化 —— 交付记录

> 状态：✅ 已交付（2026-11-12）
> 任务单：`docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-task-2026-11-12.md`（开工单，含大炮例外批准声明）
> 事实源：`docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-2026-11-12.md`（S-1 任务单）
> 预研结论：`docs/worklog/pending/phase2.5-s1-research-result-2026-11-12.md`（R1–R8 证据 + 风险 A–I）
> 执行方：MiniMax Code
> 仓库 / 分支：`mofang-nestjs` / `integrate`
> 改动性质：**core 纯端口化**（局部常量 → 端口字段，种子值逐字 0.35 不变，缺省零行为变化）+ 适配层一行种子透传（不接 env）

---

## 1. 一句话总结

`intention-planner` 探索分支的第二个条件 `depth < LOW_DEPTH`（planner 文件内局部常量 0.35）已并入既有同盟门槛端口：新增可选字段 `AllianceThresholds.openDepth`，种子 **0.35 逐字不变**，解析口 `resolveAllianceThresholds` 两条路径都补全为 [0,1] 内完整数字，适配层 wiring 补一行种子透传（**不接 env**），镜像类型同步；删掉局部常量 `LOW_DEPTH`。**缺省路径判定结果与改造前逐字一致（零行为变化）**，全量 3072 例全绿、boundary 12 绿。

## 2. 实际方案 vs 任务单偏差（conventions §2.5）

共 4 处偏差，全部是「按任务单红线与仓库纪律落地所必需的调整」，无一处为省事。

### 2.1 偏差 1：`resolveAllianceThresholds` 返回类型改为内联交叉类型

| 项       | 内容                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 任务单   | 未规定返回类型（现状是 `: AllianceThresholds`）                                                                                                                                                                                                                                                                                                        |
| 实际方案 | `: AllianceThresholds & { readonly openDepth: number }`（**内联**，不另起导出类型别名）                                                                                                                                                                                                                                                                |
| 为什么   | `openDepth` 是**可选**字段（注入形状允许缺项），但 strict 模式下消费方（planner）要直接比大小，必须拿到非空 `number`；若不改返回类型，planner 里就得写 `?? 0.35` 兜底 —— 那是**第二份种子真相源**（反双胞胎）。用内联交叉类型而不是新增导出的类型别名，是为了**不新增任何导出名**（内核公开面是契约，`boundary.spec.ts` 断言⑥ 守着 barrel 双向白名单） |
| 兼容性   | 返回值仍是 `AllianceThresholds` 的子类型 → 既有 3 个调用方（`session-decay.ts:176` / `intention-planner.ts:51` / `alliance-config.ts:166`）**零改动**                                                                                                                                                                                                  |

### 2.2 偏差 2：`resolveAllianceThresholds` 的 `config` 形参改为可选

| 项       | 内容                                                                                                                                                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务单   | 未规定形参可选性                                                                                                                                                                                                                                                                        |
| 实际方案 | `config?: AllianceConfig`（原 `config: AllianceConfig                                                                                                                                                                                                                                   | undefined`） |
| 为什么   | 新 spec 要覆盖「无注入对象」路径，`resolveAllianceThresholds(undefined)` 触发仓库 lint 规则 `unicorn/no-useless-undefined`；改成可选形参后调用 `resolveAllianceThresholds()` 语义更准（"不传"而非"传 undefined"），且与同文件 `resolveSessionAllianceConfig(base?, override?)` 风格一致 |
| 兼容性   | 向后兼容：既有调用方全部显式传参，行为不变                                                                                                                                                                                                                                              |

### 2.3 偏差 3：种子值用模块私有常量 `DEFAULT_OPEN_DEPTH = 0.35`

| 项       | 内容                                                                                                                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务单   | 「种子 `thresholds.openDepth = 0.35`」                                                                                                                                                                                                                                                              |
| 实际方案 | 种子对象里写 `openDepth: DEFAULT_OPEN_DEPTH`，常量值为 **0.35**（模块私有，非导出）                                                                                                                                                                                                                 |
| 为什么   | 解析口的**早退分支**必须无条件产出完整 `openDepth`（预研风险 B）。若早退分支只依赖"种子对象碰巧带这个键"，日后有人改种子形状就会静默漏掉 → `depth < thresholds.openDepth` 变成 `depth < undefined`（恒 false → **探索分支永不触发**，编译还不报错）。常量与种子对象共用同一个值，**真相源仍是一处** |
| 可核对性 | 常量声明处即见 `= 0.35`；`grep 0.35` 仍只有一处数值                                                                                                                                                                                                                                                 |

### 2.4 偏差 4：G2 闸门命令修正（风险 G 的实测结论与开工单建议不同）

| 项         | 内容                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开工单建议 | `pnpm exec tsc -p tsconfig.json --noEmit`（含 spec）                                                                                                                                                                                                                                  |
| 实测       | 该命令在本仓**不可用作闸门**：根 `tsconfig.json` 的 `types: ["node"]` 不含 vitest globals → 全仓 54 个 spec 文件报 `Cannot find name 'describe'` / `'it'` / `'expect'`（纯噪音，与本单无关），命令必然 exit 2                                                                         |
| 实际采用   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`（CLI 覆盖 `types`，不落任何临时文件）                                                                                                                                                                         |
| 实测结果   | globals 噪音消除后仍剩 **396 条 / 86 个文件**的**既有债**（`bin/*` 的 `typings/global` 找不到 + unreachable code、`src/**/*.spec.ts` 的 `vi` 命名空间、`test/admin-debug/*` 的 `noPropertyAccessFromIndexSignature` 违规）—— 全部在**本单未触碰**的文件里；**本单相关文件错误数 = 0** |
| 结论       | 风险 G 的判断成立（`pnpm typecheck` 不覆盖 spec），但**建议的命令需按本仓实际调整**。本条同时回写预研结论的风险 G                                                                                                                                                                     |

## 3. 改动文件清单

### 3.1 core（本单经大炮例外批准的三文件，`git diff --stat HEAD -- src/engine-core` 实测）

| 文件                                             | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 行数                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `src/engine-core/cognition/alliance-config.ts`   | ① `AllianceThresholds` 加 `readonly openDepth?: number`（注释点明比较的是 `BdiResistance.depth` 阻抗维）；② 新增模块私有常量 `DEFAULT_OPEN_DEPTH = 0.35`；③ 种子对象加 `openDepth: DEFAULT_OPEN_DEPTH`；④ `resolveAllianceThresholds` **早退分支与正常分支都产出完整 `openDepth`**（早退分支 `return { ...seed, openDepth: DEFAULT_OPEN_DEPTH }`），复用既有 `sanitizeThreshold` 回落；⑤ `resolveSessionAllianceConfig` 的 `merged` 加 `openDepth: override.openDepth ?? baseThresholds.openDepth`（同走三条回落规则）；⑥ 返回类型改内联交叉类型 | 43 行                                                 |
| `src/engine-core/cognition/intention-planner.ts` | ① **删除局部常量 `LOW_DEPTH = 0.35`**（`noUnusedLocals` 强制必须删）；② 探索分支改 `depth < thresholds.openDepth`；③ 文件头补 S-1 变更说明                                                                                                                                                                                                                                                                                                                                                                                                       | 16 行                                                 |
| `src/engine-core/domain/engine-session.types.ts` | 镜像 `allianceThresholds` 加 `readonly openDepth?: number`；:76 注释「三字段严格 1:1」改「四字段严格 1:1」；**仍未 import cognition 类型**（依赖方向纪律不变）                                                                                                                                                                                                                                                                                                                                                                                   | 4 行                                                  |
| **合计**                                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **3 files changed, 56 insertions(+), 7 deletions(-)** |

### 3.2 适配层（开工单授权的一文件一行）

| 文件                                            | 改动                                                                                                                              | 行数                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `src/engine-adapters/wiring/alliance-config.ts` | 门槛组装加一行 `openDepth: seed.openDepth`（**种子透传，不读 env、不加 env 键**），使适配层产出的端口对象与内核种子**同为四字段** | 3 行                                |
| **合计**                                        |                                                                                                                                   | **1 file changed, 3 insertions(+)** |

### 3.3 测试

| 文件                                                           | 改动                                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/engine-core/s1-open-depth-threshold.spec.ts`（**新建**） | 14 例，五组：① 缺省回落 4 例（含"planner 仍按 0.35 判定 —— 探索分支没被静默关掉"）② 非法值回落 2 例 ③ 会话级覆盖 4 例（含"无覆盖仍返回 base 同一引用"）④ planner 边界两侧 3 例 ⑤ 镜像 1:1（**编译期**键集合断言 + 运行时字段名集合比对）1 例 |
| `test/engine-adapters/wp42-alliance-config.spec.ts`（改）      | :75-79 的三键 `toEqual` 补 `openDepth: 0.35`（**只补键，不放宽不等式**）；:37 / :95 / :107 三条全形状断言**自动绿**（两侧同为四键），未改动                                                                                                  |

### 3.4 明确未改

- `test/engine-core/boundary.spec.ts` —— 未改；断言⑥ / ⑦ 绿（12 例全过）。
- `src/engine-core/index.ts` —— 未改；**未新增任何 core 公开导出**（返回类型用内联交叉，不新增导出名）。
- `src/engine-core/cognition/session-decay.ts` —— 未改；`resolveThresholdSubset` 经解析口自动补全，`isRupturedState` 仍只读两个 resistance 门槛，**新字段不进破裂判定**。
- `src/engine-adapters/wiring/alliance-threshold-resolver.ts` / `engine-turn.service.ts` —— 未改（`Partial<AllianceThresholds>` 天然兼容可选字段）。
- env / `.env.example` / 装配 / resolver / module / migration / DB / prompt / 前端 / Flutter —— 未碰。
- 未跑批次、未调 LLM、未 commit / push。

## 4. 闸门（真实命令 / exit code / 真实数字）

> 跑前：PATH 补 `D:\Apps\Git\cmd`（避免 vitest 内部调 git ENOENT 假失败）；全程 pnpm，**未用裸 npx**。

| #   | 闸门            | 命令                                                                    | exit  | 数字                                                                                                                                            |
| --- | --------------- | ----------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **开工基线**    | `pnpm exec vitest run test/engine-core test/engine-adapters`            | 0     | Test Files **90 passed (90)**；Tests **1629 passed (1629)**；Duration 26.10s；墙钟 28s                                                          |
| 1   | 类型（src）     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0** | **0 error**；墙钟 11.4s                                                                                                                         |
| 2   | 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 2     | 全量 **396 条 / 86 个文件**（全部为**既有债**，见 §2.4）；**本单相关文件错误 = 0**；墙钟 18.4s                                                  |
| 3   | Lint            | `pnpm lint`                                                             | **0** | **0 error / 0 warning**（eslint 无任何输出）；另跑过 `pnpm exec eslint --fix` 于本单两个文件（exit 0）                                          |
| 4   | 定向测试        | `pnpm exec vitest run test/engine-core test/engine-adapters`            | **0** | Test Files **91 passed (91)**；Tests **1643 passed (1643)**；failed 0 / skipped 0；Duration 30.65s；墙钟 34s                                    |
| 5   | 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0** | Test Files 1 passed (1)；Tests **12 passed (12)**；Duration 1.87s                                                                               |
| 6   | 全量            | `pnpm test`                                                             | **0** | Test Files **188 passed \| 1 skipped (189)**；Tests **3072 passed \| 4 skipped (3076)**；failed **0**；Duration 93.47s；墙钟 96s                |
| 7   | core 变更面     | `git diff --stat HEAD -- src/engine-core`                               | 0     | **仅 3 文件**（`cognition/alliance-config.ts` / `cognition/intention-planner.ts` / `domain/engine-session.types.ts`），落在开工单例外批准范围内 |
| 8   | adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                           | 0     | **仅 1 文件**（`wiring/alliance-config.ts`），3 insertions                                                                                      |
| 9   | test 变更面     | `git status --short -- test`                                            | 0     | `M test/engine-adapters/wp42-alliance-config.spec.ts` + `?? test/engine-core/s1-open-depth-threshold.spec.ts`                                   |

**机器状态**：Windows 11 Home China 10.0.26300 64-bit；Intel Core i7-8550U @ 1.80GHz；15.9 GB RAM；Node v26.13.0；PowerShell 5.1.26100.9818；pnpm。**无 `nest start --watch` / `vite dev` 常驻进程**（进程扫描命中 1 个，命令行含 `vitest` 子串，是本次测试自身，非常驻服务）。

## 5. 风险 A / B / G 处理确认（开工单 §4 必钉三点）

### 风险 B · 静默行为变化单点 —— ✅ 已钉死

- **实现**：`resolveAllianceThresholds` 的**早退分支**由 `if (!provided) return seed;` 改为 `if (!provided) { return { ...seed, openDepth: DEFAULT_OPEN_DEPTH }; }` —— 早退也产出**完整**门槛；正常分支走 `sanitizeThreshold(provided.openDepth, DEFAULT_OPEN_DEPTH)`。种子值来源是**模块私有常量**，不依赖"种子对象碰巧带这个键"。
- **用例钉死（两条）**：① `resolveAllianceThresholds().openDepth` === 0.35（无注入对象路径）；② `resolveAllianceThresholds({ thresholds: { open, resistanceTrust, resistanceSafety } }).openDepth` === 0.35（三键注入路径）。
- **端到端钉死（一条）**：`缺省路径: planner 仍按 0.35 判定 —— 探索分支没被静默关掉`（trust 0.8 / safety 0.8 / depth 0.2 → `strategy === cognitive_exploration`）。这条直接证伪「`depth < undefined` 恒 false」。

### 风险 A · 断言形状一致 —— ✅ 已处理

- 适配层 wiring 补 `openDepth: seed.openDepth` → 适配层产出的端口对象与内核种子**同为四字段**。
- `wp42-alliance-config.spec.ts:75-79` 的三键 `toEqual` 补 `openDepth: 0.35`（**只补键，不放宽不等式**）；
- `:37` `expect(config).toEqual(DEFAULT_ALLIANCE_CONFIG)`、`:95` / `:107` `expect(config.thresholds).toEqual(DEFAULT_ALLIANCE_CONFIG.thresholds)` **自动绿**（两侧都四键）—— 实测该文件全绿。
- **没有删除或放宽任何既有断言**；唯一改动是一处 `toEqual` 的期望对象**加了一个键**。

### 风险 G · 类型闸门盲区 —— ✅ 已闭合（命令按实测修正）

- 开工单建议的 `pnpm exec tsc -p tsconfig.json --noEmit` 在本仓**必然 exit 2**（54 个 spec 文件的 vitest globals 噪音），不可用作闸门 —— 详见 §2.4。
- 实际闸门：`pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` → 本单相关文件 **0 错**；剩余 396 条 / 86 文件全部是本单未触碰文件的既有债。
- **本单相关的 5 个文件（3 core + 1 adapter + 2 spec）在该命令下 0 错**。

### 保护项复验

- `resolveSessionAllianceConfig` 无覆盖时**仍返回 base 同一引用**（`:153` 的 `if (!override) return base;` 未动）→ 新 spec ③ 的 `expect(resolveSessionAllianceConfig(BASE_CONFIG)).toBe(BASE_CONFIG)` 绿；既有 `i12:38` 同款断言绿。
- `isRupturedState`（`session-decay.ts:186-189`）仍只读 `resistanceTrust` / `resistanceSafety` → **新字段不进破裂判定**；`session-decay.ts` **零改动**。

## 6. 零回归基线对比

### 6.1 定向（core + adapters）

|          | Test Files     | Tests              | Duration | 墙钟 |
| -------- | -------------- | ------------------ | -------- | ---- |
| 开工基线 | 90 passed (90) | 1629 passed (1629) | 26.10s   | 28s  |
| 收尾     | 91 passed (91) | 1643 passed (1643) | 30.65s   | 34s  |
| **差值** | **+1 文件**    | **+14 例**         | —        | —    |

+1 文件 = 新增 `test/engine-core/s1-open-depth-threshold.spec.ts`；**+14 例恰好等于该文件的 14 个 `it`** → **零用例被删除 / 改名 / 跳过**（1629 + 14 = 1643，分毫不差）。

### 6.2 全量

| 阶段                         | Test Files                        | Tests                               |
| ---------------------------- | --------------------------------- | ----------------------------------- |
| intake-v2 交付时基线         | 187（186 passed + 1 skipped）     | 3029 passed / 4 skipped（3033）     |
| Phase3 P0 交付后（上一提交） | 188（187 passed + 1 skipped）     | 3058 passed / 4 skipped（3062）     |
| **本单交付后**               | **189（188 passed + 1 skipped）** | **3072 passed / 4 skipped（3076）** |

本单净增 = **+1 文件 / +14 例**（Phase3 的 +29 已含在 3058 基线内）。**failed 仍为 0，skipped 仍为 4（未新增）**。

### 6.3 缺省路径逐字护栏（不跑批次）

- 既有 `wp42-alliance-three-dimensions.spec.ts:215`「缺省端口 = 内核种子门槛 (逐字不变)」绿 —— 它比较「带 `DEFAULT_ALLIANCE_CONFIG`」与「不带端口」两次 `planIntention` 的 `strategy` **与** `rationale` 逐字相等。
- `wp42:44` 的 `OPEN_READY_RESISTANCE = { verbal: 0.1, depth: 0.2, style: 0.2 }`（depth 0.2 < 0.35）→ **探索分支确实被走到**，改阈值就会红。
- 新 spec 的三条端到端断言（缺省探索 / 边界两侧 0.34·0.35·0.36 / 同盟不过则不进探索）全绿。
- 本单**不触碰**事件聚合 / delta / cap / 信念演化 / decay 数值路径（decay 只读两个 resistance 门槛）→ 缺省路径下批次轨迹逐字不变，**无需批次复算**。

### 6.4 指纹侧知悉

`src/auto-practice/config-fingerprint.ts:52` 的 `alliance` 段挂 `alliance-config.ts` 文件哈希 → 本单改动会**改变该段哈希**（任何 core 改动的固有后果；映射关系未变）。旧批次快照与新批次的 `alliance` 段指纹不可直接相等，批次对比时需知悉。

## 7. 遗留项与边界声明

### 7.1 本单**不**解决的事（必须复述，避免误读为"门槛已修好"）

- **I-11 的数学不可达未被解决**：本单只把深度门槛**端口化**（可配置化），**不改任何阈值数值**（种子 0.35 逐字不变）。「探索双门槛使 12 轮内 7/8 角色不可达」这一**门槛结构问题**原样存在 —— 门是装上了，钥匙还没配。
- **「低 depth 是否为探索前提」的临床结构复核** —— 另案（任务单 §5.4 已拍板）。
- **可达性对账 / 事件模型拆分（S-2）/ 时序权重（S-3）** —— 另案，与本单互不改动对方文件。
- **深度门槛的真实覆盖来源**（按角色档案自动算）—— 端口已通，来源待**标定批次**接入；本单**不接 env**。

### 7.2 遗留项清单

| #    | 遗留项                                                                                           | 归属     | 备注                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| S1-1 | 深度门槛的 env 键（如 `ENGINE_ALLIANCE_OPEN_DEPTH_THRESHOLD`）与按角色解析                       | 标定批次 | 端口已通；接 env 时须同步 `.env.example`（仓库 env 扩列契约），适配层那行 `seed.openDepth` 改成 `resolveThreshold(env, seed.openDepth)` 即可 |
| S1-2 | I-11 双门槛叠加下的**可达性对账**（语桐 ~50 / 小满 ~125 / 沉舟 ~200 / 惊尘 ~250 轮的估算需复算） | 另案     | 门槛结构复核 + 批次复算                                                                                                                      |
| S1-3 | 「低 depth 作为探索前提」的临床假设是否成立                                                      | 另案     | 若推翻，需改的是门槛结构而非端口                                                                                                             |
| S1-4 | 根 `tsconfig.json` 全量类型检查的 396 条既有债（86 个文件）                                      | 技术债   | 本单顺带发现；`pnpm typecheck` 至今不覆盖 test/**，建议单独排期                                                                              |
| S1-5 | 预研单与预研结论仍留在 `pending/`                                                                | 主控决策 | 预研单 §4 明确要求结论写到 `pending/phase2.5-s1-research-result-2026-11-12.md`，故按其原指令保留；是否一并归档由主控定                       |

## 8. 交付回写清单（开工单 §7.2）

- [x] 交付记录写到 §7.1 路径
- [x] 本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录（**开工单**与 **S-1 规划任务单**两份都移 —— 两份各自 §7.2 都有同款要求）
- [x] 台账 `phase2.5-p1d-known-issues-2026-11-11.md` I-11 备注：深度门槛已端口化，种子未变，覆盖来源待标定批次
- [x] 结构债草案 §3 I-11 / §4.1 现状列同步
- [x] `phase2.5-wp-list-2026-11-08.md` §四 独立单登记状态
- [x] `phase2.5-README.md` §3 当前活清单登记
- [x] `git diff --stat HEAD -- src/engine-core` 与 adapter 变更面符合 §3.1（core 3 文件 / adapter 1 文件）
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，**不自行 commit / push**

## 9. 提交分组核对

**本单文件（建议同一 commit，10 个）**：

```
src/engine-core/cognition/alliance-config.ts              (modified)
src/engine-core/cognition/intention-planner.ts            (modified)
src/engine-core/domain/engine-session.types.ts            (modified)
src/engine-adapters/wiring/alliance-config.ts             (modified)
test/engine-core/s1-open-depth-threshold.spec.ts          (new)
test/engine-adapters/wp42-alliance-config.spec.ts         (modified)
docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-implementation-2026-11-12.md (new)
docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-task-2026-11-12.md                    (moved)
docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-2026-11-12.md                        (moved)
docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md            (modified · I-11 备注)
docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md (modified · §3/§4.1)
docs/worklog/pending/phase2.5-wp-list-2026-11-08.md                      (modified · §四)
docs/worklog/pending/phase2.5-README.md                                   (modified · §3)
```

**不属于本单（并行进程产物，勿混入）**：

```
docs/worklog/pending/phase2.5-s1-open-depth-research-minimax-2026-11-12.md   (预研单, 待主控定是否归档)
docs/worklog/pending/phase2.5-s1-research-result-2026-11-12.md              (预研结论, 按其 §4 原指令留在 pending)
.gitignore                                                                  (并行进程加的 data/quality/*.txt 规则, 非本单)
```

## 10. commit message 草稿（未 commit / 未 push）

```
feat(engine-core): 探索深度门槛端口化 (LOW_DEPTH 并入 AllianceThresholds.openDepth, 种子 0.35 不变)
```

---

_交付记录完成时间：2026-11-12（Asia/Shanghai）。本单按开工单例外批准改动 core 三文件 + 适配层一行；未接 env、未跑批次、未碰前端、未 commit / push。_
