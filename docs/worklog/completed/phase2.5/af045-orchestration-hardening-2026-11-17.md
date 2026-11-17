# AF-045 / AF-046 交付记录：编排收口三项（CI 门禁实弹 / 框架条款锚点 / 熔断派发拦截）

- 批次：AF-045（实现）+ AF-046（CI 门禁实弹演练，独立任务单）
- 日期：2026-11-17
- 上下文：`phase2.5-orchestration-closed-loop`
- 基线：`830da1a`（AF-044 收口）；合并落点 `1f40d3b`

## 1. 本批做了什么

| 项           | 问题                                                                  | 处置                                                                  | 证据                                      |
| ------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| CI 门禁实弹  | `--require-ci` 只有假 REST 响应的单测，没有一次真实远端结论决定过合并 | 造真分支、真提交、真 CI：阻断路径 + 放行路径各跑一次                  | §5 表；`ci-gate-fire-drill-2026-11-17.md` |
| 框架条款漂移 | schema 哈希只锁机读契约，`docs/` 正文被改写时 CI 仍全绿、两套口径并存 | 条款锚点清单 + `check_normative_docs` + 反例单测                      | 框架 `1b1e581`；`run.py` 507 项 / 0 失败  |
| 熔断派发拦截 | 开闸只是可观察事件，`claimReadyTasks` 仍把新单送进坏通道              | `resolveChannelCircuit` + 领单前硬拦截，open 停派、half-open 只放一次 | 单测三例；`scheduler.mjs`                 |

## 2. 熔断派发侧实现（AF-044-O1 转正）

- `resolveChannelCircuit(runtimeState, config, {now})`：熔断是**通道级**语义，状态只落在触发它的任务条目上，故扫描 `runtimeState.tasks` 取 `openedAt` 最新的 `open` / `half-open` 条目，用 `evaluateCircuitBreaker` 按**当前时刻**重算冷却（冷期内 `open`、期满 `half-open`）；无事实返回 `closed`（带默认阈值 / 冷却，不误拦）。
- `claimReadyTasks`：在 `queue-busy` 早退之后算一次 `circuit`；循环内补 `claimed >= maxConcurrent` 早退；在依赖 / `heldForHuman` 判定之后、scope 冲突之前拦截——`open` 或（`half-open` 且 `probeIssued`）时 push `channel-circuit-blocked`（带 state / channel / consecutiveFailures / threshold / openedAt / cooldownMinutes）并 `continue`：任务留 `ready`，**不登记租约、不生成投递件**。
- `half-open` 放行首个任务时置 `probeIssued=true`，写 `entry.circuitProbe={channel, at, openedAt}` 并 push `channel-circuit-probe`。

## 3. 框架条款锚点（跨仓）

`conformance/normative-anchors.json` 登记三组锚点（§4.1 非失败事实 / §5.1 half-open 冷却期 / receipt §3.1 `commits` 提交事实），`check_normative_docs` 逐条断言短语存在，缺失即 `V7` 失败并提示「条款已改写请同步更新清单」。清单缺失 / 坏 JSON / `anchors` 为空同样判失败——删清单不能绕过。反例单测三条（缺锚点必失败、空清单必失败、真实仓必须零失败）。

## 4. 闸门（本机 DESKTOP-E3EVQ9P / node v22.23.2 / pnpm 9.15.0，无长驻 watch 进程）

