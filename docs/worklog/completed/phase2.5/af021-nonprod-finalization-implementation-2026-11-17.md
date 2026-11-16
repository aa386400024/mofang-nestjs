# AF-021 · 非生产收尾交付记录（2026-11-17）

> 关联任务单：[af021-nonprod-finalization-task-2026-11-17.md](af021-nonprod-finalization-task-2026-11-17.md)
> 分支：`integrate`；基线：`540cf44`
> 范围：CI 再提速、`master` 保护、journal 分段归档、`archived` 语义、IM-034；生产部署排除

## 1. 交付摘要

| 项              | 落地                                                                                                              | 关键口径                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Docker 构建缓存 | `build` 改 `docker/build-push-action@v7`，`cache-from/to: type=gha`，`load: true` 保留本地镜像                    | 源码不变时热命中约 24s；`package.json` 变更会失效依赖层，属预期                                             |
| Coverage 分片   | `coverage-shards` matrix 3 片采集，`coverage-gate` 下载 blob 后 `vitest --merge-reports` 统一跑阈值               | 分片只采集、不在局部报告上判阈值；job 名与保护 contexts 一致                                                |
| TypeScript 增量 | `tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo` + cache | 保留原全量 `tsconfig.json` 口径，未另造 composite；CI 热命中 5s                                             |
| ESLint 缓存     | `lint` / `lint:fix` 加 `--cache-strategy content`，缓存键绑定 ESLint 配置与 tsconfig 指纹                         | 解决 CI checkout 后 mtime 全变导致“缓存命中仍全量扫描”；CI 热跑 Lint 3s                                     |
| pnpm 缓存       | 显式 `pnpm config set store-dir ~/.pnpm-store`，所有装依赖 job 共用 store 缓存                                    | pnpm 9 实际 store 与旧缓存路径不一致；修正后 CI 安装依赖 3-4s                                               |
| `master` 保护   | classic protection：strict、12 项必需检查、`enforce_admins`、禁 force push/删除、要求会话解决                     | personal repo 的 ruleset 不允许 Actions 作 bypass actor（422）；保留 Release `GITHUB_TOKEN` 直推，未强制 PR |
| journal 保留    | `events rotate` 分段 + 可选 gzip；`loadJournal` 读归档段 + 活动段，按首事件序号排序                               | 事件逐字保留；跨段 `eventSeq` / `prevHash` / `hash` 连续；归档段只读、永久保留                              |
| `archived` 语义 | 投影落事件前 `rec.status`（必须终态），不再用 `to` 改写；scheduler / deriveEvents 先补齐合法迁移链                | 对齐框架 `state_projection.py`；非终态归档被前置拒绝                                                        |
| IM-034          | `DebugSessionService.awaitPendingTitleGeneration()` 登记并 drain fire-and-forget 标题任务；WP38 ③ 改 await        | 删除 30s 固定轮询，时序由被测对象决定                                                                       |

## 2. 证据

### 2.1 journal 轮转与完整性

命令：

```powershell
node scripts/orchestration/cli.mjs events verify
node scripts/orchestration/cli.mjs events rotate --max-events 50 --compress
node scripts/orchestration/cli.mjs events verify
node scripts/orchestration/cli.mjs events rebuild
node scripts/orchestration/cli.mjs events verify
```

结果：

- 轮转前：`[PASS] 事件日志 74 条；schema urn:...:state-event:1.0.0；哈希链与索引投影一致`
- 轮转：`74 条（EV-1 → EV-74）→ state/journal-archive/journal-000001-000074.jsonl.gz`，活动日志重建为空
- 轮转后 `verify`：`74 条`，哈希链与投影一致
- `rebuild`：任务 0、归档 37、末条事件 74；再 `verify` 仍 PASS
- 归档段体积：`6 489 B`（原始 74 行约 25 KB 级）；事件正文未改
- 追加 AF-021 建档 + 归档 2 条事件后：`[PASS] 事件日志 76 条`，新活动日志首条 `eventSeq=75` 的 `prevHash` 正确指向前段 `EV-74` 的 `hash`，证明跨段链连续；索引归档 38 条 / 说明 13 条 / `lastEventSeq=76`

### 2.2 归档语义与调度闭合

- `scripts/orchestration/__tests__/orchestration.spec.mjs`：`136 passed / 0 failed`；新增断言覆盖
  - 已终态任务归档保持 `from=to`；
  - 非终态 `working` 归档为 `completed` 时，派生 `submitted → verified → archived`，归档事件 `from=completed`。
- 现有 74 条历史事件全部为终态归档，投影不变。

### 2.3 IM-034 / WP38

```powershell
pnpm exec vitest run test/admin-debug/wp38-debug-session-resume.spec.ts
```

`10 passed / 0 failed`，约 2.2s；全量收尾闸门下不再出现 30s 超时。

### 2.4 收尾闸门

