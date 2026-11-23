# AF-384 交付记录：公开仓泄露面收敛与 4C8G self-hosted runner 接入准备

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-384/task-sheet.md`
- 基线：`31eaf7d2faabcdd5957b10cfc0ee4065e795a526`
- 分支：`task/AF-384-4c8g-self-hosted-runner`
- 日期：2026-11-23

## 一、改动文件

| 文件                                                     | 动作 | 说明                                                                                                             |
| -------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `.env.bak.rsa-fix-2026-10-15`                            | 删除 | 从公开 HEAD 移除含真实密钥的备份；历史旧 blob 保留到私有化窗口清理                                               |
| `.gitignore`                                             | 修改 | 增加 `.env.bak*`、`.env.backup*`、`.env.local`、`.env.*.local`                                                   |
| `docs/security/secret-rotation-2026-11-23.md`            | 新增 | P0 轮换清单、GitHub 设置、数据审计、历史清理步骤；不记录密钥值                                                   |
| `docs/security/self-hosted-runner.md`                    | 新增 | 4C8G 专用 CI/staging 运行手册：标签、资源上限、缓存、隔离、public 仓禁用                                         |
| `.github/workflows/ci.yml`                               | 修改 | 9 个 job 的 `runs-on` 改为 `${{ vars.CI_RUNNER \|\| 'ubuntu-latest' }}`                                          |
| `scripts/orchestration/pr-release.mjs`                   | 修改 | `create` 默认 `draft:true`；`merge` 对 draft PR 经 `/graphql` 调 `markPullRequestReadyForReview` 后再等待 checks |
| `scripts/orchestration/__tests__/orchestration.spec.mjs` | 修改 | 新增 draft payload 断言与 ci.yml 无裸 `ubuntu-latest` 静态断言                                                   |

## 二、关键设计决策

1. **public 阶段不接 self-hosted runner。** 公开仓 fork PR 可在 runner 上执行代码；本轮只做变量化准备，`CI_RUNNER` 留空继续走 GitHub 托管。
2. **PR 默认 draft。** 创建与后续 push 不触发全量 CI；合并前用 GraphQL mutation 转 ready，跑一次 11 项 required checks，再 squash。
3. **REST 没有 ready_for_review 端点。** 实测 `POST /pulls/{n}/ready_for_review` 返回 404；改为 GraphQL `markPullRequestReadyForReview`，PR 的 `node_id` 从 REST 详情取。
4. **不重写历史。** 公开仓直接 `filter-repo` 会改写全部 SHA 与记录包，且无法回收已爬取副本；历史清理留到私有化窗口。
5. **轮换优先于删除。** 文件已公开约五周，先让旧密钥失效；删除 HEAD 只阻断继续泄露。

## 三、与任务单的偏差

- 原计划 runbook 放 `docs/runbooks/`，不在 orchestrator 资源域；AF-379 被拒后改放 `docs/security/self-hosted-runner.md`。
- AF-380 因 scope 漏列删除路径被 preflight 拦截；AF-381 因前置未合并且被取消；AF-382 因回执先摄入后冻结被判 rejected；最终由 AF-383 合入资源域白名单、AF-384 执行清理。
- 未实际接入 runner、未购买/配置服务器、未切换仓库可见性，均在 outOfScope 内。

## 四、闸门数字

| 闸门                                                                          | 结果                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | exit 0，272 passed / 272                                                  |
| `pnpm lint`                                                                   | exit 0，0 error                                                           |
| `pnpm typecheck`                                                              | exit 0，0 error                                                           |
| `pnpm test`                                                                   | exit 0，311 passed / 1 skipped 文件；4751 passed / 4 skipped 用例；27.11s |
| CI YAML 解析                                                                  | 9 个 job 可解析；`pull_request.types` 含 `ready_for_review`               |
| `git ls-files -- .env.bak*`                                                   | 空                                                                        |
| `git diff --stat HEAD -- src/engine-core`                                     | 空                                                                        |
| AF-383 远端 PR #186                                                           | 20 checks pass；squash `d494805ac4c05557c356dfd01f209e61c3d1a80c`         |

## 五、遗留与后续

- 密钥轮换本体未执行：MiniMax、Embedding、Qdrant、MySQL、Redis、SMTP、JWT、RSA 需在外部平台逐项轮换，清单见 `docs/security/secret-rotation-2026-11-23.md`。
- 历史中的 `.env.bak` blob 仍可访问；私有化窗口执行 `filter-repo` 或干净重建仓。
- GitHub Secret Scanning、Push Protection、fork PR 审批、Actions 权限尚未实际变更；public 仓建议尽快开启。
- 4C8G 服务器到位后按 `docs/security/self-hosted-runner.md` 在私有测试仓验证，再切主仓 `CI_RUNNER=mofang-ci`。
- 11 个孤儿记录包（AF-363..AF-372、AF-376）仍未回放历史归档事件，`worklog verify --strict` 在 state-free 模式跳过。
