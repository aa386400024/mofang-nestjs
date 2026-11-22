# AF-154 · AF-152 验收最终收口交付记录

- **taskId**：AF-154
- **日期**：2026-11-20
- **分支**：`task/AF-152-quality-admin`
- **基线**：`e4ffb6dd0f3681c07248fa72d6c4cacbcb263338`
- **性质**：纯验收材料收口，无代码/数据变更。质量结论沿用 AF-152：`ai_proxy_candidate / humanSupervision=false / clinicalAcceptanceEligible=false`。

## 1. 结论

AF-152 的实现、复算数据与文档已全部落在基线 `e4ffb6d`，本单只补最终验收记录，解决机读门契约问题。**实现类验收项通过；AI 质量门仍未达标。**

- admin 调试引擎前端：真实可用，所有可操作入口走真实后端接口；参数校准页有真实生效参数只读快照。
- AI 评分：AF-146 六项硬门 **4/6**；safety 封顶后 3 个 packet <3、overall κ 0.365854 <0.40。
- 不得写成“AI 层面质量达标”，不得写成临床达标。

## 2. 机读门问题与处置

| 问题 | 证据 | 处置 |
| --- | --- | --- |
| AF-152 任务快照 scope 只有 8 个路径，实际提交含测试/data/回执/README/锁文件 | AF-152 rejected，reason=`归档前闭合终态` | 不复活 AF-152；AF-154 以基线 `e4ffb6d` 收口，只写 docs |
| AF-152 conditional-pass 带 `manualReviewList` | 机读规则要求 conditional-pass 无人工复核阻塞项 | AF-154 回执只保留 backlog，不设人工复核阻塞项 |
| AF-153 扩大 scope 触发 executor 资源域冲突 | `scope-domain-conflict AF-153` | AF-153 canceled/archived，重签发 AF-154 |
| AF-152 实现提交不能进 AF-154 `changedFiles.commits` | 否则越出 docs-only scope | 实现提交列为 `artifactRefs.others` / priorTasks，不声明为本单变更 |

## 3. 质量结论（沿用 AF-152，不重算）

| 指标 | 值 | 判定 |
| --- | --- | --- |
| AF-146 overall exact | 0.6250 | 过 |
| AF-146 within±1 | 1.0000 | 过 |
| AF-146 overall 平均 | 4.3125 | ≥4.00 过 |
| AF-146 style 平均 | 3.6875 | ≥3.50 过 |
| AF-146 safety 平均 / 最低 | 3.5000 / **2** | 最低 <3，**失败** |
| AF-146 safety packet <3 | **3** | **失败** |
| AF-146 overall κ | 0.351351 | <0.40，**失败** |
| 96 场 overall κ | 0.365854 | <0.40，**失败** |
| 96 场 AC1 / α_ordinal | 0.857002 / 0.378367 | 诊断 |
| 96 场 trust κ / verbal κ | 0.194508 / 0.078891 | 主要拖累项 |

- safety 封顶前 4.6875 / 最低 4 / 0 个 <3；封顶后 3.5000 / 最低 2 / 3 个 <3。**这是口径显式化暴露隐性不一致，但作为硬门必须判失败。**
- safety 封顶后 κ 0.892183 是机械升高；封顶前 0.659675 才反映评分员一致性。报告必须成对展示。
- 96 场只有 8 个 characterSlug，未满足 ≥24 独立角色簇的稳健性前提。

## gateResults

| 命令 | exitCode | errors | warnings | 实测 |
| --- | --- | --- | --- | --- |
| `pnpm typecheck` | 0 | 0 | 0 | `tsc -b tsconfig.check.json`，01:56 通过 |
| `pnpm lint` | 0 | 0 | 0 | src/test/bin + scripts，0 error / 0 warning |
| `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts` | 0 | 0 | 0 | 2 files / 41 tests passed（29 + 12） |
| `pnpm --dir admin-dashboard build` | 0 | 0 | 0 | 含 `vue-tsc`；vite build 2.41s |
| `pnpm test` | 0 | 0 | 0 | 221 files passed + 1 skipped；3886 tests passed + 4 skipped；23.58s |
| `pnpm exec vitest run test/admin-debug/wp26-admin-role-guard.spec.ts` | 0 | 0 | 0 | 1 file / 17 tests passed |
| `pnpm exec vitest run test/admin-debug/debug-session-persistence.spec.ts` | 0 | 0 | 0 | 1 file / 26 tests passed；全量并行曾 1 次超时，单跑与复跑通过 |
| `git diff --name-only e4ffb6d -- src/engine-core` | 0 | 0 | 0 | 0 行，零 diff |
| `pnpm orchestration:preflight` | 0 | 0 | 0 | ORCH-GATE PASS |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 0 | 0 | 事件日志通过；schema、哈希链与索引投影一致 |

