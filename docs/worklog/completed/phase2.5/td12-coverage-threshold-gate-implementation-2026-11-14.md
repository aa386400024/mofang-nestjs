# TD-12 · coverage 阈值门禁 交付记录（全局聚合阈值 · 观察期不阻断 build）

| 项        | 值                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 任务单    | `docs/worklog/pending/td12-coverage-threshold-gate-task-2026-11-14.md`（交付后归档至 `docs/worklog/completed/phase2.5/td12-coverage-threshold-gate-task-2026-11-14.md`） |
| 事实源    | TD-11 交付记录 §5.3（首轮 coverage 报告）+ `docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-12                                                           |
| 基线 HEAD | `fed30f4`（TD-11 已 push；本单不产生 src / test 改动）                                                                                                                   |
| 执行      | MiniMax Code，2026-11-14                                                                                                                                                 |
| 闸门      | 全绿；采集 + 阈值校验 **exit 0**，四指标全部高于阈值                                                                                                                     |
| 改动面    | **仅 `vitest.config.mts` 一个文件**（配置层，零业务代码）                                                                                                                |

---

## 一、本单做了什么

在 `vitest.config.mts` 的 `coverage` 段新增 `thresholds`，立**全局聚合**四指标门禁（statements 44 / branches 43 / functions 40 / lines 44，`perFile: false`）：覆盖率低于阈值时采集命令 **exit 非 0**、CI coverage job **转红**。阈值唯一真相源就是该配置文件；注释写明基线来源（TD-11 §5.3 / HEAD `1696e59`）、拍板日期 2026-11-14 与「只随实测提升上调、不向下放宽」的演进纪律。除该文件外**零代码改动**（`src/` 0 文件、`test/` 0 文件、engine-core 0 行）。

---

## 二、方案设计：实际实现 vs 任务单方案（偏差登记，conventions §2.5）

| 编号 | 任务单原方案                                             | 实际方案                                                                                                                                                        | 理由                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | §2 表内建议默认值（44 / 43 / 40 / 44，`perFile: false`） | **逐字按建议落地**，未做任何调整                                                                                                                                | 复跑四指标均高于阈值且相对首轮基线偏差 ≤0.01pp（≪ 3pp 红线）→ 不触发「停下回报」条件，无需拍板新值                                                                                                                                                                                                                                                                                                                                                                                              |
| D-2  | 未要求反向验证                                           | **额外跑了一次小样本采集做反向验证**：`pnpm run test -- --coverage test/config` → 四指标全部 `ERROR: Coverage for X does not meet global threshold`，**exit 1** | 证明门禁**真的会转红**（而不只是配置被接受）。仅观测，不改任何代码；产生的 `coverage/` 已清理                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-3  | 「记录四指标命中/总量」                                  | 命中数与首轮基线有**微小差异**：statements +2、branches +1、lines +2（百分比 ≤0.01pp）                                                                          | 如实登记；来源为运行时非确定性（与时间 / 环境相关的分支判定），量级远小于 3pp 红线，不构成停机条件。百分比四舍五入后与首轮一致                                                                                                                                                                                                                                                                                                                                                                  |
| D-4  | §5.1 列根 tsc / build tsc 为闸门                         | 两项均 **exit 0**，但**它们并不覆盖 `vitest.config.mts`**                                                                                                       | 既有工程事实：`tsconfig.json` 的 `include` = `typings/global.d.ts` + `src/**/*` + `test/**/*` + `bin/**/*`，**不含根级 config 文件**。因此本单的类型正确性由 ①任务单 §1 给出的 vitest 5.0.5 `Thresholds` 接口定义逐字段核对（`node_modules/vitest/dist/chunks/plugin.d.C8mmycim.d.ts:1984`，字段 = `statements` / `functions` / `branches` / `lines` / `perFile` / `autoUpdate` / `100`）② vitest 运行时加载 config（反向验证 + 全量采集均正常加载）两条保证。**不改 tsconfig**（超出本单范围） |
| D-5  | §5.0「跑闸门前确认机器干净」                             | 机器**不干净**（5 个用户常驻进程），未擅自杀用户进程                                                                                                            | 这些是你自己的开发进程（`pnpm start:dev` / `nest start --watch` / `pnpm dev` / admin-dashboard vite dev / `node dist/app`），杀掉会打断你的工作；任务单 §2 亦明确墙钟只记录不比较。故如实登记机器状态，盘读延迟用 `pnpm doctor:fs` 单独体检（合格）                                                                                                                                                                                                                                             |

---

## 三、改动文件清单

### 3.1 修改（1 个）

- `vitest.config.mts` —— `test.coverage` 段新增 `thresholds`（四指标 + `perFile: false`），并在配置注释里写明基线来源 / 拍板日期 / 演进纪律 / 唯一真相源声明。**该文件是阈值的唯一真相源**。

### 3.2 新建 / 删除（0 个）

### 3.3 范围核对（实测）

| 项          | 命令                                        | 结果                                                       |
| ----------- | ------------------------------------------- | ---------------------------------------------------------- |
| 生产代码    | `git diff --name-only HEAD -- src`          | **0 个文件**                                               |
| 测试目录    | `git diff --name-only HEAD -- test`         | **0 个文件**                                               |
| engine-core | `git diff --stat HEAD -- src/engine-core`   | **空（0 行）**                                             |
| 配置        | `git diff --stat HEAD -- vitest.config.mts` | **1 file changed（仅 coverage 段新增 thresholds 与注释）** |

---

## 四、闸门表（真实命令 / exit code / 真实数字）

| 闸门                | 命令                                                                    | exit  | 真实数字                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置            | `pnpm doctor:fs`                                                        | 0     | 合格（per-file 均值 **0.26 ms/文件**、slow=1（5.3 ms 单文件）、walk 39 ms）                                                                                                                                                                                                                                                                                                                                                 |
| 根类型              | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0     | **0 error**（注：不含 `vitest.config.mts`，见 D-4）                                                                                                                                                                                                                                                                                                                                                                         |
| 构建类型            | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0     | **0 error**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Lint（权威）        | `pnpm lint`                                                             | 0     | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable，基线既有、e2e 范围外，**未修**）                                                                                                                                                                                                                                                                                                          |
| oxlint fast         | `pnpm lint:fast`                                                        | 0     | **0 warning / 0 error**                                                                                                                                                                                                                                                                                                                                                                                                     |
| **采集 + 阈值校验** | `pnpm run test -- --coverage`                                           | **0** | **194 文件（193 passed + 1 skipped）/ 3252 例（3248 passed + 4 skipped）**，与基线逐字一致；Duration **116.23 s**（import 64% / transform 17% / tests 16% / worker 3%）；四指标见 §五，**全部 ≥ 阈值**                                                                                                                                                                                                                      |
| engine-core         | `git diff --stat HEAD -- src/engine-core`                               | 0     | **空**                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 测试目录            | `git diff --name-only HEAD -- test`                                     | 0     | **0 个文件**                                                                                                                                                                                                                                                                                                                                                                                                                |
| 边界                | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0     | **12 passed**                                                                                                                                                                                                                                                                                                                                                                                                               |
| CI yml 自检         | `yaml.parse` + 脚本名比对                                               | 0     | **YAML_PARSE_OK**；jobs = `lint-and-typecheck(9)` / `unit(9, matrix shard=[1,2] count=[2])` / `e2e(8)` / `coverage(10)` / `build(4, needs=[unit,e2e])` / `security-audit(8)`；package.json 脚本引用 `lint` / `migration:run` / `test` / `test:e2e` **4/4 存在**；coverage job 命令 = `pnpm run test -- --coverage`（**未改**）；`build` 的 `needs` 仍为 `[unit, e2e]`（**未改**）；8 处 cache 的 path 里**仍不含 coverage** |

**机器状态（实测，不干净）**：5 个 node 常驻进程 —— `pnpm start:dev`（PID 12992）、`nest start --watch`（PID 14612）、`pnpm dev`（PID 20740）、`admin-dashboard` vite dev（PID 7860）、`node dist/app`（PID 22080）。**未擅自杀用户进程**；墙钟 116.23 s 与 TD-11 的 117.48 s **不作直接比较**（同一台机器同一负载，量级一致仅供参考），盘读延迟经 `pnpm doctor:fs` 判定合格。

**采集产物**：`coverage/lcov.info`（774 320 B）+ `coverage/lcov-report/`（html）；`.gitignore` 第 33 行已含 `coverage`，不入库；本地验证完毕后已清理。

---

## 五、任务特有结果：新一轮 coverage 四指标 vs 阈值

| 指标       | 阈值   | 首轮基线（TD-11 §5.3 · HEAD `1696e59`） | **本轮（HEAD `fed30f4`）** | 命中 / 总量     | 缓冲余量     | 相对基线偏差 |
| ---------- | ------ | --------------------------------------- | -------------------------- | --------------- | ------------ | ------------ |
| Statements | **44** | 46.92%（12 391 / 26 408）               | **46.92%**                 | 12 393 / 26 408 | **+2.92 pp** | 0.00 pp      |
| Branches   | **43** | 45.66%（6 724 / 14 724）                | **45.67%**                 | 6 725 / 14 724  | **+2.67 pp** | +0.01 pp     |
| Functions  | **40** | 42.48%（2 149 / 5 058）                 | **42.48%**                 | 2 149 / 5 058   | **+2.48 pp** | 0.00 pp      |
| Lines      | **44** | 46.68%（11 321 / 24 251）               | **46.69%**                 | 11 323 / 24 251 | **+2.69 pp** | +0.01 pp     |

- **四指标全部 ≥ 阈值，采集命令 exit 0** —— 未触发任务单 §4 的「任一低于阈值即停下回报」条件。
- **相对首轮基线偏差 ≤ 0.01 pp**（阈值红线是 3 pp）—— 未触发停机条件。命中数有 +2 statements / +1 branch / +2 lines 的微小差异，来源为运行时非确定性（与时间 / 环境相关的分支判定），百分比四舍五入后与首轮一致（见 §二 D-3）。
- **用例总数与基线逐字一致**：194 文件（193 passed + 1 skipped）/ 3252 例（3248 passed + 4 skipped）。采集跑即全量 unit，顺带复核通过。
- **反向验证（证明门禁会转红）**：`pnpm run test -- --coverage test/config` → 四指标全部报错并 **exit 1**：
  ```
  ERROR: Coverage for lines (0.04%) does not meet global threshold (44%)
  ERROR: Coverage for functions (0.03%) does not meet global threshold (40%)
  ERROR: Coverage for statements (0.04%) does not meet global threshold (44%)
  ERROR: Coverage for branches (0.57%) does not meet global threshold (43%)
  ```
  由此确认：`perFile: false` 的**全局聚合**判定生效、阈值确实把守出口、CI coverage job 在覆盖率跌破阈值时会**转红**。

---

## 六、风险与回归

1. **既有测试是否被改**：**一个都没改** —— `git diff --name-only HEAD -- test` = **0 个文件**；断言期望、用例数（3252 例 / 194 文件）、mock 语义、隔离语义全部冻结；本单**未新增 spec**。
2. **未碰生产代码**：`git diff --name-only HEAD -- src` = **0 个文件**；`src/` 业务逻辑、DTO、entity、映射函数、module 装配零改动。
3. **未碰 engine-core**：`git diff --stat HEAD -- src/engine-core` 空；`test/engine-core/boundary.spec.ts` 未改；boundary **12 绿**。
4. **未碰 schema / migration / 内容与状态字段**：角色 `enabled` / `audit_status` / `version` / 内容字段零改动。
5. **阈值唯一真相源**：四个数字只出现在 `vitest.config.mts`（含注释里的基线数值）；CI yml、脚本、索引文档**均未复写阈值数字**（本单没动 CI yml 任何一行）。
6. **未改 include / exclude**：仍是 `include: ['src/**/*.ts']` / `exclude: ['src/entity/**']`，基线口径不变（各域 100 个业务 entity 仍计入统计 → Functions 维度天然偏低，属另案 D）。
7. **未启用 perFile / perFileThresholds / 分层阈值**：`perFile: false` 显式写否，只做全局聚合判定。
8. **未改 CI 拓扑**：`build` 的 `needs` 仍是 `[unit, e2e]` —— 观察期 coverage job 失败**不阻断 build**（符合任务单要求）。
9. **未新增依赖、未改** `package.json`（scripts 与依赖）/ tsconfig / Dockerfile / Dockerfile.prod / `.nvmrc` / CI `node-version` / `engines.node`。
10. **日常闸门零开销**：`package.json` 的 `test` 脚本不带 `--coverage`，阈值只在显式采集（CI coverage job / 本机 `pnpm run test -- --coverage`）时校验。
11. **不为达标补测试**：本单只立门禁，未动任何测试来抬高覆盖率。
12. **覆盖率不绑练习评分 / 临床正确性**：沿用 TD-11 §5.3 口径，阈值只反映「代码被执行到的比例」，不作为业务正确性判据。
13. **CI 侧结果待主控 push 后在 Actions 复核** —— 本机跑不了 GitHub Actions，交付记录**不写「CI 已通过」**。

---

## 七、遗留项与另案登记

### 7.1 任务单 §2 指定的另案 A–F（原样登记，均未在本单做）

| 编号 | 另案                                                     | 现状与前置                                                                                                   |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A    | 分层阈值（core / adapters / shared / 业务域）            | 待补分目录 lcov 明细后立项；本地无分目录覆盖率数据，阈值无依据                                               |
| B    | 逐文件阈值 `perFile` + `perFileThresholds`               | 待逐文件基线沉淀后立项；既有低覆盖文件会逐文件卡红                                                           |
| C    | coverage job 纳入 `build` 的 `needs`（阈值失败阻断构建） | 观察期跑稳后评估；本单保持 `needs: [unit, e2e]` 不变                                                         |
| D    | entity exclude 口径调整（各域 `entities/` 是否排除）     | 若调整，**基线与阈值须基于重跑报告重新拍板**；当前 100 个业务 entity 仍计入统计，是 Functions 维度偏低的主因 |
| E    | 低覆盖模块补测专项                                       | 本单不为达标补测试；补测范围待另案界定                                                                       |
| F    | 阈值定期复核与上调节奏机制                               | 当前纪律 = 配置注释里的「只随实测提升上调、不向下放宽」；定期复核节奏待定                                    |

### 7.2 Actions 侧待复核点

1. **coverage job 是否按阈值转红**：CI 上 `coverage` job 跑 `pnpm run test -- --coverage`（命令**未改**），阈值判定由 vitest 直接生效 —— 需在 Actions 复核 ①正常覆盖率下 job 绿、②人为拉低覆盖或临时上调阈值后 job 转红（阈值失败是否正确让 job 失败而非只打警告）。
2. **artifact 是否上传**：`coverage/` → artifact `coverage-lcov`（保留 7 天）是否照常上传；本机已验证 `coverage/lcov.info` + `coverage/lcov-report/` 正常产出。
3. **观察期语义**：coverage job 失败**不阻断 build**（`build` 的 `needs` 未含 coverage），需确认这正是你想要的观察期行为。

### 7.3 沿用既有登记（不属本单范围，未动）

- **L-1 coverage 阈值门禁**（TD-11 遗留）：**本单已关闭** —— 门禁落地，见 §五。
- **L-1b 仓储端口抽象 + entity 依赖消除 + spec typeorm 替身**（TD-11 遗留）：仍另案。
- **L-9 Actions 侧复核**（TD-11 遗留，matrix shard / audit 容错 / `build` needs）：仍待主控 push 后复核。
- **README 2 处既有断链**（TD-11 L-10）：仍另案。

---

_本单无新增第三方依赖；无 schema / migration 变更；仅一个配置文件变更；未自动 commit / push。_
