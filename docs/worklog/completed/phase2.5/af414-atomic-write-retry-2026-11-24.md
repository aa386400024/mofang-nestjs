# AF-414 调试会话原子写 Windows 瞬时占用重试 — 交付记录

- 日期：2026-11-24
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-414/task-sheet.md`
- 基线：`6a3cdec63d19965023a3e67e45e3c4b8d456e1a2`
- 角色：executor

## 一、问题现象

AF-412 推送分支时，pre-push 全量测试出现一次 flaky：

```text
test/admin-debug/debug-session-persistence.spec.ts:576
waitFor 超时: 条件在 10000ms 内没成立
```

用例语义是「关闭会话 → 文件状态应变为 completed」。`closeSession` 同步返回，`store.markCompleted` 是 fire-and-forget（`void ... .catch(...)`）；存储层的原子写是「写 `.tmp` 再 `rename`」。在 316 个 worker 并行、Windows 文件系统高负载时，`rename` 可能命中目标文件被短暂占用（杀毒扫描、并发读句柄未释放），抛出 `EPERM / EACCES / EBUSY / ENOTEMPTY`。写失败被 `.catch` 吞掉，状态永远停在 `active`，测试 10 秒轮询自然超时。

## 二、改动

### 2.1 `src/admin-debug/debug-session-store.ts`

- 新增 `RENAME_RETRY_CODES`：`EPERM / EACCES / EBUSY / ENOTEMPTY`。
- 新增 `isRetryableRenameError(error)`：按 `error.code` 判定是否值得重试；无 code、`ENOENT`、`EXDEV` 等返回 false。
- 新增 `renameWithRetry(temp, target, options)`：默认 3 次尝试、基础退避 10ms、指数退避（10 / 20ms）；`renameFn` 与 `sleepFn` 可注入，单测不碰真实文件系统。非瞬时错误立即抛出，重试耗尽抛最后一次错误。
- `writeRecord` 的 `rename` 改为 `renameWithRetry`；存储格式、目录结构、API 语义均不变。

### 2.2 `test/admin-debug/af414-atomic-write-retry.spec.ts`

5 条用例：可重试码识别；首次成功只 rename 一次；两次 EPERM 后成功且退避 10 / 20ms；重试耗尽抛最后一次错误；非瞬时错误立即抛出且不 sleep。

## 三、设计取舍

1. **只重试瞬时占用码，不重试所有错误**：`ENOENT`（临时文件被外部清掉）与 `EXDEV`（跨设备）重试没有意义，立即抛可以让调用方感知真实故障。
2. **退避上限 70ms 总量**：这是给「句柄释放 / 扫描结束」留的窗口；更长的锁说明系统异常，继续等会拖住整个会话写队列。
3. **不做无限重试、不 sleep 到测试超时**：写队列是串行的，长退避会阻塞该会话后续所有写；有限重试把最坏延迟可控在 70ms。
4. **不改 `closeSession` 的 fire-and-forget 语义**：改成 await 会改变接口时延与调用方契约，超出本单范围；失败仍由 `.catch` 记录，但重试显著降低丢失概率。剩余风险登记为遗留项。

## 四、闸门与实测数字

| 闸门     | 命令                                                                                                                        | 结果                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 定向单测 | `pnpm exec vitest run test/admin-debug/af414-atomic-write-retry.spec.ts test/admin-debug/debug-session-persistence.spec.ts` | 2 文件 / 33 用例全绿（新增 5 + 既有 28），3.58s |
| Lint     | `pnpm lint`                                                                                                                 | 0 error；仅 pnpm `node>=26` engine warning      |
| 类型     | `pnpm typecheck`                                                                                                            | 0 error                                         |
| 内核边界 | `git diff --stat HEAD -- src/engine-core`                                                                                   | 空                                              |

全量测试在交付前跑一次，数字以当次输出为准（见回执 `gateResults`）。

## 五、偏差

- 任务编号：原登记 AF-413（`agentRole: orchestrator`），调度器判 `scope-domain-conflict`——orchestrator 资源域不含 `src/` 与 `test/`。按「角色域错误 → 取消并重登」的既有处置，AF-413 已取消，重登为 AF-414（`agentRole: executor`），任务内容不变。任务单 §前序说明已写明。
- 交付记录文件名按登记值 `af414-atomic-write-retry-2026-11-24.md`，与任务编号一致，无 AF-412 式命名偏差。

## 六、遗留

- `closeSession` 仍为 fire-and-forget：即使重试耗尽，调用方也拿不到失败信号，状态可能停在 `active`。要彻底闭环需让服务层等待写完成或暴露关闭结果，属于接口语义变更，另立项。
- 退避窗口 70ms 对极端杀毒锁可能仍不足；如线上出现，应结合 `debug_store` 告警计数再评估是否扩大窗口或改为异步补偿。
