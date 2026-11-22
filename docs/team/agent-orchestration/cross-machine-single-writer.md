# 跨机单写者与编号分配口径（AF-217）

> 适用：多台开发机（或多个人）共用同一个 `origin` 时的编排运行。当前现场是
> `DESKTOP-6U804B0`（主控 / 编排）与 `DESKTOP-E3EVQ9P`（并行开发）。
> 单一真相源：本文件写口径，代码写行为（`scripts/orchestration/`）。

## 1. 为什么需要这一层

`run-lock.mjs` 的锁文件在 `transport/` 下，而 `transport/` 被 gitignore。**它只能挡住同一台机器上的两个进程**，挡不住两台机器。两台机器同时跑 `pnpm orchestration:run` 会：

- 重复领单（同一任务被两边各自 claim）；
- 重复验收（两边各自跑护栏、各自写快照）；
- 互相覆盖状态面（`journal.jsonl` / `task-state-index.json` / `snapshot` 后写者赢，前者的动作事实丢失）。

2026-11-20/21 已经用真实事故验证过代价：AF-209 与另一台机器的任务同号、AF-211 二次同号、AF-210 归档后无法提交只能补开 AF-212。三条都是机制缺口，不是操作失误。

## 2. 远端单写者（跨机 CAS）

**锁位置**：GitHub 上的 `refs/heads/orchestration-lock`。运行期的分支列表会短暂多出这一个短命分支，属预期现象；CI 只在 `master` / `integrate` 的 push 与 `integrate` 的 PR 上触发，不会因它跑流水线。持锁期间懒创建、释放即删除（`--force-with-lease` 读旧 sha 后条件删除），空闲时该 ref 不存在。

> 为什么不放 `refs/orchestration/locks/*`：非 `refs/heads/` 的 ref 部分环境 `git fetch` 取不到，而读 payload 依赖 fetch，实测会退化成"读不到 = 判 corrupt = 不释放"。放在 `refs/heads/` 下换取可靠性是刻意取舍。

**为什么能用**：git ref 的远端更新是原子的。两个机器同时推同一个**不存在**的 ref，只有一个成功，另一个被服务端以非 fast-forward 拒绝。这等价于一次 CAS，不需要 Redis、不需要外部锁服务。

**协议**：

| 步骤     | 动作                                                                                                               | 说明                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 读锁     | `git ls-remote origin refs/heads/orchestration-lock`                                                               | 拿 sha；空 = 没人持锁                                                                                   |
| 读持有者 | ① 本地对象 `git cat-file -p <sha>`；② 映射到本地缓存 ref 再 `git log -1 --format=%B`；③ 按 sha fetch 后 `cat-file` | 三路从零网络到有网络依次兜底；commit message 是 JSON：host / pid / token / actor / acquiredAt / baseSha |
| 抢锁     | `git commit-tree HEAD^{tree} -m <payload>` → `git push origin <sha>:<ref>`                                         | root commit（无 parent）避免伪造历史行；push 成功即持锁，已存在则被拒                                   |
| 释放     | 先读回 payload 比对 token，一致才 `git push origin --delete <ref>`                                                 | 不误删他人锁；释放失败只告警不阻断（锁会在 stale 阈值后自愈）                                           |
| 陈旧     | `acquiredAt` 超过 45 min（与本地锁同阈值）                                                                         | 删 ref 后重抢，日志保留 `stolen` 事实                                                                   |

**接入方式**：`run-once` / `watch` 通过 `acquireClusterRunLock` 先抢本机文件锁，再抢远端 ref。顺序固定，理由是：同机并发不打扰远端，避免无意义 push。

**降级与拒绝**：

| `ORCH_REMOTE_LOCK` | 远端不可达时                                   | 适用                           |
| ------------------ | ---------------------------------------------- | ------------------------------ |
| `required`         | 拒绝执行本轮（exit 非 0）                      | 有并行机器时的默认推荐值       |
| 缺省 / `optional`  | 降级为仅本机互斥，**日志与 status 都打印告警** | 单机、或临时断网               |
| `0` / `off`        | 不启用远端锁                                   | 离线调试专用，禁止在并行期使用 |

