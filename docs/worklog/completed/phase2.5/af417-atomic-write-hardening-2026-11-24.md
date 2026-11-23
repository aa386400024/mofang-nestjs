# AF-417 交付记录：调试会话原子写硬化

- 任务：AF-417（承接 AF-416）
- 基线：`d259db7bc4e48b64ce478fe718098bb008157000`
- 分支：`task/AF-417-atomic-write-hardening`
- 日期：2026-11-24

## 一、为什么有 AF-416 / AF-417 两次登记

AF-414 合并后，MiniMax Code 的只读评审指出三处真实缺口：固定 `${target}.tmp` 跨进程覆盖、`writeFile` 未纳入重试、`get()` 读带写绕过写队列。AF-416 据此登记并完成实现，但全量测试的 WP25 契约要求代码读取的每个 env 键必须在 `.env.example` 有生效行，而 AF-416 的 scope 不含 `.env.example`，闸门红。

按仓库纪律，进入实现阶段的任务不允许 rescope（`task rescope` 只接受 backlog / ready）。因此取消 AF-416（保留任务单与 tombstone），重登 AF-417 并把 `.env.example` 纳入 scope。代码、测试、文档改动由 AF-417 承接，AF-416 分支未产生实现提交。

## 二、改动清单

### 2.1 新增 `src/admin-debug/atomic-write.ts`（原子写原语）

- `RETRYABLE_FS_CODES`：`EPERM / EACCES / EBUSY / ENOTEMPTY`，由 rename 与 writeFile 共用。
- `uniqueTempPath(target)`：`${target}.${pid}.${8位随机}.tmp`，同目录、跨进程唯一。
- `withFsRetry(operation, policy)`：默认 3 次尝试、10ms 基数、指数退避；非瞬时错误立即抛；耗尽后把 `retried` / `attempts` 附在原始错误上，不改 `code`。
- `renameWithRetry` / `writeFileWithRetry`：同一外壳；writeFile 固定 `wx`（临时名唯一后仍拒绝覆盖，撞名应暴露）。
- `cleanupTempFile`：best effort 删除自己的临时文件，不覆盖原错误。

### 2.2 `src/admin-debug/debug-session-store.ts`

- 删除本地重试实现，改为从 `atomic-write.ts` 导入；历史导出位保留同名 re-export（`RENAME_RETRY_CODES` / `isRetryableRenameError` / `renameWithRetry`），AF-414 既有导入不被破坏。
- `writeRecord`：唯一临时路径 → `writeFileWithRetry` → `renameWithRetry` → `finally` 清理临时文件。
- `get()`：远端命中后回填改走 `enqueue`，并在队列内重新读本地，只有 `shouldBackfillLocal(local, remote)` 为真才写；本地更新或时间相同不写，避免把新内容覆盖回旧远端快照。
- 新增 env 解析 `resolveWriteRetryPolicy`：`ADMIN_DEBUG_RENAME_RETRY_ATTEMPTS`（夹 1..10）、`ADMIN_DEBUG_RENAME_RETRY_BASE_DELAY_MS`（夹 0..1000），非法值回落 3 / 10ms；装配期解析一次。
- 文件头验证命令从裸 `npx` 改为 `pnpm exec`（MiniMax 评审 §2.1）。

### 2.3 `.env.example`

- 登记两个新 env 键与夹取范围，通过 WP25 「代码读的键必须有生效行」契约。

### 2.4 测试 `test/admin-debug/af414-atomic-write-retry.spec.ts`

原 5 例保留，新增 8 例：

1. writeFile 与 rename 共用同一份可重试码；
2. 混合错误序列（EPERM → ENOENT）只重试一次后立即放弃；
3. `attempts=5` 退避序列 `[10,20,40,80]`，耗尽标记 `attempts:5, retried:true`；
4. `attempts=0` 收敛为 1 次、`baseDelay=0` 不等待，标记 `attempts:1, retried:false`；
5. 唯一临时名：两次不同、含 pid、`.tmp` 后缀、与目标同前缀；
6. `writeFileWithRetry` 重试 EPERM 后成功，且两次都以 `wx` 写入；
7. `cleanupTempFile` 对不存在文件不抛错；
8. `shouldBackfillLocal` 四象限（缺失 / 远端新 / 相同 / 本地新）。

