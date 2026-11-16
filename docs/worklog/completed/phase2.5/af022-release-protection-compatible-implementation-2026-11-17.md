# AF-022 · 发布链路兼容 master 必需检查（2026-11-17）

## 交付摘要

| 项           | 落地                                                                                                   | 关键口径                                           |
| ------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Release 分支 | 从 `integrate` 建 `release/<tag>-<run>-<attempt>`，先合并 `origin/master`                              | 合并冲突直接失败；确保 master 是发布提交祖先       |
| 按需 CI      | `ci.yml` 新增 `workflow_dispatch`；release 分支 push 后由 `gh workflow run ci.yml --ref <branch>` 触发 | GITHUB_TOKEN 的 push 不触发 CI，必须显式 dispatch  |
| PR 发布      | `gh pr create --base master --head <release-branch>`，检查通过后 `gh pr merge --merge`                 | 不再直推 master；PR 审查/检查记录可追溯            |
| 发布产物     | 合并后 annotated tag → GitHub Release → GHCR `TAG` + `latest`                                          | 镜像在 PR 合并前构建，避免 master 已更新但镜像缺失 |
| dry-run      | 默认 `true`；只走到 PR 创建，随后关闭 PR、删分支                                                       | 不合并 master、不打 tag、不推 GHCR、不建 Release   |
| 安全门       | `deploy` 仍需 `deploy=true && dry_run=false`                                                           | 生产部署继续暂缓                                   |

## 1. 问题与根因

AF-021 给 `master` 开启 12 项必需检查并 `enforce_admins=true` 后，原 `release.yml`：

1. 本地 `git merge --no-ff integrate` 生成新 merge SHA；
2. 直接 `git push origin master`。

该 merge SHA 从未跑过 12 项检查，按 GitHub 保护规则不能直接改受保护分支。更关键的是：GitHub 要求 `workflow_dispatch` 存在于默认分支；`master` 上的 `ci.yml` 当时还没有这个触发器，导致首次 dry-run 的 dispatch run 创建后一直 `queued`、不分配 job，根因即在此。

## 2. 实现

### 2.1 `release.yml`

- 输入：`confirm`、`deploy`、`dry_run`（默认 `true`）。
- 流程：
  1. 校验同一 `integrate` SHA 的 CI 绿灯；
  2. 建 release 分支并合并 `origin/master`；
  3. push release 分支；
  4. `gh workflow run ci.yml --ref <branch>`，轮询找到该 SHA 的 run，`gh run watch --exit-status`；
  5. 真实发布：构建并推 GHCR；创建 PR；等待 `mergeStateStatus=CLEAN` 后合并；校验 merge 提交与 release 提交 tree 一致；打 tag；建 Release；删 release 分支；
  6. dry-run：创建 PR 后关闭并删分支，不发版。
- 权限：`contents: write`、`packages: write`、`actions: write`、`pull-requests: write`。

### 2.2 `ci.yml`

新增 `workflow_dispatch`，其余 12 个 job 与 required contexts 不变。

### 2.3 默认分支引导

`master` 原 `ci.yml` 无 `workflow_dispatch`，导致 dispatch 永远排队。做法：

1. 备份 `master` 保护配置；
2. 临时把 `required_status_checks` 置空，保留 `enforce_admins=true`、禁 force/删、会话解决；
3. 在 `master` 上追加一个只改触发器的提交 `2f8afd9 ci: 为默认分支补 workflow_dispatch 触发器`；
4. 立即恢复 12 项 contexts / strict / enforce_admins。

这是保护开启后唯一一次受控直推，只改触发器，不改 job 与业务代码。

## 3. 实测

### 3.1 首次 dry-run（失败/取消）

- release run `43923576908`（`202ea06`，dry-run）在 dispatch 步骤卡住；
- 对应 CI run `43923667432` 一直 `queued`、jobs=0；
- 根因：默认分支缺 `workflow_dispatch`；
- 已取消 run，删除 release 分支 `release/v2026.11.16-202ea06-43923576908-1`。

### 3.2 第二次 dry-run（成功）

- release run [`43927385743`](https://github.com/aa386400024/mofang-nestjs/actions/runs/43927385743)：**success**。
- 关键步骤：
  - `Assert CI is green for this exact SHA` success；
  - `Prepare release branch` success；
  - `Push release branch` success；
  - `Dispatch CI for release commit` success；
  - `Create release PR` success；
  - `Dry-run summary` success；
  - `Cleanup dry-run artifacts` success；
  - `Merge release PR` / tag / Release / GHCR 全部 skipped。
- release 分支：`release/v2026.11.16-202ea06-43927385743-1`，发布提交 `47b342d4965ac4af523d32b361fd6feb474b6196`。
- PR：`#7 chore(release): v2026.11.16-202ea06`，已关闭，未合并。
- 分支已删除；当前无残留 `release/*`。

### 3.3 检查证据

- release 分支 CI [`43927477978`](https://github.com/aa386400024/mofang-nestjs/actions/runs/43927477978)：**12/12 success**，head `47b342d4965ac4af523d32b361fd6feb474b6196`。
- 该提交 check-runs：**12 项，全部 success**，名称与 `master` required contexts 完全一致。

### 3.4 无副作用核对

- `master` 仍为 `2f8afd9a553faf2001a27bf2edb02b4219c18d4c`，dry-run 未改 master。
- 无新 tag / 新 Release；仍只有 `v2026.11.16-6cfb46e`。
- GHCR 未推新镜像（dry-run 跳过 Docker 步骤）。
- `master` 保护恢复：12 contexts、strict=true、enforce_admins=true、禁 force/删、会话解决。

## 4. 偏差与取舍

1. **dry-run 默认 true**：真实发布必须显式取消勾选；比“默认真实发布”更安全，但多一步人工确认。
2. **PR 合并提交是 GitHub 生成的新 SHA**：tag 指向该 merge commit；合并后校验其 tree 与 release 提交一致，避免内容漂移。
3. **镜像在 PR 合并前推 GHCR**：若 PR 合并失败，镜像可能先行存在；换取了“master 更新后不会缺镜像”。首次真实发布需注意清理孤立 tag。
4. **默认分支引导直推**：一次受控例外，只加触发器；已恢复保护并留证。
5. **真实 merge/tag/GHCR 未执行**：按用户要求只做 dry-run；`gh pr merge` 权限与 tag 推送路径尚未实跑。

## 5. 遗留

- 首次真实发布需人工盯守：确认 PR 合并成功、tag 指向 merge commit、Release 与 GHCR 双 tag 正常。
- 生产部署仍未执行；`DEPLOY_HOST` / `DEPLOY_SSH_KEY` / production environment 未验证。
- PR-only 保护仍未开启；当前保留 release PR 路径，但 direct push 已被必需检查约束。
