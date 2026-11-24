# AF-456 · AF-446~AF-455 候选改进统一入库台账（交付记录）

- 任务：AF-456（documentation / orchestrator）
- 上下文：phase2.5-orchestration-closed-loop
- 基线：`d3e85a47865a6d2f8cdbee95497fd91b3b6e4fcc`（AF-455 stacked 分支 HEAD）
- 前序：AF-455（归档补齐件）→ AF-454（内核注释）→ AF-446~AF-452
- 日期：2026-11-24

## 一、做法

台账只经 `node scripts/orchestration/cli.mjs improvements --add` 写入，未手改 `improvement-log.json`。新增 11 条候选 `IM-074 ~ IM-084`，全部落在封闭枚举内（`source ∈ {implementation, review}`、`type ∈ {gap, guardrail, tool, standard, performance, tech-debt}`、`layer ∈ {adapter, framework}`），状态均为 `candidate`。

台账计数：候选 18 → 29，总条数 73 → 84（`improvements --summary` 实测）。

## 二、入库明细

| ID     | 来源任务 | 标题                                                                | source/type/layer                      |
| ------ | -------- | ------------------------------------------------------------------- | -------------------------------------- |
| IM-074 | AF-449   | 两类模型轨（holding_present / cold_absent）跨轮事件仍零语料         | implementation / gap / adapter         |
| IM-075 | AF-449   | 任务单模板把 baselineRef 标「可空」与 promote 强校验冲突            | implementation / tool / framework      |
| IM-076 | AF-455   | 重签发不继承原任务 artifactPath，取消任务的交付记录仍被强制要求存在 | implementation / tool / framework      |
| IM-077 | AF-454   | register 阶段不校验 agentRole 与 scope 资源域匹配                   | implementation / guardrail / framework |
| IM-078 | AF-451   | 13 场真实语料全早于 AF-442，无 kernelRef 可回填                     | implementation / gap / adapter         |
| IM-079 | AF-451   | scripts/ops/quality/*.ts 不在 lint 覆盖面                           | review / guardrail / framework         |
| IM-080 | AF-452   | dependsOn 指向 failed/canceled 任务时整条链永久阻塞                 | implementation / gap / framework       |
| IM-081 | AF-452   | 候选改进长期只活在回执 backlogItems，未进台账                       | implementation / tech-debt / framework |
| IM-082 | AF-455   | 本地执行场景与 GUI 派发租约语义冲突                                 | implementation / tool / framework      |
| IM-083 | AF-454   | 本机 node 版本低于仓库要求（v22 对 ≥26）                            | review / standard / adapter            |
| IM-084 | AF-455   | cli validate 单 sheet 校验的退出码被无关失败拖累                    | review / tool / framework              |

每条都带 `relatedTaskId`、`evidence`（指向已提交的 `docs/worklog/completed/phase2.5/*.md` 交付记录，而非 gitignored 的 transport 回执）、`impact`、`suggestion`。

## 三、取舍（未入库的候选与理由）

| 原候选                         | 处置          | 理由                                                                                                   |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------ |
| AF446-B1 / B2                  | 不入库        | 已由 AF-454 实际修复（`4d68dc05`，两处内核注释与 DELTA_TABLE 对齐），再登记只会变成无效候选            |
| AF449-B2                       | 不入库        | 已由 AF-450 完成（台账按 kernelRef/synthetic 分桶）                                                    |
| AF450-B1                       | 不入库        | 已由 AF-451 完成（生成器写入 kernelRef）                                                               |
| AF450-B2 / AF451-B2            | 合并为 IM-078 | 同一事实（13 场历史语料无 kernelRef），拆两条会让同一问题在治理时被数两次                              |
| AF450-B3 / AF451-B3            | 不入库        | 实测 warning 已消失（`pnpm lint` 0 error / 0 warning，AF-395 重排 imports 后不再触发 `import/order`）  |
| AF452-B2                       | 合并为 IM-081 | 它就是「候选不入台账」这条事实本身，本次任务完成后应视为已处理，但结构性风险（收口不自动入库）仍需登记 |
| AF454-B1                       | 合并为 IM-077 | 与 AF454-B1 同一事实（登记阶段不校验域冲突）                                                           |
| AF454-B2 / AF449-B3 / AF455-B1 | 合并为 IM-076 | 三个编号描述同一条链式缺陷                                                                             |

合并后的 evidence 挂在本任务与相关交付记录上，逐条可回溯，未凭空造证据。

## 四、闸门

| 闸门       | 命令                                                        | 结果                                                                    |
| ---------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| 台账可解析 | `node scripts/orchestration/cli.mjs improvements --summary` | exit 0，候选 29 / 排队 1 / 已完成 51 / 不采纳 3，总 84                  |
| 代码零改动 | `git diff --stat HEAD -- src/`                              | 空输出                                                                  |
| 任务单预检 | `cli.mjs validate --sheet ...`                              | 任务单元 PASS（整体 exit 1 仅因既有无关失败 `[FAIL] 回执 AF-384.json`） |

## 五、与任务单的偏差

无。范围只有 `improvement-log.json` 一处写入，未触碰既有 73 条的状态，也未改任何代码。

## 六、遗留

- 台账里 29 条候选仍全部停在 `candidate`，`candidate → queued` 的排序与取舍需要一次专门的治理任务（本任务不替治理做决定）。
- 条目 `relatedTaskId` 只指向单一来源任务；对合并项而言，「合并来源」写在 evidence 里，台账结构不支持多任务号，属已知限制，若治理需要可按 IM-075/IM-076 的形态再扩字段。
