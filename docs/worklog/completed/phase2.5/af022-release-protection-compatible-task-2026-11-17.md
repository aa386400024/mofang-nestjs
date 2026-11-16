---
taskId: AF-022
contextId: framework-evolution
title: 发布链路兼容 master 必需检查：release 分支 + PR + dispatch CI
type: implementation
status: completed
baselineRef: 832b6d6
dependsOn: [AF-021]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: 2026-11-17T02:20:00+08:00
---

# AF-022 · 发布链路兼容 master 必需检查

> 状态：✅ 已完成（2026-11-17）
> 执行方：orchestrator 自做
> 仓库：`D:\work\Project\backend\mofang-nestjs`，分支 `integrate`
> 唯一事实源：`.github/workflows/release.yml`、`.github/workflows/ci.yml`
> 任务性质：发布流水线保护兼容改造
> 改动范围：仅两个 workflow + 发布文档；生产部署排除，真实发版未执行

## 1. 目标

AF-021 开启 `master` 12 项必需检查后，原 `release.yml` 的本地 `merge --no-ff` 会产生一个从未跑过检查的新 SHA，`git push origin master` 在 `enforce_admins=true` 下预期被拒。本单把发布链路改成：

1. release 分支合并 `master`，得到发布提交。
2. 对该提交按需 dispatch 完整 CI，跑满 12 项必需检查。
3. 创建 release PR；检查通过后合并 PR。
4. 合并后打 annotated tag、建 GitHub Release、推 GHCR。
5. 默认 `dry_run=true`，只验证分支/CI/PR 创建，结束关闭 PR、删分支；真实发布必须显式 `dry_run=false`。

## 2. 范围与隔离

- 允许：`.github/workflows/release.yml`、`.github/workflows/ci.yml`、发布相关 worklog。
- 禁止：生产部署、业务 `src/`、框架仓、未跟踪设计稿。
- 不真实发版：dry-run 不合并 master、不打 tag、不推 GHCR、不建 Release。
- 一次性例外：为让 `workflow_dispatch` 在默认分支可用，master 做过一次仅改触发器的受控直推；推前临时摘除必需检查，推后立即原样恢复。

## 3. 验收口径

- workflow YAML 可解析；`ci.yml` 的 12 个 job 名称不变。
- release 分支提交上的 check-runs 恰好 12 项且全部 success。
- dry-run 结束后：PR 已关闭、release 分支已删除、master SHA 未变、无新 tag/Release、保护 12 项已恢复。
- 真实发布路径保留 `deploy=true && dry_run=false` 双条件；生产仍不执行。

## 4. 交付回写

- [x] release 分支 + PR + dispatch CI 落地
- [x] `dry_run` 默认 true 与清理逻辑
- [x] dry-run 实测：`43927385743` success；PR #7 closed；分支删除
- [x] release 分支 CI 实测：`43927477978` 12/12 success；check-runs 12/12
- [x] master 保护恢复：12 contexts / strict / enforce_admins
- [ ] 真实合并、tag、Release、GHCR：按用户要求只做 dry-run，未执行
- [ ] 生产部署：未执行

## 5. 遗留风险

- 真实路径的 `gh pr merge`、tag、GHCR 未实跑；首次真实发布仍需人工盯守。
- `master` 引导提交 `2f8afd9` 是保护开启后唯一一次受控直推，已在交付记录中留证。
