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

未做实项：无。

## 9. 同日第二轮补修（收口自查发现的三处自身口子）

上一节列出的「可做方向」与两处自查口子在用户放行后当天补完。**不新开任务单**：三处都是本批实现的自洽性缺陷（同 scope、同验收口径），补在 AF-045 记录内并保留原回执为历史事实（回执 `AF-046-O1` 保持 `open`，关闭证据在本节，不回写已归档回执）。

| 口子                                                             | 事实                                                                               | 修法                                                                                                                                                                                                 | 证据                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| half-open「只放一次」实际每轮一次                                | `probeIssued` 是 `claimReadyTasks` 内局部 `let`，每轮 `run-once` 重置              | 探针事实改为从运行态推断：`resolveChannelCircuit` 扫全部条目的 `circuitProbe`，`openedAt` 与当前开闸周期相同即 `probeIssued=true`；`claimReadyTasks` 用它初始化；熔断封闭时随周期清空 `circuitProbe` | 单测 +2（跨轮已试探不再放行 / 旧周期探针不冒充），193→195                                                                                               |
| 框架 CHANGELOG 漏记 `1b1e581` 新增校验项                         | 只改了 `conformance/` 与 `docs/tools.md`，未写 CHANGELOG                           | `CHANGELOG.md` `[Unreleased]` 增「校验器增强」小节，补记条款锚点校验与 push 闸门补面                                                                                                                 | 框架 `run.py` 507 项 0 失败                                                                                                                             |
| push 到 main 不走 CHANGELOG 闸门                                 | `contracts.yml` 只在 `pull_request` 带 `--changelog-base`，push 路径跑全量结构闸门 | push 路径改为 `--changelog-base "${{ github.event.before }}"`；`before` 为全零（首推/强推）时回落全量并跳过比对                                                                                      | 反证：对 `1b1e581~1` 跑新闸门 → `V11 改动触及规范面但 CHANGELOG.md 未更新`，退出码 1（即该提交本身就会被拦）；修完 push `26d30bc`，CI 用新闸门判 `pass` |
| `--require-ci --apply` 未校验 `--sha` 等于分支 HEAD（AF-046-O1） | `--sha` 缺省取当前工作 HEAD（在 `integrate` 上），显式传旧绿 SHA 也能放行          | 缺省改取**该任务分支 HEAD**（`gitPort.branchHead`，取不到才回落当前 HEAD）；`--apply` 且显式传 `--sha` 时，与分支 HEAD 不等即抛「拒绝用旧绿的提交给新提交放行」                                      | 调用口径与 README §5.3 同步；单测见上                                                                                                                   |

第二轮闸门（补修后重跑，均在本机、无长驻 watch 进程）：编排单测 195 passed / 0 failed、`pnpm lint` 0 error、`pnpm typecheck` 0 error、全量 `pnpm test` 3566 passed / 8 skipped、`validate` / `contracts` / `events verify`（184 条）全 PASS、框架 `run.py` 507 项 0 失败、`unittest` 16 OK。

已知未覆盖（登记在此、不改代码）：`pnpm lint` 的 ESLint 作用域是 `{src,test,bin}/**/*.ts`，**不含 `scripts/`**——直接对 `scripts/orchestration/*.mjs` 跑 eslint 会报 `was not found by the project service`（配置性错误，非代码缺陷）。脚本层目前只有单测兜底，要不要把 `scripts/` 纳入 lint 属于新决策。

### 9.1 跟踪落点（台账 IM-043～IM-048）

本轮全部疑似留白都进台账，不留在散文里：

| 台账   | 状态                                           | 内容                                                                  |
| ------ | ---------------------------------------------- | --------------------------------------------------------------------- |
| IM-043 | queued                                         | ESLint 作用域不含 `scripts/`，编排脚本只有单测兜底                    |
| IM-044 | queued                                         | `mcp` / `http` transport 仍是预留位，只有 `file` 通道可用             |
| IM-045 | queued                                         | GUI 派发需人工 `channel confirm`，无人值守长跑未验证                  |
| IM-046 | queued                                         | 跨仓提交不能写入回执 `changedFiles.commits`                           |
| IM-047 | queued                                         | 生产收口清单（部署 / secrets / 迁移 / 监控 / 回滚）未排期             |
| IM-048 | done（`--linked-task AF-045`，证据 `88839c6`） | 合并门禁 `--sha` 可传旧绿 SHA 给已前进分支放行（AF-046-O1，本轮修复） |

