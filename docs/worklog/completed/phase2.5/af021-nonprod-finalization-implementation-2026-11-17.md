# AF-021 · 非生产收尾交付记录（2026-11-17）

> 关联任务单：[af021-nonprod-finalization-task-2026-11-17.md](af021-nonprod-finalization-task-2026-11-17.md)
> 分支：`integrate`；基线：`540cf44`
> 范围：CI 再提速、`master` 保护、journal 分段归档、`archived` 语义、IM-034；生产部署排除

## 1. 交付摘要

| 项              | 落地                                                                                                              | 关键口径                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Docker 构建缓存 | `build` 改 `docker/build-push-action@v7`，`cache-from/to: type=gha`，`load: true` 保留本地镜像                    | 首次运行填缓存，二次运行命中；镜像大小检查仍在                                                              |
| Coverage 分片   | `coverage-shards` matrix 2 片采集，`coverage-gate` 下载 blob 后 `vitest --merge-reports` 统一跑阈值               | 分片只采集、不在局部报告上判阈值；job 名与保护 contexts 一致                                                |
| TypeScript 增量 | `tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo` + cache | 保留原全量 `tsconfig.json` 口径，未另造 composite                                                           |
| `master` 保护   | classic protection：strict、10 项必需检查、`enforce_admins`、禁 force push/删除、要求会话解决                     | personal repo 的 ruleset 不允许 Actions 作 bypass actor（422）；保留 Release `GITHUB_TOKEN` 直推，未强制 PR |
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

| 闸门               | 命令                                                        | 结果                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量单测           | `pnpm test`（Node 26）                                      | **201 passed / 1 skipped（202 文件）**；**3509 passed / 8 skipped（3517 例）**；23.79s；exit 0                                                                                   |
| Lint               | `pnpm lint`                                                 | exit 0；0 error / 0 warning                                                                                                                                                      |
| Typecheck          | `tsc --noEmit -p tsconfig.json --incremental ...`           | exit 0；冷跑 18s / 热跑 6.9s（本地）                                                                                                                                             |
| Coverage 分片+合并 | 本地按 CI 命令跑 2 片（阈值清零）+ `vitest --merge-reports` | `SHARD1=0 SHARD2=0 MERGE=0`；三阶段合计 **63.9s**；合并覆盖 **48.31% stmts / 47.07% branch / 44.25% funcs / 48.09% lines**，四阈值（44/43/40/44）全过；生成 `coverage/lcov.info` |
| CI YAML            | `python -c "yaml.safe_load(...)"`                           | `jobs=contracts,lint-and-typecheck,unit,e2e,coverage-shards,coverage-gate,build,security-audit`；唯一 `needs=coverage-gate → coverage-shards`                                    |

### 2.5 `master` 保护现状

`PUT /repos/aa386400024/mofang-nestjs/branches/master/protection` 已生效：

- `required_status_checks.strict=true`，10 个 contexts：`Contracts (framework 2.0.0)`、`Lint + Typecheck`、`Unit (shard 1/2)`、`Unit (shard 2/2)`、`E2E`、`Coverage (shard 1/2)`、`Coverage (shard 2/2)`、`Coverage Gate`、`Build (Docker)`、`Security Audit`
- `enforce_admins=true`
- `allow_force_pushes=false`、`allow_deletions=false`
- `required_conversation_resolution=true`
- `required_pull_request_reviews=null`：保留 Release 直推通道，属于单人仓明确取舍

## 3. 偏差与取舍

1. **Coverage 分片采用 2 片**：本地演练 shard + merge 均 exit 0；分片越多，MySQL/Redis service 启动的固定成本会吃掉收益，2 片是当前规模的经验折中。
2. **TypeScript 未引入 composite 全量 tsconfig**：曾试 `tsconfig.check-all.json`，因 scripts 既有类型债 + `.mts` 导入报错放弃；保留原 `tsconfig.json` 口径，避免用“缩小检查面”换速度。
3. **未强制 PR**：要强制 PR 必须解决 Release 的 bypass 方案（PAT / Deploy Key / 改 PR 流程）；当前优先不挡自动发布。
4. **journal 只分段不合并**：合并旧事件会破坏 append-only 与哈希链审计；gzip 只压缩字节，不重写事件。

## 4. 遗留

- **新 CI run 实测待回填**：Docker 缓存二次命中、Coverage 分片+合并的实际墙钟、TypeScript 缓存命中率，需 push 后看 Actions。
- **生产部署未执行**：用户明确暂缓；首次生产前核对 `DEPLOY_HOST` / `DEPLOY_SSH_KEY` / production environment。
- **PR-only 保护**：若后续多人协作，需为 Release 配 bot bypass 或改 PR 流程后再开启。
- **归档段冷备**：当前永久留在仓内；若未来上传对象存储，必须保持文件字节与哈希链原样。