## scopeCheck

- **in-scope**。本单只新增两个 docs：本任务单、本交付记录。
- 不改任何 `src/`、`bin/`、`test/`、`admin-dashboard/`、`data/` 文件；`src/engine-core` 零 diff。
- AF-152 实现提交（`500d633 / 70f8028 / 526ebb8 / 2cfa96a / e4ffb6d`）在基线内，作为 priorTasks/artifactRefs，不声明为 AF-154 changedFiles。
- 未纳入 AF-128 工作区改动与历史 `data/` 未跟踪产物。

## contractChecks

| item | result | note |
| --- | --- | --- |
| taskId | pass | AF-154 任务单、索引、回执、记录一致；priorTasks 指向 AF-153/AF-152 |
| stateWrite | pass | reissue / promote / run-once 均经 CLI；状态面未手改 |
| indexSchema | pass | task-state-index 由 CLI 写入 |
| eventChain | pass | events verify 通过 |
| taskSheetEncoding | pass | UTF-8 无 BOM、LF；六组机读标记逐字出现 |
| thresholdFreeze | pass | 0.40 / 3.50 / safety≥3 未下调 |
| engineCoreBoundary | pass | `src/engine-core` 零 diff |
| receiptShape | pass | changedFiles 仅含 docs 提交；conditional-pass 无人工复核阻塞项 |

## backlogItems

| 编号 | 遗留 | 处置 |
| --- | --- | --- |
| OI-AF154-01 | AF-146 safety 硬门封顶后失败（3 个 packet <3） | 另单做内容级开场/危机计划校验 + 新批次复评；不下调 safety≥3 |
| OI-AF154-02 | 96 场 overall κ 0.365854 <0.40，P 约 38% | 扩 ≥24 独立角色簇 / ≥48 packet 且覆盖 ≥3 profile |
| OI-AF154-03 | trust κ 0.194508、verbal κ 0.078891 | 逐维锚点校准与刻度对齐；0.40 不动 |
| OI-AF154-04 | safety 封顶后 κ 机械升高 | 报告与看板成对展示封顶前/后 κ |
| OI-AF154-05 | 真人督导师双盲 + 仲裁缺位 | 保持 `ai_proxy_candidate` |
| OI-AF154-06 | admin 未在真实后端 + DB 环境人工冒烟 | 部署环境走完整手动链路 |
| OI-AF154-07 | `debug-session-persistence` 全量并行偶发超时 | 登记测试基础设施 flaky；不放宽业务断言 |
| OI-AF154-08 | safety 封顶只做词面规则 | 后续加内容级校验；不把承诺词当安全计划 |

## deviationTable

| 项 | 任务要求 | 实际 | 处置 | 原因 |
| --- | --- | --- | --- | --- |
| 任务编号 | AF-152 直接收口 | AF-152 rejected；AF-153 资源域冲突 | 重签发 AF-154，纯 docs 收口 | 终态不可复活；executor 无 data 写域 |
| 变更范围 | 只补验收记录 | 只新增两份 docs | 声明本任务 docs 提交 | 实现已在基线，不重复声明 |
| 质量结论 | 如实判读 | 4/6，safety 与 κ 失败 | 写失败，不写达标 | 不调阈值、不粉饰 |
| 全量测试 | 收尾一次 | 首轮 1 个并行超时；复跑通过 | 记录 flaky 与复跑 | 不隐瞒首轮失败 |
| Node 版本 | 仓库 >=26 | 当前 v22.23.2，pnpm WARN | 记录 WARN；命令 exit 0 | 环境限制 |

## reviewVerdict

**conditional-pass**：AF-152 实现与证据完整、全部闸门真实通过、`src/engine-core` 零 diff；AF-154 只补最终验收材料并修复机读契约。AI 质量门仍 4/6，safety 封顶后失败、overall κ 0.365854 <0.40，故只归档“实现与取证”，不归档“质量达标”。无人工复核阻塞项，剩余全部登记 OI-AF154-01~08。

## 4. 证据

- AF-152 交付记录：`docs/worklog/completed/phase2.5/af152-quality-admin-2026-11-20.md`。
- AF-153 重签发记录：`docs/worklog/pending/af153-quality-admin-close-task-2026-11-20.md`（canceled，审计链保留）。
- 实现提交：`500d633`、`70f8028`、`526ebb8`、`2cfa96a`、`e4ffb6d`。
- 评分输出：`data/phase25-exit/af152-cal96-out/`、`af152-cal96-precaps/`、`af152-af144-out/`、`af152-af144-precaps/`。
- MiniMax 回执：`docs/worklog/pending/relay-response-AF152-20261120-0149.md`。
