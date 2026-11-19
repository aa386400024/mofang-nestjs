# AF-152 · 评分口径收口与 admin 调试引擎实数据化交付记录

- **taskId**：AF-152
- **日期**：2026-11-20
- **分支**：`task/AF-152-quality-admin`
- **基线**：`f5e08a8b572f08286430cab80971509a9d81dcd5`
- **实现提交**：`500d633`（admin 实数据化）、`526ebb8`（评分后处理与统计诊断）、`366a53a`（合并）、`2cfa96a`（引擎真实生效参数只读快照）
- **性质**：实现 + 验收材料收口，不是临床验收。`ai_proxy_candidate / humanSupervision=false / clinicalAcceptanceEligible=false`。

## 1. 交付结论

**结论分两半，不能混写：**

- **admin 调试引擎前端：达到“真实可用”标准。** 所有可操作入口走真实后端接口；后端没有的字段显示空态，不再前端造数；参数校准页保留离线沙盘，同时新增真实生效参数的只读快照。
- **AI 评分质量：仍未达标，且比 AF-146 表面结论更差。** 后处理硬上限把 safety 口径显式化后，AF-146 16 场的 safety 硬门由“通过”翻为“不通过”，六项硬门由 5/6 降为 **4/6**。96 场复算 overall κ 仍为 **0.365854 < 0.40**。

**不能写成“AI 层面质量达标”，也不能写成“临床质量达标”。** 余额是样本结构、跨模型刻度与真人督导缺位，不是靠调阈值能解决。

## 2. 评分侧交付

### 2.1 硬上限从提示词搬到后处理

| 规则 | 判定 | 封顶 |
| --- | --- | --- |
| 前 10 轮缺保密说明 / 边界说明 / 时长说明 / 可暂停可拒答 | 四类缺任一即命中 | safety ≤ 3 |
| 披露自伤自杀，但全稿无具体安全计划 / 求助路径 | 命中 | safety ≤ 2 |
| 上述两条同时命中 | — | 取更低者 2 |
| 逐评分员封顶后再合并 | 先 R1/R2 各自封顶，再按仲裁分合并 | 保留封顶留痕字段 |

- 提示词升 `ai-proxy-v4`，删除提示词内 safety 两条硬上限，改为“由后处理强制封顶”；style 硬上限仍在提示词内。
- `SAFETY_CAP_COMMITMENT_PATTERNS` 使用窄口径（`安全(计划|承诺|约定|协议)` 等紧邻匹配），避免把开场白“除非涉及你的安全或法律要求；我们约定这次只做咨询”误判为“已有安全计划”。
- 边界：封顶是**词面规则判定**，属 candidate 级结构证据，不做语义理解；它是“缺项必封顶”的必要条件，不是“有安全计划就合格”的充分条件。

### 2.2 统计诊断

新增并接线：

- `computeGwetAc1`（未加权 + 线性加权）。
- `computeKrippendorffAlphaOrdinal`。
- `computeClusterBootstrapKappa`：确定性 LCG，seed `20261120`，默认 2000 次；按 session / character / character-mode 三档簇重抽；报 2.5% / 97.5% CI、中位、`P(κ̂≥0.40)`、退化重抽次数。
- CLI 新增 `--bootstrap-reps`、`--bootstrap-seed`；`rebuild --pack-dir` 支持“重新判定封顶 → 重新合并（沿用原仲裁分）→ 重算一致性与诊断”。

### 2.3 96 场复算

数据：`af147-kappa-96-out` + `af147-kappa-96/blind-map.json`；只读复制 96 份逐字稿，未改 AF-070，未重跑任何 LLM 批次。

| 指标 | 值 | 判读 |
| --- | --- | --- |
| overall exact | **0.864583** | 过 |
| within±1 | **1.0000** | 过 |
| overall κ | **0.365854** | **< 0.40，失败** |
| overall AC1 | 0.857002 | 诊断 |
| α_ordinal | 0.378367 | 诊断 |
| session 簇 95% CI | [0.066667, 0.612903] | P(κ̂≥0.40)=37.6% |
| character 簇 95% CI（8 个） | [0.154185, 0.591054] | P=39.25% |
| character-mode 簇 95% CI（16 个） | [0.108108, 0.596639] | P=37.9% |

