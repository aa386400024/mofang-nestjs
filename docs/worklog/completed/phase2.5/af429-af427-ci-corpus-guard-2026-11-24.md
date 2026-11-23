# AF-429 交付记录：AF-427 端到端用例的无语料检出守卫

- 日期：2026-11-24
- 任务：AF-429（fix / orchestrator），承接 AF-427
- 基线：`67e54372e171920fad603e667b181cfce59cb9b7`
- 分支：`task/AF-427-operator-delta-ledger`（补丁尾提交，随 PR #212 合入）
- 改动：`scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs`

## 1. 现象与根因

AF-427 的 PR #212 首轮 CI `Unit (shard 1/3)` 失败，重跑后同一条仍失败，本地 `pnpm test` 与 `pnpm run test -- --shard=1/3` 全绿。

取 CI 作业日志（`/actions/jobs/<id>/logs`）后发现单元测试步骤用的是 blob reporter 输出到 `.vitest-reports/blob-1.json`，控制台不含失败明细；但对仓库做一次忽略规则核对即可定位：

```
git check-ignore -v data/debug-sessions
→ .gitignore:111:data/debug-sessions/   data/debug-sessions
```

根因：AF-427 两条端到端用例直接读 `data/debug-sessions`，该目录被 gitignore，CI 检出里不存在，`loadOperatorCorpusStats` 抛「目录不存在」→ 用例红。本机有语料，所以本地永远复现不出来。

## 2. 修复

```js
const CORPUS_DIR = path.join(REPO_ROOT, 'data/debug-sessions');
const HAS_CORPUS = fs.existsSync(CORPUS_DIR);
```

两条端到端用例（结构完整性、Markdown 渲染）在 `HAS_CORPUS === false` 时提前返回；解析器、cap 占用、合成夹具三类用例不依赖真实语料，断言强度不变。

## 3. 闸门

| 闸门               | 命令                                                                                        | 结果     |
| ------------------ | ------------------------------------------------------------------------------------------- | -------- |
| 定向单测（有语料） | `pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs` | 9 passed |
| lint               | `pnpm lint`                                                                                 | 0 error  |

## 4. 教训（写进交付记录，供下一次复用）

**单测里读被 gitignore 的本地数据，等于把 CI 变成随机红。** 规则：凡是读 `data/**`（除已入库的 `data/phase25-exit`、`data/eval-datasets` 等白名单）的用例，都必须显式做存在性守卫，并在注释里点明该路径被忽略。

## 5. 偏差

本单按「验收阶段发现新问题另开任务单」登记，但修复随 AF-427 的 PR #212 一并合入，未新开 PR —— 因为该 PR 尚未合并，另开 PR 会把 AF-427 的提交带进第二个 PR，制造重复合并点。属有意偏差，已在回执 `deviationTable` 登记。