台账概览：已完成 42 / 排队 5 / 不采纳 1，活跃 5 / 总 48；任务面活跃 0、归档 64。

### 9.2 技能同步（本轮把落后于架构的 7 个技能修到现状）

技能不在仓库里（`workspace\.user_skills\`），但口径错会让下次开工从错误前提出发。核对方式：逐条把技能里的路径/命令/数字与仓库现场比对，引用的路径用 `Test-Path` 验证存在性。

| 技能                         | 落后点                                                                                       | 处置                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-context-restore`  | 根目录写 `E:\Work\Project`（旧机器）；缺框架仓与编排入口；未提状态面复核                     | 根目录改 `D:\work\Project` 并标注「随机器变化、现场核实」；增框架仓行与「框架仓要点」（CHANGELOG 闸门、本地闸门、条款锚点）；Step 2 加编排/框架活文档；Step 3 加 `status`/`events verify`/`improvements --summary` 三项只读复核；补「用户自有未跟踪稿不算脏」与 `$env:` 前缀、eslint 作用域两条坑；push 口径改为「默认不推、授权后推但必须自过闸门」 |
| `delivery-gating-commits`    | 「push 永远由用户决定」与现行授权冲突；无「自动提交也要过钩子」；无「闸门覆盖范围≠代码范围」 | push 改为授权式；新增「工具生成的提交也要过钩子（假端口单测测不到，必须实弹一次）」；新增「lint 覆盖范围要等于代码范围，否则显式声明并登记」；交付标准增机读交付物小节（回执六组标记、计数可复算、`transport/` 被 gitignore、跨仓哈希不进 `commits`）                                                                                                |
| `windows-shell-engineering`  | 缺本次实际踩到的三条坑                                                                       | 命令执行补：PS 无 `VAR=x cmd` 前缀（必须 `$env:VAR='1'; cmd`）、`Select-String` 字面串用 `-SimpleMatch`、`git reset --hard` 连未提交编辑一起丢、`git add <目录>` 会吞用户未跟踪稿（改逐文件 add 或临时 `.git/info/exclude`）                                                                                                                         |
| `ai-handoff-acceptance`      | 验收漏机读层：回执字段、计数复跑、归档方式                                                   | 流程改六项核对，新增「机读交付物核对」小节（六组标记缺一即人工复核、计数以 CLI 复跑为准、`transport/` 看 durable 副本、跨仓哈希进 `artifactRefs.others`、归档必须经 CLI）；结论判据同步                                                                                                                                                              |
| `docs-governance-hygiene`    | 未区分「有状态机仓库不能手工搬状态文件」                                                     | 归档决策与 checklist 增 5.1：状态面只经 CLI 写，手工归档会破坏索引投影与哈希链；核数用 CLI 输出                                                                                                                                                                                                                                                      |
| `minimax-code-relay`         | 回复文件路径写 `E:\Work\Project`（旧机器）                                                   | 两处改 `D:\work\Project`；其余（自行跑闸门、数字入记录、单任务队列）与现状一致，未改                                                                                                                                                                                                                                                                 |
| `cloud-pc-project-migration` | 工作区默认根与现场不符；framework 写成「无依赖纯规范仓」；pnpm 基线错写 12.21.0；HEAD 过期   | 显式标注本机 `D:\work\Project` 并提示换机传 `-WorkspaceRoot`；framework 补 Python + `jsonschema`/`pyyaml` 依赖与受保护分支说明；pnpm 基线改 9.15.0（现场 `pnpm --version` 复核）；HEAD 更新为 `1a64188` / `26d30bc`；验证步骤补 `ORCH_REQUIRE_FRAMEWORK=1` + `contracts` + `events verify`；脚本内旧盘符一并替换                                     |

核对结果：13 个技能 frontmatter 全部可解析（`yaml.safe_load` 断言 `name`+`description` 齐全，0 失败）；新引用路径逐条 `Test-Path` 全为 True。