分维 κ：trust **0.194508**（P 过线 0.4%）、verbal **0.078891**（P 0.1%）是 overall 两个拖累项；depth 0.641457、style 0.565779；safety 封顶后 0.892183。

**关键边界：safety κ 从 0.659675 升到 0.892183 是封顶造成的机械升高，不能写成“safety 评分可靠”。** 真正反映评分员判断一致性的是封顶前 κ（96 场 0.660 / 16 场 0.522）。后续引用必须成对给出封顶前/后。

### 2.4 16 场 AF-146 复算与 safety 硬门翻转

| 指标 | 封顶前 | 封顶后 | 判定 |
| --- | --- | --- | --- |
| safety 平均 | 4.6875 | **3.5000** | 平均仍 ≥3.50 |
| safety 最低 | 4 | **2** | **< 3，硬门失败** |
| packet < 3 | 0 | **3** | **硬门失败** |
| 触发封顶 | — | **10/16** | 开场缺项 7、危机无计划 5、两条同命中 2 |
| 危机披露 | — | 8/16 | — |
| 开场四项齐全 | — | 9/16 | — |
| overall κ | 0.351351 | 0.351351 | **< 0.40，失败** |
| overall AC1 | — | 0.567811 | 16 场存在实质分歧 |
| α_ordinal | — | 0.414752 | 与独立手算一致 |

**判读：这是“评分口径被显式化后暴露原有隐性不一致”，不是“咨询质量变差”。但作为质量门，必须判失败。** AF-146 由 5/6 降为 **4/6**：safety 最低分、overall κ 两项失败；exact、within±1、overall 平均、style 仍过。

复算链自检：16 场 overall κ=0.351351 与 AF-146 已发布值逐位吻合，α_ordinal=0.414752 与独立手算一致。

## 3. admin 调试引擎实数据化

| 页面 / 文件 | 原有问题 | 处置 |
| --- | --- | --- |
| `SessionDetail.vue` | 用前后 BDI 快照反推 delta；safety/bond/verbal/depth/style 写死 0；events 写死 `['empathy']`；假 capReport；编造三条信念 | 直接使用后端 `deltaDetail`；事件直接 zip 同序 `eventTags/eventTagLabels`；删除假 cap / 假信念；新增真实 `crisis/degraded/deliberationTrace` 展示 |
| `DebugTracePanel.vue` | 无事件时 fallback 到“共情回应/开放提问”；手写事件映射；假装完整 prompt | 删除 fallback；只读后端 `eventTags/eventTagLabels`，空时明示“后端 eventTags 为空”；prompt 只展示真实 `promptPreview`（后端无 `promptFull`）；阻抗话量改读 `bdiSnapshot.resistanceVerbal` |
| `AutoPractice.vue` | 自动对练场次有假重命名 / 删除 / AI 重命名入口 | 删除假动作并说明 `ap_practice_sessions` 是审计表、无 title 列、不做软删；手动调试会话创建/发轮/加载/恢复/重命名/关闭/删除走真实接口；发轮用 `mergeTurn`、历史用 `hydrateSnapshot` |
| `ParamCalibrator.vue` | 整页前端默认表 + 本地模拟，曾被误读为真实引擎参数 | 明确“模拟沙盘”；新增只读“引擎真实生效参数”面板，读取新端点 `GET /admin/api/debug/effective-config`；沙盘不写回引擎 |
| `README.md` | 仍声明大量 mock | 删除过期 mock 清单，补自动对练/质量标注/批次回归/参数校准页面与数据边界 |
| 构建错误 | 多处 `vue-tsc` 类型错误 | 修 `watch` 未导入、`turns.value` 误用、avatar 索引、响应字段不存在、`promptFull` 不存在、雷达图六维越界、字符串布尔、`URLSearchParams` 误构造、`allPages` 未取 `.value`、`CostBoard` 缺 `loadData`、Dashboard 误用审议统计等；Dashboard 改 `api.gateStats()` 后对数组求和 |

### 3.1 新只读端点

`GET /admin/api/debug/effective-config`：

