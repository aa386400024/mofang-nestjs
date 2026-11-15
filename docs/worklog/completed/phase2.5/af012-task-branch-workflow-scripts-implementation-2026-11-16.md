---
taskId: AF-012
contextId: phase2.5-orchestration-closed-loop
title: 任务分支流程脚本（建分支 / squash 合并 / 合并清理 / 陈旧分支巡检）
type: implementation
status: completed
baselineRef: 67047ea
dependsOn: []
policyRefs: [framework/state-machine.md, autonomous-team-design.md#branch-strategy]
createdAt: 2026-11-16
---

# AF-012 · 任务分支流程脚本与分支治理 — 交付记录

- **状态**：✅ 已交付（2026-11-16，本机闸门全绿；编排层单测 82 passed）
- **基线 HEAD**：`67047ea`（与 `origin/integrate` 一致）
- **编排**：主控 Doubao（orchestrator 自做）｜**任务性质**：编排层工具链演进，业务源码零改动
- **方案契约**：`docs/team/agent-orchestration/autonomous-team-design.md` §4（分支策略与治理）、§6（分层发布）、§8 P0-4

---

## 一、本单做了什么（一句话）

把精简 Git Flow 固化为编排 CLI：任务分支命名强约束（`task/<taskId>-<slug>`，必含 taskId）、自 integrate 切出、squash 合并、合并即删本地与远端源分支、陈旧分支巡检分类；纯函数收口命名校验 / 冲突分类 / 清理计划 / 基线核对，git 交互经注入端口隔离，默认干跑校验，变更动作需显式 `--apply`，脚本不自动 commit / push，不触碰 master。

## 二、改动文件清单

| 文件                                                                                     | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/branch-workflow.mjs`（新增）                                      | 纯函数：`buildBranchName`（taskId 模式校验 + slug 规范化 + 分支名构造）、`validateBranchName`、`branchAgeDays`、`classifyBranches`（已合并 / 未合并 / 超期三分类，长期分支跳过）、`planCleanup`（只对已合并生成本地 + 远端删除项，未合并与超期只列名保留）、`verifyBaseline`（任务基线 ref 与 integrate HEAD 比对）；`createGitPort` 默认 git 端口（`node:child_process` 内置，零新依赖），变更方法与只读方法分离；导出 `LONG_LIVED_BRANCHES`、`DEFAULT_STALE_DAYS` |
| `scripts/orchestration/cli.mjs`                                                          | 新增 `branch` 子命令与 `cmdBranch`：`list`（巡检分类输出）、`plan`（分支名 + 基线核对 + 清理计划干跑）、`create`、`merge`（基线核对 + 工作区清洁前置 + squash 暂存）、`cleanup`（按清理计划删除）；默认干跑，`--apply` 才调用变更端口；变更动作经 `TOOL-QUEUE-SCHEDULER` 工具契约落审计；帮助行补分支命令用法                                                                                                                                                       |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`                                 | 新增 AF-012 测试段 6 例：分支名构造与 slug 规范化 / 非法 taskId 与空 slug 报错、分支名校验三态、巡检三分类与长期分支跳过、清理计划只删已合并（本地 + 远端）与未合并保留、基线核对一致 / 漂移 / 缺字段三态、分支年龄天数折算与非法日期                                                                                                                                                                                                                               |
| `docs/team/agent-orchestration/improvement-log.json`                                     | 登记候选 IM-012、IM-013（见 §五）                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js` | CLI 双写刷新（台账条目与队列快照同步）                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 2.1 口径对齐（框架与设计备忘真相源）

- **分支分层**（§4.1）：`master` 受保护、`integrate` 集成落点、`task/<taskId>-<slug>` 短期分支；长期分支不进入巡检清理集合。
- **六道治理**（§4.2）：合并即删、陈旧巡检、并发上限（归调度器，本单不涉及并行）、命名强约束、squash 线性历史、远端同步清理；清理计划同时覆盖本地与 `remote:<远端名>` 引用。
- **边界**（§4.3）：任务分支自 integrate 最新 HEAD 切出；合并前核对基线 ref；冲突在任务分支内解决，不产生 merge commit；executor 不建分支、不提交、不推送。
- **可逆纪律**：删除前必须确认已合并（`merge-base --is-merged`）；未合并分支只报告不删除；脚本不跳过提交钩子，不改写已推送历史，回退首选 revert（任务单 §4）。

### 2.2 零改动确认

- `src/engine-core/`、`src/migration/`、`src/**/*.ts` 业务代码、整个 `test/`、`bin/` —— **零 diff**。
- **未新增第三方依赖**；未改动 `package.json` / lockfile；未实现远端 PR 流程与 CI 状态门禁（P2，本机无 gh CLI / token）；master / tag / release / 部署（L4）不在脚本自动路径内。
- 向后兼容：既有子命令与调用签名未改；`branch` 子命令缺省动作为只读 `list`；git 端口可注入替身，单测不起真实仓库。

## 三、关键决策与偏差

1. **纯函数与 git 端口分离**：命名、分类、清理计划、基线核对全部纯函数可单测；git 子进程收口在 `createGitPort`，便于替身测试与后续替换为仓库 API。
2. **默认干跑，显式 `--apply` 变更**：`create` / `merge` / `cleanup` 缺省只打印计划；与任务单 §4「脚本默认干跑校验，实际 push 按分层发布口径执行」一致。
3. **squash 只做暂存，不自动 commit**：`squashMerge` 执行 `git merge --squash`，提交动作归编排者闸门（L1 自动化阶段补，见 IM-012）；脚本不自动 commit / push。
4. **基线核对只在合并前硬拦截**：`plan` 干跑展示基线漂移；`merge --apply` 前 `verifyBaseline` 不一致直接拒绝，且要求工作区无未归属改动。
5. **`development` 退役不在本单执行**：§4.4 独立事项；本单巡检会列出 `development` 为未合并分支，仅报告不删除，退役前仍须 `git diff integrate..development` 复核为空。
6. **偏差**：无。任务单 §2 范围内落地；多代理并行分支并发上限、远端 PR / CI 门禁、L4 发布动作未越界实现。

## 四、闸门证据

| 命令                                                                          | 退出码 | 结果                                                                                             |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`（`tsc -b tsconfig.check.json`）                              | 0      | 0 error                                                                                          |
| `pnpm lint:fast`（`oxlint src test bin`）                                     | 0      | 0 warning / 0 error，1350 文件                                                                   |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 82 passed（基线 76 + AF-012 新增 6）                                                             |
| 编码探测                                                                      | —      | 改动 `.mjs` / `.json` / `.md` 均 `bom=False`、纯 LF（`cr=0`）                                    |
| CLI 只读试跑                                                                  | 0      | `branch list` 巡检分类输出正常；`branch plan --taskId AF-012` 分支名、基线核对、清理计划输出正常 |

- **未重跑全量**：改动不进入 `src/test` 运行时，沿用基线全量口径；编排层定向单测已覆盖新模块全部纯函数路径。

## 五、遗留与未决

- **IM-012（candidate · adapter · tech-debt）**：squash 合并后的提交动作未自动化；脚本停在 squash 暂存，提交标题（conventional + taskId）与合并后远端分支清理需编排者手工闭合。L1 自动化阶段在闸门全绿后补提交动作并串联源分支清理。
- **IM-013（candidate · adapter · gap）**：巡检未判定未合并分支是否落后 integrate（ahead / behind）；当前只按合并状态与超期天数分类，无法识别需先 rebase 的陈旧分支。后续采集 merge-base 差量单独标注。
- **`development` 退役**：独立事项，退役前以 `git diff integrate..development` 复核为空后再删本地与远端；本单不执行删除。
- **远端 PR / CI 门禁**：P2 接入 token / gh 后落地；本机无 gh CLI、无 GITHUB_TOKEN，远端 CI 状态不可读。
- **后续 P0 依赖链**：AF-013 依赖 AF-010 / AF-011（均已交付）；AF-014 独立。

## 六、审计链与回写清单

- [x] 交付记录落固定路径；任务单与交付记录成对归档 `completed/phase2.5/`
- [x] 索引状态迁移追加 `history`，工件指针（任务单 / 交付记录）填全
- [x] 快照与看板 data.js 经 CLI 双写刷新；分支变更动作经审计落盘
- [x] `taskId`（AF-012）贯穿任务单 / 分支名 / 交付记录 / 台账关联 / commit message
- [x] 并行线产物 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 未混入本单 stage；运行态 `transport/`、`orchestration-store.sqlite`、`tool-audit-log.json` gitignore 不入库
