# AF-020 交付记录 · 编排闭环加固：CI 契约硬门、发布流水线与状态事件溯源

> 任务单：`af020-orchestration-hardening-2026-11-16.md`｜执行：主控 AI（orchestrator 自做）｜日期：2026-11-16
> 仓库：`D:\work\Project\backend\mofang-nestjs`（分支 `integrate`，基线 `84ed463`）
> 上游：AF-019 收尾基线；框架仓 `v2.0.0`（tag `c507188`）契约不变

## 1. 落地

本单把 AF-019 后识别出的三个口子按企业级标准一次性补齐。核心原则：**不允许 skipped 软通过，不允许发布链路停在人工口头约定，不允许索引只有最终状态而丢失轨迹。**

### 1.1 P0 · CI 跨仓契约硬门

框架仓 `aa386400024/agent-collaboration-framework` 为私有仓，匿名 GitHub API 返回 404，CI 默认 token 不能跨私仓 checkout。直接加 `checkout` 会让流水线被供应链阻断，因此采用仓内不可变契约包：

- `contracts/agent-collaboration-framework/2.0.0/schemas/` 固化框架 2.0.0 全部 14 份机读契约（12 份 schema + `contract-enums.json` + `versions.json`）。
- `PROVENANCE.json` 记录 `sourceRepository`、`sourceRef=v2.0.0`、`sourceCommit=c50718856aa752bac3d87e44b3f309b16fbcb051`、`bundledAt`，以及逐文件 `path/sha256/bytes`。
- `verify-framework-bundle.mjs` 校验清单字段、文件集合、SHA-256、框架版本、每份 schema `$id` 版本；运行结果：`[PASS] 框架契约包 2.0.0（v2.0.0 / c507188）：14 个文件哈希与版本一致`。
- `validator.mjs` 的 `frameworkDir()` 优先级为 `ORCH_FRAMEWORK_DIR` → 本地兄弟仓 → 仓内契约包；`requireFramework()` 读取 `ORCH_REQUIRE_FRAMEWORK=1`，缺 schema / 缺 `versions.json` 时返回失败而不是 `skipped`。
- `.github/workflows/ci.yml` 新增 `Contracts (framework 2.0.0)` job：checkout 本仓 → 安装依赖 → `pnpm orchestration:contracts` → 缺框架 fail-fast 断言 → `pnpm orchestration:validate`。job 环境显式指向契约包，不依赖兄弟仓。

失败模式已在本机实测：`ORCH_FRAMEWORK_DIR=contracts/absent-framework ORCH_REQUIRE_FRAMEWORK=1 node scripts/orchestration/cli.mjs validate` 退出码 1，输出 `[FAIL] 框架契约不可达`；同一命令指向契约包时 9/9 PASS。

### 1.2 P1 · 集成到发布流水线

新增 `.github/workflows/release.yml`，只允许人工 `workflow_dispatch`：

1. `confirm` 必须等于 `release`，否则第一步失败；仅允许 `refs/heads/integrate`。
2. `gh run list --workflow ci.yml --branch integrate` 轮询当前 SHA 的 CI 结论（最长 15 分钟）：未出现 / `in_progress` 继续等待，失败立即拒绝，`completed/success` 才放行。
3. `git fetch origin master integrate --tags` → `checkout -B master origin/master` → 若 `master` 尚未包含 `integrate`，执行 `merge --no-ff` → 校验 `master` 工作树与 `integrate` 完全一致（`git diff --quiet`）；此时只在本地合并，不 push。
4. `docker login ghcr.io` + `docker build/push`，镜像 `ghcr.io/<repo>:<tag>` 与 `:latest`；镜像成功后才 `git push origin master`，避免 master 先于制品推进。
5. tag 采用 `vYYYY.MM.DD-<sha7>`（短 SHA 来自 `integrate` 发布源）；tag 对象指向 `master` 发布合并提交，该提交工作树与 CI 验证过的 `integrate` SHA 完全一致。同 tag 已存在时只允许指向同一发布提交，否则失败；GitHub Release 已存在则跳过。tag 与 Release 均排在镜像成功之后，失败重跑可幂等补完。权限为 `contents: write` + `packages: write` + `actions: read`（`gh run list` 查询 CI 必需）。
6. 可选 `deploy` job：`needs: release`、`if: inputs.deploy == true`、`environment: production`；ssh key 写入、`pnpm build`、`printf 'yes-deploy\n' | pnpm deploy:tested`。默认 `deploy=false`，不自动触发。

