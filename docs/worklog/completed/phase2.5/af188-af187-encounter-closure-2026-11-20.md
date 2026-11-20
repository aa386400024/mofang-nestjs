# AF-188 · AF-187 交付恢复与入账

- 任务：AF-188（`phase2.5-orchestration-closed-loop`）
- 类型：fix
- 基线：`4ca4dbe5c772bccc9bf1a3c73ad0dbc4a0e49866`
- 分支：`task/AF-188-af187-encounter-closure`
- 日期：2026-11-20
- 承接：AF-187（`rejected`，租约过期，非实现失败）

## 1. 为什么要重开

AF-187 主体实现、回归与本地提交均已完成，但 `run-once` 摄回执时任务租约已过期：

- 领单 `2026-11-20T09:54:41Z`（17:54 CST）
- 回执 `2026-11-20T18:37:02+08:00`
- CLI 先 `release AF-187 (lease-expired)`，再走 late-receipt 路径，把 AF-187 闭合为 `rejected` 并归档（事件 EV-0822/0823）。

服务端 Orchestration Gate 会逐提交复核 taskId 与终态。若继续用 AF-187 的提交开 PR，会被 rejected 终态拦截。因此：

- AF-187 的 rejected 事件链、记录包、交付记录原样保留，不改状态、不伪造 completed；
- 同一批改动从基线 `4ca4dbe` 重新提交，统一归属 AF-188；
- AF-187 交付记录保留为技术证据，AF-188 负责交付入账。

## 2. 交付内容

代码与测试与 AF-187 完全一致，未回退、未缩水：

- `src/shared/encounter/encounter-scene.ts`：场景注册表，默认 `in_person`，`online` 支持 `video / voice / text`，新场景只扩注册表；
- `src/shared/text/output-integrity.ts`：落历史前输出完整性闸门（prompt 复述、无标签推理、角色标签、异常外语、全大写问答缩写、场景漂移）；合法文本中已闭合的 `<think>` 只剥离推理块；
- `practice-runner.service.ts`：两侧闸门、场景落库、风险收束会话级账本、`crisisOutcome`；
- `counselor-agent.service.ts` / 渲染层：咨询师开场按场景生成，生成侧泄漏重试与兜底；
- 迁移 `1714900000048-AddEncounterAndCrisisOutcome`：三列已加并回填；
- 管理后台：场景选择器、批量场景、场次行场景/危机结论标签；
- 导出 JSON：补 `encounterMode / encounterChannel / encounterLabel / exitReasonLabel / crisisOutcome / crisisOutcomeLabel`；
- `test/auto-practice/af187-encounter-output-integrity.spec.ts`：22 个回归用例。

## 3. 闸门数字（真实输出）

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm exec vitest run test/auto-practice/af187-encounter-output-integrity.spec.ts` | exit 0，22 tests passed |
| `pnpm test` | exit 0，223 files passed + 1 skipped；3949 tests passed + 4 skipped |
| `cd admin-dashboard && pnpm type-check` | exit 0，`vue-tsc --build` 无输出 |
| 迁移 | `AddEncounterAndCrisisOutcome1714900000048 has been executed successfully` |
| `git diff --stat HEAD -- src/engine-core` | 空 |
| `pnpm orchestration:preflight` | PASS |

## 4. 偏差与遗留

| 项 | 事实 | 处理 |
| --- | --- | --- |
| AF-187 任务状态 | rejected（租约过期） | 保留原事件链，AF-188 重新入账 |
| 线上默认子通道 | 固定 `video` | 集中到注册表 `defaultChannel`，待灰度拍板 |
| 第三场景 | 未开放条目 | 注册表结构预留，有真实使用方再加 |
| 流式拦截 | 只拦落历史前与候选重生成 | 已吐 token 无法撤回，展示侧过滤另立任务 |
| 迁移列级复验 | 本地 `.env` 直连读空 | 待用 `bin/ormconfig` 配置方式复验 |

## 5. 结论边界

技术交付通过；AF-187 的 rejected 是流程状态，不是代码失败。AI 结果仍只作 `ai_proxy_candidate`，不构成临床达标或真人督导结论。