`status` 的「运行健康」段单独一行打印远端锁：`空闲` / `运行中（host… 已持 N 分钟）` / `不可读（…）`。**不可读不等于空闲**，这一条是刻意的：把网络问题伪装成空闲，比直接报错更危险。

**生效前提**：两台机器都必须先合入本机制，锁才会有第二个参与者。只在一台机器上升级，远端锁仍然只有单边参与，等于没有互斥。

## 3. 编号占用检查与远端占号（三源 + 预约）

`task register` 在登记前合并以下来源：

| 源           | 读法                                                                            | 覆盖                   |
| ------------ | ------------------------------------------------------------------------------- | ---------------------- |
| 远端任务分支 | `git ls-remote --heads origin 'task/*'` 解析分支名内 `AF-NNN`                   | 对方正在开发、尚未合并 |
| 远端索引     | `git show origin/integrate:docs/team/agent-orchestration/task-state-index.json` | 对方已合入             |
| 本地         | 状态索引 + `docs/worklog/records/**` 目录名                                     | 本机历史与归档         |
| 远端占号 ref | `git ls-remote --heads origin 'orchestration-task-ids/*'`                       | 已 CAS 预约、尚未登记  |

命中即拒绝登记，并给出下一个可用编号。

### 3.1 取号先 CAS 预约（AF-223）

三源只能「事后发现」：两台机器同时问 `next-id` 会拿到同一个号，谁先登记谁赢，输的一方白做一遍。因此取号改成两段：

```bash
pnpm orchestration:task next-id            # 只读建议，不占号
pnpm orchestration:task next-id --reserve  # 算候选 → 远端创建占号 ref → 抢不到自动顺延
```

- 占号 ref：`refs/heads/orchestration-task-ids/<AF-NNN>`，payload（`taskId` / `host` / `pid` / `actor` / `token` / `reservedAt` / `baseSha`）写在 root commit 的 message 里；
- 抢占用的是 `git push` 的非快进语义（ref 已存在即失败），与远端单写者锁同一套技术，不需要额外凭据；
- 顺延上限 20 次，每次失败都把该号并入占用集再算下一个；远端不可达时**不给号**（exit 非 0），只打印只读建议并明确提示不要据此登记；
- 归档后清理：`pnpm orchestration:task release-id --taskId AF-NNN`。占号 ref 只承担「登记前仲裁」，长期占用会让远端 ref 无界增长；释放失败不阻塞归档。

### 3.2 重建同一任务时排除自身分支（AF-223）

AF-222 实施时踩到：任务号被**本机自己**已推送的 `task/AF-221-*` 分支占用，重建必须换号。这是纯摩擦——真正防并发的是占号 ref。

`task register` 现在会把「当前分支就是 `task/<taskId>-*`」的那一条从远端分支源里排除：

- 被排除的编号记入 `sources.excludedRemoteBranches`，只在它**没有出现在任何其它源**时记为 `selfOnlyIds`；
- `assertTaskIdAvailable` 对 `selfOnlyIds` 放行，reason `self-branch-only`，并在输出写明「仅本机同名分支占用，按重建放行（并发由远端占号 ref 仲裁）」；
- 若该号同时出现在远端索引或占号 ref 里，照旧拒绝——排除只对本机那条分支生效，不会把别人的占用一起放过。

**编号不复用**：`canceled`、`rejected` 的号段保留（records 目录里的墓碑就是证据）。复用会让事件链出现「同号两段历史」，排障成本远高于省下一个号。

远端不可达时只打印 warning 并跳过远端源，不阻塞离线登记——离线时你本来也无法与对方并行。

## 4. 归档前置（实现必须已提交）

`processReceipts` 在 `archive-completed` 之前调用注入的 `checkUncommitted(task)`：

- 返回非空 → **不归档**，任务保持 in-flight，状态面写 `escalation.waiting`，动作 `archive-blocked-uncommitted` 携带文件清单；
- 返回空 → 照常归档；
- 未注入 → 行为不变（既有单测与离线调用不受影响）。

探测口径：`git diff --name-only HEAD -- <scope.files>`（含已暂存，**不含未跟踪文件**）。未跟踪文件不计入是有意为之：编排目录经常有临时产物；真正的实现文件在提交时必须被 `git add`，否则 CI 的逐提交门会拦。