### 9.3 同日第三轮：补齐三个技能缺口（企业级口径）

上一轮盘点报出的三个真实缺口，本轮全部落盘并校验。技能不在仓库内（`workspace\.skills\` 与 `.user_skills\`），但缺口会让下次开工从错误前提出发。

| 缺口                                                                        | 现状                                                                                                                                   | 处置                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 编排 CLI 无单一入口                                                         | 六步闭环拆在 `workspace-context-restore`（开工）、`ai-handoff-acceptance`（验收）、`docs-governance-hygiene`（归档）三处，换会话易漏步 | 新建 `orchestration-cli-runbook`（4 文件：`SKILL.md` + `references\closed-loop.md` / `gates.md` / `pitfalls.md`）：闭环节奏六步表、7 条铁律、命令速查；references 覆盖任务单 frontmatter、回执六组标记与 `changedFiles.commits` 只写本仓 SHA、熔断 `circuitProbe` 同时期探针判定、分支/squash/归档/台账流转、闸门矩阵与基线、CI 轮询一行式、10 条实测坑 |
| `app_builder_agent` 要求先读 `doubao-app-builder`，但三个根目录都没有该技能 | 「生成可交互网页应用」这条路按前置规则走不通                                                                                           | 新建 `doubao-app-builder`（2 文件）：显式标注**本地兜底、非官方权威**（官方到位即作废）；三种调用形态（生成 / 编辑 / 读取问答）、`arch_type` 判定表（标注为兜底启发式）、Prompt 六段、修改迭代纪律、与 `html` 等技能的边界；`references\tool-contract.md` 给参数语义、调用前后检查、失败分类与重试边界，并声明「以工具 schema 为准」                    |
| `browser-use` 与 `browser-use-automation` 描述几乎相同                      | 同后端两套工具名（`browser_use` vs `computer_use_tool` plane=bu），误选会拿不存在的工具名执行                                          | **不删任何技能文件**：在两个 `SKILL.md` 顶部加「入口选择」段，按会话实际工具名二选一（本机只有 `computer_use_tool` → 走 `browser-use-automation`），并写明本机 `bu` 平面不可用（`CDP session is disconnected` / `resync` 报 `no browser tab is available`），网页任务优先 REST/CLI 或 `cu` 桌面                                                         |

**顺带修掉的失效路径**：`psych-study-notes`（描述行与示例两处）、`psych-corpus-to-worklog\references\corpus-map.md` 指向 `E:\BaiduNetdiskDownload\...`；实测本机只有 C/D/Temp，`Test-Path E:\` 为 False，`D:\BaiduNetdiskDownload` 也不存在。已改为 `<资料目录>` 示意 + 「开工先 `Test-Path`，不存在就向用户要实际路径」。

**校验**：`.skills` 45 个 / `.user_skills` 14 个技能 `SKILL.md` 全部通过 `yaml.safe_load`（断言 `name`+`description` 齐全，0 失败）；新技能内部引用路径逐条 `Test-Path` 全为 True（`closed-loop.md` / `gates.md` / `pitfalls.md` / `tool-contract.md`）。

**命令与枚举均现场取证，不靠记忆**：`cli.mjs` 子命令与参数取自 `node scripts/orchestration/cli.mjs` 的 usage 输出；台账枚举取自 `improvement-log.mjs` 常量（`source ∈ {implementation, acceptance, rework, dead-letter, review}`、`type ∈ {gap, guardrail, tool, standard, performance, tech-debt}`、`layer ∈ {adapter, framework}`、`status ∈ {candidate, queued, accepted, done, wontfix}`）；任务状态全集取自 `cli.mjs status` 的计数行。

**工具层事实（供后续留意）**：在 `.skills` 根下用写文件工具直接创建**新目录**时，文件未落盘却回报成功（目录不存在、文件数为 0）；改为先 `New-Item -ItemType Directory` 建目录再写，落盘正常（复验 2 文件）。改**已存在**文件（`browser-use` / `browser-use-automation` 顶部插入）则正常生效。

**副作用与回滚**：探查命令时误跑 `cli.mjs pack`，生成 `delivery-packs\pack-20261117-134630.json|md` 并刷新 `orchestration-snapshot.json` 与 `web/orchestration/data.js`；已删除两个生成件并 `git checkout` 还原两份派生文件，`git status` 回到只剩用户自有未跟踪稿 `docs\architecture\phase3-judge-layer-ai-review-design-2026-11-15.md`（不入库）。

### 9.4 边界补强（回执可信度 / 单写者 / 运行健康）

按「架构边界评审」列出的三条高风险边界落地，台账 `IM-049`～`IM-051` 已按 `candidate → queued → accepted → done` 流转闭合。

| 边界                                 | 原状态                                                                        | 处置                                                                                                                                                                                                                                                                                                                              | 验证                                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 回执可伪造、不可追责                 | `transport/receipts/<id>.json` 只做 schema 校验，谁写的、有没有被改都没有留痕 | `receipts.mjs` 增 `receiptDigest`（整份回执文件 sha256）与 `receiptPublisher`（`publisher` → `agentRole` → `agentRef` → `unspecified`）；摄入时写入运行态 `receiptDigest` / `receiptPublisher`，并进 `receipt-ingested` 动作日志。**指纹与发布者只进运行态与事件日志，不进索引**——框架索引 1.1.0 无此字段位，硬塞会让索引校验失败 | `receipt-audit.spec.mjs` 2 例：同内容指纹稳定、改动后变化；发布者三级回退                                                                                            |
| 文件 transport 无并发仲裁            | 多进程/多机同时 `run-once` 会重复领单、重复验收、互相覆盖快照                 | 新增 `run-lock.mjs`：`transport/.run-once.lock` 用 `openSync(..., 'wx')` 独占创建；持锁信息含 pid / host / token / actor / acquiredAt；超 `45min` 或内容损坏按陈旧锁自愈并留 `stolen` 事实；释放按 token 比对只删自己的锁。`run-once` 与 `watch` 每轮 tick 都走 `withRunLock`，抢不到只打印持锁方并跳过，不动状态面               | `run-lock.spec.mjs` 4 例：互斥、释放后可重抢、陈旧锁自愈、带 BOM 的新鲜锁不被误判；实弹：手工占锁后 `run-once` 打印 `[lock] 另一轮（manual-test）正在运行，本轮跳过` |
| 可观测性只有「看得见」没有「叫得醒」 | 死信、人工持单、租约过期、回执失败只能翻 json                                 | `cli status` 增「运行健康」段：死信 / 人工持单 / 租约过期释放 / 回执校验失败（附前 5 条原因）/ 回执无指纹（旧数据计数）/ 单写者锁状态。纯只读投影，不参与状态迁移                                                                                                                                                                 | `status` 实测输出：`死信=0 人工持单=0 租约过期释放=0 回执校验失败=0 回执无指纹=18`、`单写者锁：空闲`                                                                 |

**口径修正（上一轮口头结论有偏差，记录为准）**：租约到期**本来就会自动释放**回 `ready`（`scheduler.releaseExpiredLeases`），人工的只是「重新派发」——释放后置 `heldForHuman`，需 `task resume` 才再领。真正的缺口是「释放无人知道」与「重派无上限」，所以本轮补的是可见性与互斥，不是重写租约逻辑。

**闸门**（本机，无长驻进程）：编排单测 195 + 新增 6 例全绿；全量 `pnpm test` 3574 passed / 8 skipped（204 spec，24.08s）；`pnpm lint` 0 error；`pnpm typecheck` 0 error；`ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate` 全 PASS（含索引投影一致）；`pnpm orchestration:contracts` 框架契约包 2.0.0 / 14 文件哈希一致；`events verify` 184 条一致。

**未落地项（如实登记）**：跨机器时钟漂移（租约与熔断仍用本机墙钟）、回执密码学验签（当前只有指纹+发布者留痕，信任模型仍是本机可信）、生产部署方案（设计建议见对话，未实机落地）。

**旁证**：`scripts/` 仍未进 ESLint 作用域（IM-043 queued），本轮新增代码由单测覆盖，未靠 lint 兜底。
