# AF-368 框架 v2.1.0 发行锚点与契约包来源校准 — 交付记录

- 任务：AF-368（R1 / standard / orchestrator）
- 提交：`fa2b0e2e` docs(orchestration): AF-368 校准框架 v2.1.0 tag 与契约来源
- 日期：2026-11-23

## 事实

- 框架 PR #1（`feat/v2.1-operational-contracts`）已 rebase 合并到 `main`：`e6dd22d42f4a4017efb660fe0ab1c099df6608ee`。
- annotated tag `v2.1.0`：tag object `06045fb92ffb0ec71e6cc6fa4b7632ca55be5d3e` → commit `e6dd22d`。
- 上一正式发行 `v2.0.0`：tag object `c507188` → `67d3290`。

## 变更

1. `contracts/agent-collaboration-framework/2.1.0/PROVENANCE.json`
   - `sourceRef` 改为 `main`，`sourceCommit` 改为 `e6dd22d`，新增 `sourceTag=v2.1.0` / `sourceTagObject=06045fb`，`bundledAt` 更新。
2. `docs/team/agent-orchestration/framework-version-anchor.md`
   - 发行状态改为已发行；明确 tag object 与 commit；删除“尚未打 tag”口径。
3. `docs/team/agent-orchestration/README.md`、契约包 `README.md`
   - 同步 tag/commit 事实。

## 证据

- `pnpm orchestration:contracts`：`[PASS] 框架契约包 2.1.0（main / e6dd22d）：15 个文件哈希与版本一致`，exit 0。
- `git ls-remote --tags origin v2.1.0`：`06045fb92ffb0ec71e6cc6fa4b7632ca55be5d3e refs/tags/v2.1.0`。
- 15 个 schema 文件未改动，仅来源元数据与文档更新。
- `git diff --stat HEAD -- src/engine-core`：空。

## 偏差

- GitHub rebase 合并生成新的 main commit `e6dd22d`（而非原 feature commit `e412403`）；因 tree 相同，15 文件哈希不变，PROVENANCE 改指 main，历史候选 commit 保留在锚点文档中。