| 闸门               | 命令                                                        | 结果                                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量单测           | `pnpm test`（Node 26）                                      | **201 passed / 1 skipped（202 文件）**；**3509 passed / 8 skipped（3517 例）**；23.79s；exit 0                                                                                                                                      |
| Lint               | `pnpm lint`（`--cache-strategy content`）                   | exit 0；0 error / 0 warning；冷跑 176.4s，热跑 6.2s，改 mtime 后 4.1s                                                                                                                                                               |
| Typecheck          | `tsc --noEmit -p tsconfig.json --incremental ...`           | exit 0；本地冷跑 18s / 热跑 6.9s；CI 热跑 5s                                                                                                                                                                                        |
| Coverage 3 片+合并 | 本地按 CI 命令跑 3 片（阈值清零）+ `vitest --merge-reports` | `SHARD1=0 SHARD2=0 SHARD3=0 MERGE=0`；采集 23.9/20.6/29.4s + 合并 5.7s；合并覆盖 **48.31% stmts / 47.07% branch / 44.25% funcs / 48.09% lines**，四阈值（44/43/40/44）全过；CI 合并值为 **48.31 / 47.37 / 44.25 / 48.09**，同样全过 |
| CI YAML            | `python -c "yaml.safe_load(...)"`                           | `jobs=contracts,lint-and-typecheck,unit,e2e,coverage-shards,coverage-gate,build,security-audit`；`unit` 与 `coverage-shards` 均为 `shard=[1,2,3], count=[3]`；唯一 `needs=coverage-gate → coverage-shards`                          |

### 2.5 CI 实测（真实 Actions）

| run / attempt                                                                          | head      | 结果       | 墙钟     | 关键事实                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | --------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`43914732719`](https://github.com/aa386400024/mofang-nestjs/actions/runs/43914732719) | `cd80348` | ❌ failure | 239s     | Coverage 两片测试已跑完、blob 已写出，但 `upload-artifact` 报 `No files were found ... .vitest-reports`；根因是隐藏目录默认被排除，`Coverage Gate` 因 needs 失败 skipped |
| [`43915822192`](https://github.com/aa386400024/mofang-nestjs/actions/runs/43915822192) | `b63c0e8` | ✅ success | **130s** | 补 `include-hidden-files: true` 后 10/10 全绿；Docker 热缓存 42s，Lint 111s（ESLint 缓存命中但 mtime 失效），Coverage 2 片+Gate 正常                                     |
| `43918327585` attempt 1                                                                | `ef98b7e` | ✅ success | 227s     | 12/12 全绿；`package.json` 变更使 Docker 依赖层失效，Docker 196s；ESLint 新缓存键冷跑 132s；Coverage shard 2 container init 47s                                          |
| `43918327585` attempt 2                                                                | `ef98b7e` | ✅ success | **111s** | 12/12 全绿：Lint 3s、Typecheck 5s、Docker build 24s、依赖安装 3s、Coverage 三片测试 18-22s + Gate 22s；稳态墙钟 **111s**                                                 |

- 提速链：改造前样本 `43903474717` 约 **358s** → 8 作业 `43908742889` **129s** / `43909525240` **133s** → 本轮稳态 **111s**。
- Coverage Gate 合并值以 CI 日志为准：`All files | 48.31 | 47.37 | 44.25 | 48.09`，四阈值全过。
- 第三轮 attempt 2 是同一 SHA 重跑，用于验证缓存热态；没有新增代码改动。

### 2.6 `master` 保护现状

`PUT /repos/aa386400024/mofang-nestjs/branches/master/protection` 已生效：

- `required_status_checks.strict=true`，12 个 contexts：`Contracts (framework 2.0.0)`、`Lint + Typecheck`、`Unit (shard 1/3)`、`Unit (shard 2/3)`、`Unit (shard 3/3)`、`E2E`、`Coverage (shard 1/3)`、`Coverage (shard 2/3)`、`Coverage (shard 3/3)`、`Coverage Gate`、`Build (Docker)`、`Security Audit`
- `enforce_admins=true`
- `allow_force_pushes=false`、`allow_deletions=false`
- `required_conversation_resolution=true`
- `required_pull_request_reviews=null`：保留 Release 直推通道，属于单人仓明确取舍

## 3. 偏差与取舍

1. **Coverage 分片采用 3 片**：本地 3 片采集 23.9 / 20.6 / 29.4s，CI 三片测试 18-22s；相比 2 片的 36s 长尾更短。代价是 MySQL/Redis service 固定启动成本 × 3，因此不继续加到 4 片。
2. **ESLint 缓存必须用 content 策略**：CI checkout 会重写所有文件 mtime，旧 mtime 缓存虽能 restore，但 ESLint 判定全部文件变更，仍全量扫描；`--cache-strategy content` 后 CI 热跑 Lint 3s。缓存键继续绑定 `tsconfig` 指纹，避免 type-aware 结论过期。
3. **pnpm store 路径必须显式固定**：pnpm 9 在 Linux 实际 store 不是 `~/.pnpm-store`，旧缓存路径长期为空；固定后 CI 安装依赖 3-4s（此前 10-12s）。
4. **TypeScript 未引入 composite 全量 tsconfig**：曾试 `tsconfig.check-all.json`，因 scripts 既有类型债 + `.mts` 导入报错放弃；保留原 `tsconfig.json` 口径，避免用“缩小检查面”换速度。
5. **未强制 PR**：要强制 PR 必须解决 Release 的 bypass 方案（PAT / Deploy Key / 改 PR 流程）；当前优先不挡自动发布。
6. **journal 只分段不合并**：合并旧事件会破坏 append-only 与哈希链审计；gzip 只压缩字节，不重写事件。

## 4. 遗留

- **CI 实测已收口**：`43915822192` 首轮修复后 10/10、130s；`43918327585` attempt 2 稳态 12/12、111s；Coverage Gate 合并阈值全过。
- **生产部署未执行**：用户明确暂缓；首次生产前核对 `DEPLOY_HOST` / `DEPLOY_SSH_KEY` / production environment。
- **PR-only 保护**：若后续多人协作，需为 Release 配 bot bypass 或改 PR 流程后再开启。
- **归档段冷备**：当前永久留在仓内；若未来上传对象存储，必须保持文件字节与哈希链原样。
