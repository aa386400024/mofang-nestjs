---
taskId: AF-216
contextId: phase3-orchestration-hardening
type: fix
agentRole: orchestrator
baselineRef: 82e19c7
completedAt: 2026-11-21T03:10:00+08:00
commitMessage: 'fix(af216): CI 逐提交门支持两阶段提交（实现提交凭提交内任务单入场）'
---

# AF-216 交付记录：CI 逐提交门与两阶段提交对齐

## 1. 问题（三次实证）

两阶段提交流程是现行规范：**实现提交**（业务文件 + 记录包任务单）→ 回执摄入 → **状态面提交**（claim/归档后的索引与事件）。但 CI 的逐提交门 `ci-task-gate.mjs` 读的是「该提交自身的树内索引」，实现提交那一刻索引里还没有这个任务：

| 提交      | 标题              | 旧门判定            |
| --------- | ----------------- | ------------------- |
| `46179e7` | `feat(AF-213): …` | `no-active-task` 红 |
| `6f21391` | `feat(AF-214): …` | `no-active-task` 红 |
| `c3e680d` | `docs(af215): …`  | `no-active-task` 红 |

本地 Husky 的 preflight 为什么绿：它读**工作区**索引（claim 已写入），而 CI 读**提交内**索引（尚未入库）。结论：规范产出的历史无法通过 PR 的逐提交复核，规范与门禁自相矛盾。

## 2. 修法：受限入场，而不是把索引塞进实现提交

`deriveImplementationTaskFromCommitSheet()` 是新的纯函数，条件全部满足才入场：

1. 标题能解析出**唯一**任务编号（`canonicalTaskId` 归一，`af215` → `AF-215`）；
2. 该提交 diff 内**新增**了 `docs/worklog/records/<context>/<taskId>/task-sheet.md`；
3. 该任务在提交索引与父索引中都**不存在**。

入场时用任务单文本重建 scope（复用 `parseTaskSheetScopeForGate`），并补上 `parseTaskSheetArtifactPathsForGate` 解析的 `artifacts` 路径 → `plannedArtifacts`，使交付记录按「任务自身工件」豁免，而不是被判越界。

入场后进入同一套 `evaluateTaskEntry`，因此：

- 越界文件照旧 `scope-residual` 判红（实证：把 `src/engine-core/foo.ts` 塞进 AF-900 提交即红）；
- `records/` 与状态面按 `STATE_PLANE_PATHS` 豁免；
- 验收门 `evaluateAcceptanceSnapshot` **零改动**（PR 最终 HEAD 仍必须 archived + passed durable 回执）。

## 3. 标题解析的两个修正

| 问题                                        | 处理                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 大写硬编码导致 `docs(af215)` 解析不到任务号 | 改为大小写不敏感并归一（`af215` / `AF-215` 同义）                                                            |
| 放宽大小写后又把技术串当成任务号            | 归一函数只接受「连字符形态任意前缀」或「无连字符全小写 2–3 字母」；`utf-8`、`Phase2`、`base64` 全部返回 null |

一条标题出现两个不同编号仍 fail closed（`findForeignCommitTaskIds` 语义与既有单测保持不变）。

## 4. 改动

| 文件                                                               | 改动                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/orchestration/ci-task-gate.mjs`                           | 新增 `canonicalTaskId` / `parseTaskSheetArtifactPathsForGate` / `deriveImplementationTaskFromCommitSheet`；`extractCommitTaskId` 大小写不敏感；`evaluateCommitAt` 增加入场分支并回传 `implEntrySource` |
| `scripts/orchestration/__tests__/ci-task-gate-impl-entry.spec.mjs` | 新增 10 例：入场四路径、越界仍红、交付记录豁免、标题归一与多编号拒绝、artifacts 解析                                                                                                                   |
| `docs/team/agent-orchestration/cross-machine-single-writer.md`     | 新增 §4.1（两阶段提交与逐提交门口径表）；§5 第 4 条「小写不参与解析」修正为大小写等价                                                                                                                  |

`git diff --stat`（实现文件）：`ci-task-gate.mjs` +117/−6、`cross-machine-single-writer.md` +17/−1、新增 spec 163 行。

## 5. 闸门

| 闸门         | 命令                                                                        | 结果                                                                               |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 编排护栏     | `pnpm exec vitest run scripts/orchestration/__tests__/`                     | 10 files / 328 tests passed（含新增 10 例）                                        |
| 真实历史取证 | `node scripts/orchestration/ci-task-gate.mjs --base 01c3ce8 --head 82e19c7` | total=6 passed=6 failed=0 ok=true                                                  |
| lint         | `pnpm lint`                                                                 | exit 0                                                                             |
| typecheck    | `pnpm typecheck`                                                            | exit 0                                                                             |
| 全量测试     | `pnpm test`                                                                 | 239 passed + 1 skipped（240 files）／4093 passed + 7 skipped（4100 tests），82.39s |
| 纯层红线     | `git diff --stat HEAD -- src/engine-core`                                   | 空                                                                                 |

真实历史取证逐提交：

```
PASS 46179e7 task=AF-213 reason=pass files=17
PASS df4c772 task=state-plane reason=state-plane-only files=5
PASS 6f21391 task=AF-214 reason=pass files=9
PASS 792e76f task=state-plane reason=state-plane-only files=5
PASS c3e680d task=AF-215 reason=pass files=5
PASS 82e19c7 task=state-plane reason=state-plane-only files=5
```

## 6. 与任务单的偏差

任务单里 `extractCommitTaskId` 的改法是「大小写不敏感 + scope 段优先」。实现时发现「scope 段优先」会破坏既有 squash 标题语义（`fix(orchestration): AF-123 ...` 的 scope 段无编号），导致 5 例既有单测红。因此改为**全文扫描 + 归一形态约束**：靠 `canonicalTaskId` 的形态规则排除技术串，而不是靠截取标题片段。最终 328 例全绿。

## 7. 提交

```
fix(af216): CI 逐提交门支持两阶段提交（实现提交凭提交内任务单入场）
```