| 命令                                                                          | 退出码 | 关键数字                                                                           | 墙钟     |
| ----------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- | -------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 193 passed / 0 failed（基线 189，+3 熔断拦截 +1 提交标题）                         | 1.20s    |
| `pnpm test`                                                                   | 0      | 3566 passed / 8 skipped；201 passed + 1 skipped spec                               | 25.9s    |
| `pnpm lint`                                                                   | 0      | 0 error / 0 warning（`eslint --cache`，覆盖率同基线：仅 `{src,test,bin}/**/*.ts`） | 缓存命中 |
| `pnpm typecheck`                                                              | 0      | 0 error（`tsc -b tsconfig.check.json`）                                            | 增量     |
| `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                        | 0      | 全 PASS（含 AF-045 / AF-046 运行态任务单与事件日志投影一致）                       | 秒级     |
| `pnpm orchestration:contracts`                                                | 0      | 框架契约包 2.0.0（v2.0.0 / c507188）14 文件哈希一致                                | 秒级     |
| `node scripts/orchestration/cli.mjs events verify`                            | 0      | 184 条事件；哈希链与索引投影一致                                                   | 秒级     |
| 框架 `python conformance/run.py`                                              | 0      | 507 检查项 / 0 失败（含新增「规范正文条款锚点一致」8 项）                          | 秒级     |
| 框架 `python -m unittest discover -s conformance/tests -v`                    | 0      | 16 tests OK（基线 13，+3）                                                         | 1.16s    |

## 5. CI 门禁实弹（AF-046）

| 路径  | 调用                                                                                   | 结果                                                                                               |
| ----- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 阻断  | `branch merge --taskId AF-046 --require-ci --sha 2a820c5`（分支已推送、**未**触发 CI） | 退出码 2，`远端 CI 未通过（unknown）`，0 项 check；分支未改写                                      |
| 补 CI | `POST /actions/workflows/ci.yml/dispatches` on `ref=task/AF-046-af-046`                | 204；check runs 落到 `2a820c5`                                                                     |
| 放行  | 同命令 + `--apply`                                                                     | `远端 CI 通过：12 项 check 全非失败态`；`squash-merge → commit → delete-local`；合并提交 `1f40d3b` |

**实弹暴露的真实缺陷**：`finalizeSquashMerge` 原来组装 `` `${taskId} ${title}` `` 作为提交标题，被仓内 commit-msg 钩子（conventional commit 正则）拒绝，合并停在 commit 阶段。假端口单测永远覆盖不到钩子，只有真仓真提交才暴露。修法：`buildSquashCommitMessage` 按任务类型映射前缀（implementation→feat / fix→fix / documentation→docs / 其余只读类→chore，scope 固定 `orchestration`），并补一条「标题必须匹配钩子正则」的单测。

## 6. 六个字段标记

| 标记             | 取值                                                        | 依据                                                                                                                        |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `gateResults`    | 9 条命令，8 条 exit 0（另含框架两条）                       | §4                                                                                                                          |
| `scopeCheck`     | `in-scope`                                                  | 改动落在 `scripts/orchestration/`、`docs/team/agent-orchestration/`、`docs/worklog/`、框架 `conformance/` + `docs/tools.md` |
| `contractChecks` | taskId / state-write / index-schema / event-chain 四项 pass | 状态迁移全部经 CLI，未手改索引                                                                                              |
| `backlogItems`   | 无新增遗留（AF-044-O1 已转正关闭）                          | 台账 IM-040～IM-042 全部 done                                                                                               |
| `deviationTable` | 见 §7                                                       | —                                                                                                                           |
| `reviewVerdict`  | `passed`                                                    | §8                                                                                                                          |

## 7. 偏差表

| 项           | 任务单说的                      | 实际                                                                                                 | 处置                                                                  | 原因                                                             |
| ------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 任务粒度     | 三项一起做                      | CI 实弹会改写 `integrate` 并需要独立分支，与实现改动写面不同                                         | 拆 AF-045（实现）+ AF-046（演练），各自任务单与回执                   | 合并动作不能混进实现单 scope，否则 scopeCheck 无法自证           |
| 基线登记     | AF-046 应登记 `baselineRef`     | `verifyBaseline` 判据是 `baselineRef == 当前 HEAD`，而任务单落库本身就会推进 HEAD                    | AF-046 不登记 baselineRef，口令显式打印「任务记录未登记 baselineRef」 | 不伪造一个刚好对上的 SHA；演练对象是 CI 门禁，基线面保持显式跳过 |
| 合并提交标题 | 原实现 `` `<taskId> <title>` `` | 被 commit-msg 钩子拒绝                                                                               | 改 `buildSquashCommitMessage` + 单测                                  | 实测缺陷，不是风格偏好                                           |
| 用户自有稿   | —                               | `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 未跟踪且阻断 `worktreeClean()` | 合并期间临时写 `.git/info/exclude`，合并后立即移除，文件未动、未入库  | 不移动 / 不改写用户自有文件                                      |

## 8. 验收结论

- `--require-ci` 从「装饰」变成「决定」：同一条分支上先判 `unknown` 被拦、补 CI 后判 `pass` 放行，合并提交 `1f40d3b` 真实落入 `integrate`；顺带修掉一个只有真仓才会暴露的提交标题缺陷。
- 框架 `docs/` 条款漂移从「靠人记得同步」变成「改了就失败」：锚点清单进 diff，删清单不能绕过（空清单判失败）。
- 熔断开闸从「可观察事件」变成「派发硬拦截」：open 整轮停派、half-open 只放一次试探，任务留 `ready` 不丢。
- 三仓闸门全绿，单测净增 4 例（189→193），框架单测 13→16、检查项含新增 8 项。

未做实项：无。下一批可做方向（未登记台账、待用户拍板）：`branch merge` 的 `--require-ci` 目前按调用方传的 `--sha` 判定，可考虑在 `--apply` 时强制校验「`--sha` 必须是该分支 HEAD 且工作树干净」以防「拿旧绿的 SHA 合并新提交」。