> **当前口径（AF-022 起）**：上述“本地 merge 后 `git push origin master`”已被替换为 release 分支 + dispatch CI + PR 合并；本节保留 L4 首次执行历史，不代表当前 `release.yml` 行为。现行流程见 [AF-022 交付记录](af022-release-protection-compatible-implementation-2026-11-17.md)。

**L4 实际执行（2026-11-16）**：

- 首次 run `43894869205` 在 `Fast-forward master locally` 步骤失败。根因：`master` 含 PR 合并提交，与 `integrate` 不是 fast-forward 关系，`merge --ff-only` 无法成立；流水线改为 `merge --no-ff` 并增加 `git diff --quiet` 树一致校验。
- 第二次 run `43895793062` 长期 `queued` 且 API 取消返回 409；同窗口 CI 能正常执行，判定为旧 concurrency 组卡死。保留“同 ref 串行”语义，将组名重置为 `release-publish-${{ github.ref }}`。
- 最终 run [`43901276012`](https://github.com/aa386400024/mofang-nestjs/actions/runs/43901276012) 全步骤 success：CI 门禁 → 本地合并 → GHCR 双 tag 推送 → master 推送 → annotated tag → GitHub Release。
- 发布结果：`master` = `665b19176066155c16a51950bf57482c9329beae`；tag `v2026.11.16-6cfb46e` 指向该 master 发布提交；GitHub Release 已发布；GHCR package `mofang-nestjs` 为 public。
- GitHub 的 `workflow_dispatch` 要求 workflow 文件存在于默认分支。发布前临时把默认分支切到 `integrate` 以暴露工作流，发布成功后已恢复 `master`。
- `deploy=false`，生产部署未执行；需要时再以 `deploy=true` 人工触发。

### 1.3 P2 · 状态索引事件溯源

新增 `scripts/orchestration/event-store.mjs`，把索引从“最终状态表”升级为“日志的只读投影”：

- 唯一写面 `docs/team/agent-orchestration/state/journal.jsonl`，append-only；`task-state-index.json` 只由 `rebuildIndex` 重建。
- 事件模型对齐框架 `state-event:1.0.0`：`eventId / eventSeq / taskId / type / from / to / by / at / idempotencyKey`，14 类事件；`created / archived` 不参与迁移合法性校验。
- 每条事件追加 `prevHash` + `hash` 形成 SHA-256 哈希链，首条 `prevHash=GENESIS`；`journalIntegrity` 同时校验序号严格递增且连续、eventId / 幂等键唯一、同任务时间不倒退、非豁免事件符合框架迁移表（`created / archived / dead-lettered` 豁免）。
- `appendEvents` 在 `state/journal.lock`（`wx`）下执行幂等过滤、序号分配、哈希链追加；30 秒 stale 锁自动清理。
- `projectJournal` 是纯函数：创建、迁移、归档均可重建；`projection.rebuiltAt` 恒 `null`，保证逐字节可复现。
- `archivedNotes` 为适配层扩展，外移到 `state/archived-notes.json`，重建时合并；避免框架官方投影丢弃扩展字段。
- `scheduler.mjs` 的 `advanceOnce` 与 `cli.mjs` 的 `archive` 全部改走 `commitIndex` / `archiveTask`；CLI 新增 `events verify|rebuild|backfill|create`。
- 回填：36 条归档 ×（created + archived）= 72 条基线事件，固定 `at=2026-11-16T00:00:00.000Z`、`by=AF-020-backfill`；日志非空时拒绝重复回填。
- AF-020 自身经 `events create` + `events archive` 追加 2 条事件，最终日志 74 条、归档 37 条、说明 12 条。

### 1.4 适配层语义取舍（2026-11-17 已对齐框架）

~~框架官方投影在 `archived` 事件上只保留 `rec.status`；本适配层允许 scheduler 把非终态任务（如 `working`）直接归档为 `rejected`，因此归档事件携带 `to=rejected`，投影以事件 `to` 落终态。~~

**2026-11-17 收口**：已按框架 `state_projection.py` 口径改为「归档动作不改写状态」——投影落事件前 `rec.status`（必须终态），`to` 仅供 schema 表达且必须等于当前终态。scheduler 归档前先沿 `TRANSITIONS` BFS 补齐合法迁移链（如 `working → submitted → completed`），`deriveEvents` 同步合成闭合事件；`archiveTaskEntry` / `archiveTask` / `buildArchivedEvent` 均拒绝非终态或改写终态。对应测试新增「归档非终态任务先补迁移链」断言。

## 2. 证据

| 闸门                        | 命令                                                                                                           | 结果                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 契约包完整性                | `node scripts/orchestration/verify-framework-bundle.mjs`                                                       | `[PASS] 14 个文件哈希与版本一致`；exit 0                                                |
| 契约硬模式（缺框架）        | `ORCH_FRAMEWORK_DIR=...absent ORCH_REQUIRE_FRAMEWORK=1 node cli.mjs validate`                                  | exit 1，`[FAIL] 框架契约不可达`                                                         |
| 契约硬模式（仓内包）        | `ORCH_FRAMEWORK_DIR=contracts/.../2.0.0 ORCH_REQUIRE_FRAMEWORK=1 ... validate`                                 | 9/9 PASS；exit 0                                                                        |
| 编排层单测                  | `pnpm test -- scripts/orchestration/__tests__/orchestration.spec.mjs`                                          | `136 passed / 0 failed`（原 130 + 事件溯源 5 + 迁移/序号校验 1）                        |
| 事件日志                    | `pnpm orchestration:events verify`                                                                             | 74 条；schema、哈希链、索引投影一致                                                     |
| 工作流 YAML                 | `python -c "yaml.safe_load(...)"`                                                                              | `ci.yml` 8 jobs、`release.yml` 2 jobs，结构合法                                         |
| 全量单测 / Lint / Typecheck | 见 §2.1                                                                                                        | 全部 exit 0                                                                             |
| 快照与看板                  | `pnpm orchestration:snapshot`                                                                                  | 归档 37 / 说明 12 / 改进台账 34 / 工具审计 13；快照与数据源同步                         |
| 本批 CI                     | push `integrate` → CI run [43885756756](https://github.com/aa386400024/mofang-nestjs/actions/runs/43885756756) | 8/8 success（含 Contracts）；0 warning / 0 error 注解，仅 GitHub `ubuntu-latest` notice |
| CI 并行化后                 | push `integrate` → CI run [43908742889](https://github.com/aa386400024/mofang-nestjs/actions/runs/43908742889) | 8/8 success；墙钟 **129s（2 分 09 秒）**；各 job 同步 start +3~5s，最长 Coverage 124s   |
| L4 首次发布失败             | Release run [43894869205](https://github.com/aa386400024/mofang-nestjs/actions/runs/43894869205)               | 步骤 11 `Fast-forward master locally` 失败；master 与 integrate 非 ff 关系              |
| L4 卡队列                   | Release run [43895793062](https://github.com/aa386400024/mofang-nestjs/actions/runs/43895793062)               | 长期 queued；API cancel/force-cancel 均 409；重置 concurrency 组后解除                  |
| L4 最终发布                 | Release run [43901276012](https://github.com/aa386400024/mofang-nestjs/actions/runs/43901276012)               | success；master `665b191`、tag `v2026.11.16-6cfb46e`、Release 已发布、GHCR public       |

### 2.1 收尾闸门

| 闸门      | 命令             | 结果                                                     |
| --------- | ---------------- | -------------------------------------------------------- |
| 全量单测  | `pnpm test`      | `3509 passed / 8 skipped`（202 文件，1 skipped），exit 0 |
| Lint      | `pnpm lint`      | exit 0（0 error / 0 warning）                            |
| Typecheck | `pnpm typecheck` | exit 0                                                   |

> 首轮“全量 + lint/typecheck 并发”时 `test/admin-debug/wp38-debug-session-resume.spec.ts` ③ 触发 30s 超时；该 spec 单独复跑 10/10、100ms 通过，判定为并发负载 flake。2026-11-17 已按 IM-034 根治：改为 `awaitPendingTitleGeneration()` 等待服务登记的异步标题任务，删除固定 30s 轮询；全量收尾闸门 `3509 passed / 8 skipped`、23.79s，无超时。

## 3. 范围核对

- `src/` 业务源码、依赖、migration、`admin-dashboard/`：零改动。
- 框架仓：零改动；框架契约仅以只读契约包形式固化。
- 历史交付记录：零改写；AF-019 及此前记录保持只读。
- 用户未跟踪 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`：保持未跟踪、未改动、未入库。
- 无并行进程产物混入；`state/journal.lock` 未残留（运行后已释放）。

## 4. 契约核对

- `task-state-index.json` 仍为 `task-state-index:1.1.0`；新增 `projection` 为适配层扩展字段，schema 顶层 `additionalProperties: true` 允许。
- 索引字段顺序：`version / schemaRef / note / projection / tasks / archivedTasks / archivedNotes`；`rebuildIndex` 输出同序，`verifyProjection` 逐字段比较（忽略 `rebuiltAt`）。
- 事件 schema 引用 `urn:agent-collaboration-framework:schema:state-event:1.0.0`；14 类事件枚举与框架 `versions.json` 一致。
- `archivedNotes` 仍是适配层扩展；已外移到 `state/archived-notes.json`，索引中保留投影结果供只读消费。
- 发布 workflow 不新增运行时依赖；GHCR 使用 `GITHUB_TOKEN`，部署 secret 仅在 `deploy=true` 时读取。

## 5. 遗留与另案

- **P1 真实发布已执行一次**：2026-11-16 以 `deploy=false` 完成 master 合并、tag、Release、GHCR；生产部署仍未执行。首次生产部署前需确认 `DEPLOY_HOST` / `DEPLOY_SSH_KEY` secret 与 `production` environment 已配置，再人工 `deploy=true` 触发。
- **框架官方投影与适配层归档语义已对齐（2026-11-17）**：见 §1.4；归档不再改写终态，非终态任务先补齐合法迁移链。
- **`state/journal.jsonl` 长期保留已落地（2026-11-17）**：新增 `events rotate` 分段 + gzip 归档，事件逐字保留、跨段哈希链连续；当前 74 条已归档为 `state/journal-archive/journal-000001-000074.jsonl.gz`，活动日志重建为空。
- **`master` 已受保护（2026-11-17）**：classic branch protection，12 项必需检查、strict、enforce_admins、禁 force push / 删除、要求会话解决；因 personal repo ruleset 不允许 GitHub Actions bypass，保留 Release `GITHUB_TOKEN` 直推通道，未强制 PR。
- **IM-034 已修复（2026-11-17）**：WP38 ③ 不再用 30s 轮询等 fire-and-forget 标题落盘，改为 `DebugSessionService.awaitPendingTitleGeneration()` 等待登记的异步任务；并发下不再与文件写竞态。
- **CI 再提速（2026-11-17）**：Docker build 接 GHA 分层缓存；Coverage 改 3 片采集 + `Coverage Gate` 合并后统一阈值；TypeScript `--incremental` + buildinfo 缓存；ESLint `--cache-strategy content` + pnpm store 路径修正；稳态 CI 111s。
- **生产部署仍未执行**：用户明确暂缓；首次生产部署前需确认 secrets / production environment。
