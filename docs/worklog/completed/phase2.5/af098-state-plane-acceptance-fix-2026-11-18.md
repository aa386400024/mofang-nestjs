# AF-098 验收器状态面豁免修复（交付记录）

- 任务：AF-098 `phase2.5-exit4-proxy-quality`
- 基线：`c58be14c2cec46330f59cb787b08b97d0d8e58ca`
- 日期：2026-11-18
- 边界：只修验收器状态面豁免，不改普通交付文件的 scope 判定，不改 `engine-core`。

- **机读字段标记**：gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict

## 1. 根因

AF-095 首轮 `run-once` 的机读结论是：

> scope 外提交文件（已按 commit 事实比对）：docs/team/agent-orchestration/improvement-log.json

`improvement-log.json` 由 CLI 在 `improvements` 流转与归档流程中自动重写，属于编排状态面。
但 `acceptance-runner.mjs` 的 `STATE_PLANE_ARTIFACTS` 只列了 snapshot / index / journal /
archived-notes / orchestration-state / 看板数据，漏掉 improvement-log，导致 V7 把编排自身写入
判成任务越域，合规任务永久 rejected。

## 2. 修复

1. `STATE_PLANE_ARTIFACTS` 增加 `docs/team/agent-orchestration/improvement-log.json`。
2. 新增 `scripts/orchestration/__tests__/acceptance-state-plane.spec.mjs`：
   - improvement-log 必须判为状态面；
   - `STATE_PLANE_ARTIFACTS` 中每个声明项都必须判为状态面；
   - README 与 `src/auto-practice/metrics/counselor-quality.ts` 必须仍判为普通交付面。

## 3. 闸门结果

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 新回归单测 | `corepack pnpm exec vitest run scripts/orchestration/__tests__/acceptance-state-plane.spec.mjs` | 3/3 passed，exit 0 |
| 编排既有单测 | `corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 251/251 passed，exit 0 |
| 事件链 | `node scripts/orchestration/cli.mjs events verify` | PASS，414 条事件，哈希链与索引投影一致 |
| engine-core 边界 | `git diff --stat c58be14 -- src/engine-core` | 空 |
| 定向 lint | `eslint scripts/orchestration/*.mjs` | not-applicable：仓库 eslint project service 未纳入 `scripts/orchestration/*.mjs`，解析器报 not found；不是代码错误，未伪称通过 |

## 4. 影响面

- 只影响验收器 V7 的状态面排除集合；普通交付文件仍按 task scope 比对。
- 不改变任务状态机、回执 schema、PR gate 与 branch protection。
- AF-095 首轮 rejected 的历史仍保留；AF-097 已在干净分支重新交付并通过 `conditional-pass`。

## 5. 结论

AF-095 的 rejected 不是质量证据不合格，而是框架状态面清单漏项 + 交付记录机读标记缺失。
本单修复前者，AF-097 修复后者；两项合并后，Phase 2.5 出口④的质量证据链可在新框架下完整闭环。