### 2.5 文档勘误

`docs/worklog/completed/phase2.5/af414-atomic-write-retry-2026-11-24.md`：

- 「退避上限 70ms」勘误为 30ms（3 次尝试只有 2 次 sleep = 10 + 20），并注明不含 rename 自身耗时；
- 遗留项补登「根因未实证」：AF-414 全链路没有捕获过 EPERM，超时也可能来自 fire-and-forget 与 10s 轮询的竞态 / 事件循环饥饿，AF-414 属预防性加固。

## 三、设计决策

1. **保留手写重试外壳，不用 Node 内建 `{ retry }`**：内建白名单不含 `EACCES`（Windows `ERROR_ACCESS_DENIED` 的常见映射），且内建选项无法注入 sleep 做退避序列断言。手写外壳可测、可观测、可 env 调参。
2. **回填不是「每次读都写」**：旧实现每次 `get()` 命中远端都全量写回，O(n²) 放大且与排队写并发。新实现只在本地缺失或远端更新时写，且整段判定 + 写都在该会话的队列里，消除竞态。
3. **耗尽错误只加标记，不改 code**：上游仍能按 `code` 分流；标记用于告警计数与后续熔断，不影响既有错误处理。
4. **临时文件唯一但不改落盘格式**：只改临时名，目标仍是 `{sessionId}.json`，目录扫描只认 `.json`，`.tmp` 不会被当成会话。
5. **env 参数装配期解析一次**：与 `resolveStoreDir` / `resolveRemoteEnabled` / `resolveMaxSessions` 的既有范式一致，不在每次写时读 env。

## 四、闸门与实测数字

| 闸门     | 命令                                                                                                                                                                      | 结果                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 定向单测 | `pnpm exec vitest run test/config/wp25-env-example-coverage.spec.ts test/admin-debug/af414-atomic-write-retry.spec.ts test/admin-debug/debug-session-persistence.spec.ts` | 3 文件 / 53 用例全绿，4.87s                                             |
| Lint     | `pnpm lint`                                                                                                                                                               | 0 error；仅 pnpm `node>=26` engine warning                              |
| 类型     | `pnpm typecheck`                                                                                                                                                          | 0 error                                                                 |
| 全量测试 | `pnpm test`                                                                                                                                                               | 317 passed / 1 skipped（文件），4806 passed / 4 skipped（用例），25.85s |
| 内核边界 | `git diff --stat HEAD -- src/engine-core`                                                                                                                                 | 空                                                                      |

全量测试在交付前跑一次，数字以当次输出为准（见回执 `gateResults`）。

## 五、偏差与遗留

### 偏差

- AF-416 → AF-417：scope 缺 `.env.example`，实现阶段不可 rescope，按 AF-413 同款处置取消后重登。任务内容一致，scope 增加 `.env.example`。
- 交付记录文件名按 AF-417 登记值，AF-416 的取消说明单独落在 `af416-atomic-write-hardening-2026-11-24.md`。

### 遗留

- **根因仍未实证**：没有构造出真实 EPERM / EACCES 场景；本单是 Windows 语义下的预防性加固。真正闭环需让 `closeSession` 可等待写完成，属接口语义变更，另立项。
- **无熔断 / 无计数器**：重试耗尽只打标记，尚无告警计数与熔断；连续失败会持续付 30ms 并堆队列。建议后续对齐 `ModelEventClassifier` 熔断范式。
- **mirror 分支无集成测试**：`get()` 回填的队列化只由 `shouldBackfillLocal` 纯函数覆盖；构造真实 MySQL mirror 成本高，未在本单引入。风险由「判定纯函数 + 队列复用」结构性约束兜底。
- **无 fsync**：原子替换不等于断电持久；Windows 不支持目录 fsync。已在代码注释与本记录如实登记，不假装具备。
- **临时文件残留**：清理是 best effort；进程被杀时可能留下唯一名 `.tmp`。目录扫描忽略它们，但长期运行建议加启动清理或定期清理任务。
