# TD-12 交付回复 · coverage 阈值门禁（全局聚合 · 观察期不阻断 build）

> 本文件是本轮完整回复原文，完成时间 **2026-11-14 01:55**（24h 制）。
> 任务单：`docs/worklog/completed/phase2.5/td12-coverage-threshold-gate-task-2026-11-14.md`
> 交付记录：`docs/worklog/completed/phase2.5/td12-coverage-threshold-gate-implementation-2026-11-14.md`

## 结论

TD-12 已交付。在 `vitest.config.mts` 的 `coverage` 段新增 `thresholds`，立**全局聚合**四指标门禁（statements 44 / branches 43 / functions 40 / lines 44，`perFile: false`）：覆盖率低于阈值时采集命令 **exit 非 0**、CI coverage job **转红**。

**除该配置文件外零代码改动** —— `src/` 0 文件、`test/` 0 文件、engine-core 0 行；未新增依赖，未动 package.json / tsconfig / Dockerfile / CI 拓扑。阈值唯一真相源就是 `vitest.config.mts`，别处未另抄数字。

---

## 一、四指标 vs 阈值（复跑实测，HEAD `fed30f4`）

| 指标       | 阈值   | 首轮基线（TD-11 §5.3 · HEAD `1696e59`） | **本轮实测** | 命中 / 总量     | 缓冲余量     | 相对基线偏差 |
| ---------- | ------ | --------------------------------------- | ------------ | --------------- | ------------ | ------------ |
| Statements | **44** | 46.92%（12 391 / 26 408）               | **46.92%**   | 12 393 / 26 408 | **+2.92 pp** | 0.00 pp      |
| Branches   | **43** | 45.66%（6 724 / 14 724）                | **45.67%**   | 6 725 / 14 724  | **+2.67 pp** | +0.01 pp     |
| Functions  | **40** | 42.48%（2 149 / 5 058）                 | **42.48%**   | 2 149 / 5 058   | **+2.48 pp** | 0.00 pp      |
| Lines      | **44** | 46.68%（11 321 / 24 251）               | **46.69%**   | 11 323 / 24 251 | **+2.69 pp** | +0.01 pp     |

- **四指标全部 ≥ 阈值，采集命令 exit 0** —— 未触发任务单 §4「任一指标低于阈值即停下回报」条件。
- **相对首轮基线偏差 ≤ 0.01 pp**（红线 3 pp）—— 未触发停机条件。**阈值按任务单建议默认逐字落地，未做任何调整**，也没自行降阈凑绿。
- 命中数有 +2 statements / +1 branch / +2 lines 的微小差异，来源为运行时非确定性（与时间 / 环境相关的分支判定），百分比四舍五入后与首轮一致，如实登记不做掩盖（交付记录 §二 D-3）。
- 用例总数与基线逐字一致：**194 文件（193 passed + 1 skipped）/ 3252 例（3248 passed + 4 skipped）**，Duration **116.23 s**。

## 二、反向验证（证明门禁真的会转红）

光「配置被接受」不算数，额外跑了一次小样本采集：

`pnpm run test -- --coverage test/config` → **exit 1**，四指标全部报错：

```
ERROR: Coverage for lines (0.04%) does not meet global threshold (44%)
ERROR: Coverage for functions (0.03%) does not meet global threshold (40%)
ERROR: Coverage for statements (0.04%) does not meet global threshold (44%)
ERROR: Coverage for branches (0.57%) does not meet global threshold (43%)
```

据此确认：`perFile: false` 的**全局聚合**判定生效、阈值确实把守出口、CI coverage job 在覆盖率跌破阈值时会**转红**。纯观测动作，未改任何代码，产生的 `coverage/` 产物已清理。

## 三、闸门真数字（全部本机实跑，无「待用户执行」留白）

| 闸门                | 命令                                                                    | exit  | 真实数字                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置            | `pnpm doctor:fs`                                                        | 0     | 合格（per-file 均值 **0.26 ms/文件**、slow=1（5.3 ms）、walk 39 ms）                                                                                                                                                                                        |
| 根类型              | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0     | **0 error**                                                                                                                                                                                                                                                 |
| 构建类型            | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0     | **0 error**                                                                                                                                                                                                                                                 |
| Lint（权威）        | `pnpm lint`                                                             | 0     | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable，基线既有、e2e 范围外，**未修**）                                                                                                                                          |
| oxlint fast         | `pnpm lint:fast`                                                        | 0     | **0 warning / 0 error**                                                                                                                                                                                                                                     |
| **采集 + 阈值校验** | `pnpm run test -- --coverage`                                           | **0** | **194 文件 / 3252 例**，四指标见 §一，**全部 ≥ 阈值**                                                                                                                                                                                                       |
| engine-core         | `git diff --stat HEAD -- src/engine-core`                               | 0     | **空（0 行）**                                                                                                                                                                                                                                              |
| 测试目录            | `git diff --name-only HEAD -- test`                                     | 0     | **0 个文件**                                                                                                                                                                                                                                                |
| 边界                | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 0     | **12 passed**                                                                                                                                                                                                                                               |
| CI yml 自检         | `yaml.parse` + 脚本名比对                                               | 0     | **YAML_PARSE_OK**；6 个 job；package.json 脚本引用 `lint` / `migration:run` / `test` / `test:e2e` **4/4 存在**；coverage job 命令 `pnpm run test -- --coverage` **未改**；`build` 的 `needs` 仍为 `[unit, e2e]` **未改**；8 处 cache path 仍不含 `coverage` |

