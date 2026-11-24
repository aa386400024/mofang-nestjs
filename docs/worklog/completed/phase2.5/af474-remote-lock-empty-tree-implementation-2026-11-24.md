# AF-474 交付记录：远端锁与任务取号 commit 改空 tree

- 任务：`AF-474`（`contextId=phase2.5-orchestration-closed-loop`）
- 分支：`task/AF-474-remote-lock-empty-tree`
- 基线：`9445fb32403671a9eb89a815e91cf522d8cf29ba`
- 日期：2026-11-24

## 1. 改了什么

| 文件                                                           | 改动                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/remote-lock.mjs`                        | `defaultRunGit` 支持 `opts.input`；抢锁 commit 从 `rev-parse HEAD^{tree}` 改为 `mktree` 空输入生成空 tree。 |
| `scripts/orchestration/task-id-reservation.mjs`                | 同一修复：占号 commit 改用空 tree；`defaultRunGit` 支持 stdin。                                             |
| `scripts/orchestration/__tests__/remote-lock.spec.mjs`         | fake git 增加 `mktree`；commit 记录 tree；新增“空 tree、不读 HEAD 整树”用例。                               |
| `scripts/orchestration/__tests__/task-id-reservation.spec.mjs` | fake object 形状改为 `{message, tree}`；新增占号空 tree 用例。                                              |

锁 ref 名 `refs/heads/orchestration-lock`、占号前缀 `refs/heads/orchestration-task-ids/<ID>`、45 分钟陈旧阈值、payload 字段和释放比对逻辑均未改。

## 2. 关键设计

原实现：

```text
git rev-parse HEAD^{tree} -> git commit-tree <HEAD tree> -m <payload> -> git push <sha>:<ref>
```

锁/占号只需要 commit message 里的 payload，tree 内容没有语义。指向 HEAD 整树时，`git push` 会把整棵 HEAD tree 可达的对象一起打包；仓库对象多时枚举/压缩很慢，表现为 AF-471 的 push 长时间挂起。

修复后：

```text
git mktree <empty stdin> -> git commit-tree <empty tree> -m <payload> -> git push <sha>:<ref>
```

空 tree 用 `git mktree` 现算，不硬编码 `4b825dc642cb6eb9a060e54bf8d69288fbee4904`，避免 SHA-256 仓库不兼容。root commit 无父、message payload、远端 ref CAS 语义全部保持。

## 3. 验证

### 3.1 单测

```powershell
pnpm exec vitest run scripts/orchestration/__tests__/remote-lock.spec.mjs scripts/orchestration/__tests__/task-id-reservation.spec.mjs
```

结果：`2 passed`，`16 tests passed`；新增两条断言分别覆盖锁与占号：

- commit 的 tree 是 `empty-tree`；
- 未调用 `rev-parse`；
- `mktree` 收到的 stdin 是空字符串。

### 3.2 真实 git 空 tree

```powershell
node -e "const {execFileSync}=require('node:child_process'); const t=execFileSync('git',['mktree'],{input:'',encoding:'utf8'}).trim(); console.log(t, execFileSync('git',['cat-file','-t',t],{encoding:'utf8'}).trim())"
```

结果：`4b825dc642cb6eb9a060e54bf8d69288fbee4904 tree`。

### 3.3 真实远端抢锁

```powershell
node -e "import('./scripts/orchestration/remote-lock.mjs').then(async m=>{const lock=m.createGitRemoteLock(); const t0=Date.now(); const r=lock.acquire({actor:'AF-474-live-check',token:'af474-check'}); console.log(JSON.stringify({acquired:r.acquired,sha:r.sha,ms:Date.now()-t0})); if(r.acquired) console.log('release',r.release());})"
```

结果：`{"acquired":true,"sha":"4c579817594ddd7bf72007dd880dc353febf689f","ms":4567}`，`release true`。远端锁 ref 已删除，未留残留。

AF-471 当时同一路径的 `git push` 在子进程中长时间挂起；本轮同一命令 4.6 秒完成（含 `ls-remote`、`mktree`、`commit-tree`、push、release 读取与删除）。

### 3.4 收尾闸门

| 闸门                                      | 结果            |
| ----------------------------------------- | --------------- |
| `pnpm lint`                               | exit 0，0 error |
| `pnpm typecheck`                          | exit 0，0 error |
| `git diff --stat HEAD -- src/engine-core` | 空              |
| 单测                                      | 16 passed       |

## 4. 偏差与限制

- 没有做“旧实现 vs 新实现”的同一仓库 push 对象数量对比；旧实现正是会挂起的那条路径，重复跑会再次阻塞。以 AF-471 的挂起事实、空树语义和本轮 4.6 秒实跑作为证据。
- 实际推送耗时仍受网络影响；本任务只保证不再打包 HEAD 整棵树，不承诺固定毫秒数。
- 未改 `run-once` 调用方，未引入旁路开关；锁的 CAS/陈旧/释放语义未变。

## 5. 后续

- AF-471 回执中的 `AF471-B1` 可由本任务关闭。
- 语域成本评测的测量修复另登 `AF-475`，不在本任务混提。