- 与引擎启动同一组 `resolveDeltaCapConfig / resolveSessionDecayConfig / resolvePersonalityModulatorConfig` 装配函数，返回 env 解析 + 非法值回退后的最终值。
- 只含数值型工程参数与开关：11 维 delta cap、三个衰减半衰期、四种依恋系数、宜人性参数、voice 开关、engineVersion。
- 不含密钥、endpoint、逐字稿、心理内容；纯读，不写 env、不写引擎运行态。
- 路由清单守卫测试同步加入该端点，继续断言 `AdminRoleGuard` 全覆盖。

## gateResults

| 命令 | exitCode | errors | warnings | 实测 |
| --- | --- | --- | --- | --- |
| `pnpm typecheck` | 0 | 0 | 0 | `tsc -b tsconfig.check.json`，01:56 通过 |
| `pnpm lint` | 0 | 0 | 0 | src/test/bin + scripts，0 error / 0 warning |
| `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts` | 0 | 0 | 0 | 2 files / 41 tests passed（29 + 12） |
| `pnpm --dir admin-dashboard build` | 0 | 0 | 0 | 含 `vue-tsc`；vite build 2.41s，exit 0 |
| `pnpm test` | 0 | 0 | 0 | 221 files passed + 1 skipped；3886 tests passed + 4 skipped；23.58s |
| `git diff --name-only f5e08a8 -- src/engine-core` | 0 | 0 | 0 | 0 行，`src/engine-core` 零 diff |
| `pnpm exec vitest run test/admin-debug/wp26-admin-role-guard.spec.ts` | 0 | 0 | 0 | 1 file / 17 tests passed，路由清单含新端点 |
| `pnpm exec vitest run test/admin-debug/debug-session-persistence.spec.ts` | 0 | 0 | 0 | 1 file / 26 tests passed（全量并行下曾 1 次 10s 超时，单跑与复跑均通过，登记为已知 flaky） |

## scopeCheck

- **in-scope**。任务单 scope 已补：`test/admin-debug/wp26-admin-role-guard.spec.ts`、`data/phase25-exit/af152-*` 六目录、回执文件。
- 改动文件：`src/admin-debug/admin-debug.controller.ts`、`admin-dashboard/src/{api,views,README}`、评分三文件、两个测试、六组复算数据、回执、README、任务单、本记录。
- 未改 `src/engine-core`；`git diff --name-only f5e08a8 -- src/engine-core` 为空。
- 未纳入：AF-128 的 `src/shared/llm/reasoning-text.ts` / `test/shared/af106-reasoning-text.spec.ts` 仍在工作区，与本单无关；大量 `data/` 历史未跟踪产物未提交。
- 未改 AF-147/AF-148 已归档材料，未改 AF-070 的 96 份逐字稿。

## contractChecks

| item | result | note |
| --- | --- | --- |
| taskId | pass | AF-152 任务单、状态索引、回执、交付记录一致 |
| stateWrite | pass | register / promote / run-once 均经 CLI；状态面未手改 |
| indexSchema | pass | task-state-index 由 CLI 写入 |
| eventChain | pass | `events verify` 通过；无手写事件 |
| taskSheetEncoding | pass | UTF-8 无 BOM、LF；六组机读标记在本记录逐字出现 |
| thresholdFreeze | pass | 0.40 / 3.50 / safety≥3 均未下调；未把未达标写成达标 |
| engineCoreBoundary | pass | `src/engine-core` 零 diff |

## backlogItems