这条直接消灭「先归档、后提交」的顺序错误：归档前先问一句「实现进库了吗」。

### 4.1 两阶段提交与逐提交门（AF-222 批次子项 04）

归档前置解决的是「实现没进库就归档」，但它把提交切成了两段：**实现提交**只带业务文件与记录包任务单，**状态面提交**才带 claim 之后生成的索引。CI 的逐提交门读的是「该提交自身的树内索引」，于是实现提交那一刻的索引里根本还没有这个任务，多次实证（迁移前后各有一轮，编号见 AF-222 回执 backlog）全部被判 `no-active-task`——规范与门禁自相矛盾。

AF-222 子项 04 的解法是给逐提交门一条**受限入场**，而不是把索引塞进实现提交：

| 入场条件（全部满足）                                                             | 说明                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 标题能解析出唯一任务编号                                                         | 大小写不敏感，`docs(af219)` 等价 `feat(AF-219)`；`utf-8`、`Phase2` 这类技术串不计入 |
| 该提交 diff 内**新增**了 `docs/worklog/records/<context>/<taskId>/task-sheet.md` | 任务单必须随实现一起进库，按提交内文本重建 scope                                    |
| 该任务在提交索引与父索引中都不存在                                               | 已有则走原判定，不重复入场                                                          |

入场后一律沿用同一套 scope 判定：越界照旧 `scope-residual` 判红，交付记录按任务单 `artifacts` 声明豁免，`records/` 与状态面按 `STATE_PLANE_PATHS` 豁免。缺任一条件（任务单不在提交内、taskId 与标题不符、scope 解析失败）→ 仍判 `no-active-task`，验收门 `evaluateAcceptanceSnapshot` 未做任何放宽。

对应口径变化：**提交标题的任务编号大小写不再影响解析**，`docs(af219)` 与 `feat(AF-219)` 等价；但一条标题里出现两个不同编号仍 fail closed。

## 5. 运维口径（照做即可）

1. **开工**：`git fetch origin` → `pnpm orchestration:status` 确认远端锁空闲、队列无在办。
2. **取号**：`pnpm orchestration:task next-id --reserve`（拿到的是已经抢下的号），再写任务单。
3. **跑编排**：`ORCH_REMOTE_LOCK=required pnpm orchestration:run`。被锁挡住就是被挡住，不要换机器抢。
4. **实现**：在任务分支上做；提交信息带任务号（大小写均可，`AF-NNN` 与 `afnnn` 等价归一，见 §4.1）。
5. **收尾**：提交实现 → 写回执 → `run-once`（此刻才会归档）→ 状态面单独提交 → PR squash。
6. **推送失败**：`git push` 被拒说明对方已更新 `integrate`；放弃本轮本地状态面、重新 fetch 后再跑一轮 `run-once` 重建，**不要合并事件文件**。
7. **合并后清账**：`pnpm orchestration:task release-id --taskId AF-NNN` 释放占号 ref；忘了也不阻塞，下一个号仍能取到。

## 6. 已知边界

- 远端锁释放仍是「读—比对—删」，存在极小窗口的理论竞态（读后对方抢到、本方删掉）。概率极低且后果是「两个同时跑一轮」，与本地锁自愈同级别；若要彻底闭环需要服务端条件删除，超出本仓能力范围。
- 占号 ref 同样有「读—创建」两步：`ls-remote` 判定不存在与 `push` 之间若被对方插入，push 会失败并顺延，不会双占——这条比其他「先读后写」安全，因为真正的判定落在 push 本身。
- 占号 ref 只对「登记前」有效；登记完成后由索引与 records 接管占用。若某台机器长期不释放，远端 ref 会持续增长（每个号一个 ref），用 `task release-id` 收尾，或用 `git ls-remote --heads origin 'orchestration-task-ids/*'` 盘点残号。
- 编号检查看不到「对方本地已登记但未推送」的任务单。因此规则仍是：**登记后立即提交并推送**，别把号攥在手里。
- 未跟踪文件不计入归档前置（见 §4）。
- 本机制只覆盖 `run-once` / `watch`；手工直接改状态索引仍会破坏状态面，属于禁止操作。