**机器状态（实测，不干净）**：5 个 node 常驻进程 —— `pnpm start:dev`（PID 12992）、`nest start --watch`（PID 14612）、`pnpm dev`（PID 20740）、admin-dashboard vite dev（PID 7860）、`node dist/app`（PID 22080）。**未擅自杀你的长驻进程**；墙钟 116.23 s 与 TD-11 的 117.48 s **不作直接比较**（同机同负载，量级一致仅供参考），盘读延迟已用 `pnpm doctor:fs` 单独体检合格。

## 四、§7 回写 9/9（逐项已勾选）

1. ✅ 交付记录已写到 §6 固定路径
2. ✅ 任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
3. ✅ 回写 WP 登记表 `phase2.5-wp-list-2026-11-08.md` §四 TD-12 行
4. ✅ 回写阶段入口 `phase2.5-README.md` §3.0 TD-12 bullet
5. ✅ 回写台账 `gate-performance-remediation-2026-11-11.md` §9 P-DEBT-12 行 + 末尾「更新记录」
6. ✅ 回写 backlog `phase2.5-toolchain-tech-debt-2026-11-11.md` D-b 行 + 另案 A–F 登记
7. ✅ `git diff --stat HEAD -- src/engine-core` 为空
8. ✅ 提交分组核对：本单文件与并行进程产物分开（未代提交）
9. ✅ 给一行 commit message 草稿（不自己 commit / push）

**工作区最终 7 项改动** = `vitest.config.mts`（改）+ 4 份索引文档（改）+ 2 个新文件（交付记录 + 归档后的任务单）。`src` / `test` / engine-core 零改动。归档后做过一轮**全量相对链接核验**（204+ 条），并修掉归档引起的那 1 条断链（toolchain backlog 指向 TD-12 任务单的旧相对路径），复跑 **ALL_LINKS_OK**。

## 五、另案登记（任务单 §2 指定 A–F，均未在本单做）

| 编号 | 另案                                                     | 前置 / 现状                                                                                        |
| ---- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A    | 分层阈值（core / adapters / shared / 业务域）            | 待补分目录 lcov 明细后立项，本地无分目录覆盖率数据                                                 |
| B    | 逐文件阈值 `perFile` + `perFileThresholds`               | 待逐文件基线沉淀；既有低覆盖文件会逐文件卡红                                                       |
| C    | coverage job 纳入 `build` 的 `needs`（阈值失败阻断构建） | 观察期跑稳后评估，本单保持 `needs: [unit, e2e]`                                                    |
| D    | 各域 `entities/` 是否排除（exclude 口径）                | 若调整，**基线与阈值须基于重跑报告重拍**；当前 100 个业务 entity 仍计入统计，是 Functions 偏低主因 |
| E    | 低覆盖模块补测专项                                       | 本单不为达标补测试                                                                                 |
| F    | 阈值定期复核与上调节奏机制                               | 当前纪律 = 配置注释里「只随实测提升上调、不向下放宽」                                              |

## 六、Actions 侧待复核（本机跑不了 GitHub Actions，交付记录**未写「CI 已通过」**）

1. **coverage job 是否按阈值转红**：正常覆盖率下 job 应绿；人为拉低覆盖或临时上调阈值后应转红（验证是 job 失败而不是只打警告）。
2. **artifact 是否上传**：`coverage/` → artifact `coverage-lcov`（保留 7 天）照常上传；本机已验证 `coverage/lcov.info`（774 320 B）+ `coverage/lcov-report/` 正常产出。
3. **观察期语义**：coverage job 失败**不阻断 build**（`build` 的 `needs` 未含 coverage），需确认这正是你要的观察期行为。

## 七、偏差登记（5 条，已入交付记录 §二）

| 编号 | 偏差                                                | 说明                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | 阈值逐字按建议落地未调整                            | 复跑四指标均达标且偏差 ≤0.01pp（≪3pp 红线），不触发停下回报条件                                                                                                                                                                                                                                                                                                                                         |
| D-2  | 额外做了一次小样本反向验证                          | 证明门禁真会转红，非仅配置被接受；纯观测，产物已清理                                                                                                                                                                                                                                                                                                                                                    |
| D-3  | 命中数与首轮有 +2 stmts / +1 branch / +2 lines 微差 | 运行时非确定性，百分比 ≤0.01pp，如实登记不掩盖                                                                                                                                                                                                                                                                                                                                                          |
| D-4  | 根 tsc / build tsc **不覆盖** `vitest.config.mts`   | 既有工程事实：`tsconfig.json` 的 include 只有 `typings/global.d.ts` + `src/**` + `test/**` + `bin/**`，不含根级 config。类型正确性改由 ①vitest 5.0.5 `Thresholds` 接口定义逐字段核对（`node_modules/vitest/dist/chunks/plugin.d.C8mmycim.d.ts:1984`，字段 = statements / functions / branches / lines / perFile / autoUpdate / 100）②vitest 运行时正常加载 config 两条保证。**未改 tsconfig**（超范围） |
| D-5  | 机器不干净                                          | 5 个常驻进程是你自己的开发进程，未擅自杀；墙钟只记录不比较                                                                                                                                                                                                                                                                                                                                              |

## 八、commit message 草稿（未 commit / 未 push，等你指令）

```
ci(td12): coverage 阈值门禁落地 —— vitest.config.mts 立全局聚合四指标下限 (stmts 44 / branch 43 / funcs 40 / lines 44)
```

> 待你确认后手动提交 / push。提交时注意 stage 只含本单 7 项（1 个配置文件 + 4 份索引文档 + 2 个新文件），别把并行进程产物一起带上。