| 编号 | 遗留 | 处置 |
| --- | --- | --- |
| OI-AF152-01 | AF-146 safety 硬门封顶后失败（3 个 packet <3） | 另单做“内容级开场/危机计划校验 + 新批次复评”；不得下调 safety≥3，不得用旧样本改判 |
| OI-AF152-02 | 96 场 overall κ 0.365854 < 0.40，P(过线) 约 38% | 扩到 ≥24 独立角色簇 / ≥48 packet 且覆盖 ≥3 profile；不重复 session 凑 n |
| OI-AF152-03 | trust κ 0.194508、verbal κ 0.078891 是主要拖累 | 另单做逐维锚点校准与评分员刻度对齐；0.40 不动 |
| OI-AF152-04 | safety 封顶后 κ 机械升高，易被误读 | 报告与看板必须成对展示封顶前/后 κ；封顶前值才是判断一致性 |
| OI-AF152-05 | 真人督导师双盲 + 仲裁仍未到位 | 保持 `ai_proxy_candidate`；真人到位后只替换 R1/R2/R3 适配器 |
| OI-AF152-06 | admin 页面未在真实后端 + DB 环境做人工冒烟 | 部署环境起后端后按“创建→发轮→恢复→重命名→关闭→删除→校准页读快照”走一遍 |
| OI-AF152-07 | 全量 `debug-session-persistence` 在 222 worker 并行下偶发 10s 超时 | 单跑稳定通过；登记为测试基础设施 flaky，不掩盖、不放宽业务断言 |
| OI-AF152-08 | safety 封顶仍是词面规则，不做语义判定 | 保持 candidate 级结构证据；后续加内容级校验，不把“有承诺词”当“有安全计划” |

## deviationTable

| 项 | 任务单要求 | 实际 | 处置 | 原因 |
| --- | --- | --- | --- | --- |
| 任务编号 | 原 AF-149 直接做 | AF-149/150/151 因 `scope-domain-conflict` 连续 reissue | 由 AF-152 以 `agentRole: executor` 承接 | 不改写已归档终态，不手改状态面 |
| 范围 | 评分三文件 + admin | 增加 `test/admin-debug/wp26-admin-role-guard.spec.ts`、六组 data、回执 | 任务单 scope 显式补齐 | 路由清单测试必须跟随新端点；证据必须可追溯 |
| safety 结论 | 硬上限后处理 | 封顶后 AF-146 safety 硬门失败，整体 4/6 | 如实判失败并写入 README/记录 | 不把“口径显式化”粉饰成“质量变好” |
| κ 结论 | 补 CI / AC1 / α | κ 仍 0.365854 <0.40；只有 8 个 characterSlug | 如实判未达标；CI/AC1/α 只作诊断 | 不调阈值、不重复 session 凑簇 |
| admin 参数页 | 读取真实生效配置作只读参考 | 新增后端只读端点 + 前端只读面板 | 沙盘与真实值分区，不写回 | 原页面只有前端种子值，无法满足只读对照 |
| 全量测试 | 收尾一次 | 首轮 1 个超时；单跑与二次全量通过 | 记录 flaky 与复跑结果 | 不隐瞒首轮失败 |
| Node 版本 | 仓库要求 `>=26` | 当前 v22.23.2，pnpm 仅 WARN | 命令全部 exit 0，记录 WARN | 环境限制，不伪称版本满足 |

## reviewVerdict

**conditional-pass**：AF-152 的实现类验收项全部落地，admin 前端已实数据化，评分后处理/统计诊断/96 场与 16 场复算可复现，闸门全绿，`src/engine-core` 零 diff；但 AI 质量门仍为 **4/6**，safety 硬门封顶后失败、overall κ 0.365854 < 0.40，故不是“AI 层面质量达标”，更不是临床验收达标。可以归档本单的“实现与取证”，不能归档“质量达标”。

## 4. 复现与证据

- 评分代码：`src/auto-practice/metrics/ai-double-blind.ts`、`bin/ai-double-blind.ts`、`test/auto-practice/ai-double-blind.spec.ts`。
- 96 场：`data/phase25-exit/af152-cal96-out/`、`af152-cal96-precaps/`、`af152-cal96-pack/`。
- 16 场：`data/phase25-exit/af152-af144-out/`、`af152-af144-precaps/`、`af152-af144-pack/`。
- 回执：`docs/worklog/pending/relay-response-AF152-20261120-0149.md`。
- 复现命令：`pnpm exec tsx bin/ai-double-blind.ts report --pack-dir data/phase25-exit/af152-cal96-pack --out data/phase25-exit/af152-cal96-out`（参数名以 CLI `--help` 为准；本轮原始命令与 provenance 已随输出落盘）。
- 阈值口径：overall κ ≥0.40；safety 平均 ≥3.50 且无 packet <3；style 平均 ≥3.50；exact ≥0.50；within±1 ≥0.875；overall 平均 ≥4.00。
