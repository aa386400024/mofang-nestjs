---
taskId: AF-020
contextId: phase2.5-orchestration-closed-loop
title: 编排闭环加固：CI 契约硬门、发布流水线与状态事件溯源
type: implementation
status: completed
baselineRef: 84ed463
dependsOn: [AF-019]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#2.4, autonomous-team-design.md#4.4, autonomous-team-design.md#6.1]
createdAt: 2026-11-16T22:00:00+08:00
---

# AF-020 · 编排闭环加固：CI 契约硬门、发布流水线与状态事件溯源

> 状态：已交付（2026-11-16）｜编排：主控 AI（orchestrator 自做）｜交付记录：af020-orchestration-hardening-implementation-2026-11-16.md
> 仓库：`D:\work\Project\backend\mofang-nestjs`；落点 `contracts/`、`.github/workflows/`、`scripts/orchestration/`、`docs/team/agent-orchestration/`、`docs/worklog/`
> 上游：AF-019 收尾基线（`84ed463`）；框架仓 `v2.0.0`（tag `c507188`）契约不变

## 1. 背景

AF-019 把适配层迁到框架 v2.0.0 并完成分支与 CI 收尾，但当时明确留下三个未闭环口子：

1. **P0 CI 不校验跨仓契约**：CI 只 checkout 本仓，`validator.mjs` 找不到兄弟框架仓时返回 `skipped`，单测对 `skipped` 容错；CI 绿灯不等于 7 项契约真实通过。
2. **P1 集成到发布未闭环**：`master` 停在 `8ffb6a3`，`integrate` 已到 `84ed463`；没有 tag、Release、GHCR 镜像与部署流水线。
3. **P2 状态索引没有事件溯源**：索引只有最终状态和轻量归档指针，无法从日志完整重建每次迁移、审批与归档轨迹。

框架仓为私有仓，CI 默认 `GITHUB_TOKEN` 不能跨私仓读取。若直接 checkout 框架仓，流水线会被供应链阻断；本单因此采用**仓内不可变契约包**方案，而不是“补一个永远 skipped 的假 job”。

## 2. 范围

**在范围内：**

- P0：固化框架 2.0.0 全部 14 份 schema 与来源清单；新增契约包哈希校验；`validator.mjs` 增加 `state-event` 与硬模式；CI 新增 `Contracts` job，并用缺框架场景证明 fail-fast。
- P1：新增手动触发的 `Release` workflow：校验同一 SHA 的 CI 绿灯 → fast-forward `master` → tag → GitHub Release → GHCR 镜像 → 可选生产部署。
- P2：新增 append-only `state/journal.jsonl` 唯一写面、只读索引投影、SHA-256 哈希链、幂等键、单写者锁、重建与校验；回填 36 条历史归档。
- 记录：AF-020 任务单/交付记录、改进台账 3 条、索引与说明侧车、快照/看板重生成、工作记录入口登记。

**明确不在范围内：**

- 不改 `src/` 业务源码、依赖、migration、`admin-dashboard/`。
- 不改框架仓；不重写历史交付记录；不把 `phase3` 设计稿入库。
- 不实际执行 `Release` 的 master 合并、tag、GHCR 发布或生产部署；这些是 L4 人工冻结动作，本单只交付可复现流水线。
- 不引入 `FRAMEWORK_REPO_TOKEN` 或私仓匿名访问兜底；契约包是 CI 的权威供应链。

## 3. 交付物

1. `contracts/agent-collaboration-framework/2.0.0/`：14 份 schema + `PROVENANCE.json`（来源仓、tag、commit、逐文件 SHA-256）+ `README.md`。
2. `scripts/orchestration/verify-framework-bundle.mjs`：契约包完整性、哈希、框架版本与 schema `$id` 校验。
3. `validator.mjs` 硬模式：`ORCH_REQUIRE_FRAMEWORK=1` 时缺框架 / 缺 schema / 缺 `versions.json` 一律失败；CI `Contracts` job 使用 `ORCH_FRAMEWORK_DIR` 指向契约包。
4. `scripts/orchestration/event-store.mjs`：日志追加、投影、哈希链、幂等、锁、回填、提交。
5. `state/journal.jsonl`（74 条事件）+ `state/archived-notes.json`（12 条说明）+ 带 `projection` 的索引（37 条归档）。
6. `.github/workflows/release.yml`：`workflow_dispatch` + `confirm=release` + `deploy` 布尔输入；仅允许 `integrate`；同 SHA CI 绿灯（15 分钟轮询）→ GHCR 镜像 → master fast-forward → tag → GitHub Release → 可选 production deploy。
7. 事件溯源 6 个新单测（含迁移合法性与序号连续性）；`cli validate` 9/9；编排层 136 passed。
8. AF-020 两份记录、IM-031/032/033、快照与看板。

## 4. 红线

- `contracts/` 是**不可变发布制品**：任何 schema 改动都必须重新固化并更新 `PROVENANCE.json`，禁止手改单份文件。
- 事件日志 append-only：任何状态写入必须经 `commitIndex` / `archiveTask` / `createTask`；禁止直接改 `task-state-index.json`。
- 哈希链与 `projection.lastEventSeq` 必须可验证；`rebuildAt` 恒为 `null`，保证重建逐字节可复现。
- `Release` 的 master 合并、tag、Release、GHCR 与部署只能由人手动触发；workflow 不得在 push 上自动发布。
- 生产部署 job 默认关闭，必须显式 `deploy=true` 且走 `production` environment；secret 未配置时不得伪造成功。

## 5. 交付回写清单

- [x] P0 契约包、哈希校验、validator 硬模式、CI `Contracts` job
- [x] P1 `release.yml`（人工触发、CI 门禁、master/tag/release/GHCR、可选部署）
- [x] P2 事件日志、只读投影、哈希链、幂等、单写者锁、回填
- [x] 事件溯源单测与 `cli validate` 9/9
- [x] AF-020 任务单与交付记录
- [x] IM-031/032/033 流转 done 并关联 AF-020
- [x] 索引 37 条归档 / 12 条说明；快照 / 看板重生成
- [x] 全量闸门与 CI 真实绿灯证据
