---
taskId: AF-223
contextId: phase3-orchestration-hardening
type: implementation
agentRole: orchestrator
baselineRef: db4c93d
completedAt: 2026-11-21T03:20:00+08:00
commitMessage: 'feat(af223): 跨机取号仲裁（远端占号 CAS / 重建排除自身分支 / 运行态目录忽略）'
---

# AF-223 交付记录 · 跨机取号仲裁

- 任务：AF-223（`phase3-orchestration-hardening`，orchestrator）
- 基线：`db4c93d`（AF-222 批次 squash 结果）
- 角色：orchestrator（资源域：`scripts/` + `docs/team/agent-orchestration/` + `.gitignore`）
- 交付日期：2026-11-21

## 1. 问题与根因

AF-222 落地三源占用检查后，撞号从「静默双写」变成「显式拒绝」，但仍然留下两个摩擦口：

1. **取号本身不是原子的**：三源检查只能读。两台机器同时执行 `task next-id` 会算出同一个号，谁先登记谁赢；输的一方整批返工（AF-221 即为此重建）。
2. **重建被自己挡住**：任务号一旦被本机推过 `task/AF-NNN-*` 分支，自己再登记同号会被 `remoteBranches` 源判为占用，必须换号（AF-221 → AF-222 的换号就是这么发生的）。
3. **运行态目录未忽略**：根级 `transport/`（回执、派单、确认件）每次 `run-once` 都变，却持续以未跟踪文件出现在 `git status`，容易误入提交。

## 2. 改动文件

新增：

- `scripts/orchestration/task-id-reservation.mjs`（占号 ref 的 CAS 句柄 + 取号顺延循环）
- `scripts/orchestration/__tests__/task-id-reservation.spec.mjs`（8 例）

修改：

- `scripts/orchestration/task-id-occupancy.mjs`（追加远端占号源；`excludeRefs` 与 `selfOnlyIds`；断言对重建放行）
- `scripts/orchestration/cli.mjs`（`task next-id --reserve`、`task reserve`、`task release-id`；`register` 自动排除本机同名分支）
- `scripts/orchestration/task-intake.mjs`（把 `excludeRefs` 透传到占用检查，改用断言返回的 warnings）
- `scripts/orchestration/__tests__/task-id-occupancy.spec.mjs`（离线 warning 计数 2 → 3）
- `.gitignore`（新增 `/transport/` 及说明）
- `docs/team/agent-orchestration/agent-cards/orchestrator.json`（resources 补 `.gitignore`）
- `docs/team/agent-orchestration/cross-machine-single-writer.md`（§3 扩为「三源 + 预约」并新增 §3.1 / §3.2；§4.1 编号口径改为 AF-222 批次；§5 取号步骤改 `--reserve` 并新增合并后清账；§6 补三条边界）

## 3. 关键设计决策

**占号 ref 放在 `refs/heads/orchestration-task-ids/<ID>`**：与远端单写者锁同源理由——GitHub 只保证 advertized ref（heads/tags）常规可见，非 heads 的 ref 在部分环境 `git fetch <ref>` 报 "couldn't find remote ref"。代价是分支列表多一类前缀；CI 只在 `master`/`integrate` 触发，不会因此跑流水线。

**仲裁落在 push，不落在 ls-remote**：`reserve` 先 `ls-remote` 判断是否已被占（快速失败），真正判定用 `push <sha>:<ref>` 的非快进语义。两者之间被插入时 push 失败并顺延，不会双占。这比「读—比对—写」的锁自愈路径更硬。

**远端不可达时不给号**：`next-id --reserve` 遇到 `ls-remote` 失败会打印只读建议并 exit 非 0，明确写「不要据此登记」。宁可不给号，也不给一个没抢下的号——否则等于把问题藏起来。

**排除自身分支只放行 `selfOnlyIds`**：只有「该号仅出现在被排除的那条本机分支上」才放行；一旦它同时出现在远端索引或占号 ref 里，照旧拒绝。排除粒度是「一条 ref」，不是「整个远端分支源」。

**释放而不是永久占用**：占号 ref 只承担登记前仲裁，登记完成后索引与 records 接管占用。永久保留会让远端 ref 无界增长，因此归档后 `task release-id` 清理；释放失败只写 warning，不阻塞归档。

**`.gitignore` 进 orchestrator 资源域**：`/transport/` 是编排运行态，维护忽略规则属于编排者职责；与 `.prettierignore` 同一层处理，避免为一行 ignore 另开 executor 任务。

## 4. 闸门数字（真实执行）

- `pnpm exec vitest run scripts/orchestration/__tests__`：11 files / 336 tests 全绿（新增占号与重建放行 8 例）
- `pnpm lint`：exit 0，双配置 0 error
- `pnpm typecheck`：exit 0，0 error
- `pnpm test`：246 files（245 passed + 1 skipped）/ 4162 tests（4155 passed + 7 skipped），79.07s，exit 0
- `git diff --stat HEAD -- src/engine-core`：输出为空
- `git check-ignore -v transport/receipts/AF-222.json`：命中 `.gitignore:139:/transport/`

## 5. 现场取证（真实 GitHub 远端）

```
task next-id              → AF-224
task next-id --reserve    → AF-224
git ls-remote --heads origin 'orchestration-task-ids/*'
  0373f4701a56b6293fafdd0f77d6c5d79fe8831b  refs/heads/orchestration-task-ids/AF-224
task release-id --taskId AF-224 → 已释放占号 AF-224
git ls-remote --heads origin 'orchestration-task-ids/*' → 空
```

占号 → 远端 ref 出现 → 释放 → ref 消失，三段闭环。占号期间 `AF-224` 会被三源之外的新源算作占用，因此可用性判断一致。

## 6. 已知边界

- `task next-id` 只读形态不占号，仍可能被两机同时看到同一个建议；**必须用 `--reserve` 才能保证唯一**。
- 占号 ref 的 payload 只用于审计，不做陈旧回收：如果一台机器占号后彻底放弃，该号会一直占着，需要人工 `release-id`。
- 排除自身分支依赖「当前分支名 = `task/<taskId>-*`」；若在 `integrate` 上登记（不正常路径），排除不生效，行为回退到 AF-222 的严格口径。
- 占号只覆盖 AF 系列前缀；`--prefix TD` 等其他前缀共用同一套 ref 前缀，不会串号。

## 7. 后续（不在本单）

- 占号 ref 的陈旧回收（例如超过 7 天未登记自动提示），目前靠人工清账。
- 把 `run-once` 领单也接入占号事实（当前只用远端锁），减少「登记了但一直被别的号排前面」的空转。
