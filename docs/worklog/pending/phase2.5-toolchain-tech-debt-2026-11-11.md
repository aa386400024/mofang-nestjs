# Phase2.5 · 工程工具链技术债清单

> 建立日期：2026-11-11
> 发现来源：WP-K / WP-L 收尾提交（commit `401a5a2`）时，husky/lint-staged 拦截后排查所得
> 性质：**工程工具链待办，不阻塞当前已交付代码**；但其中部分项会在将来修改对应文件时阻塞提交，处理前先读本文
> 本文件是工具链技术债的单一事实源，README 只保留指向这里的链接

---

## 1. 背景与已完成的治本动作

WP-K / WP-L 首次 `git commit` 时被 husky 的 lint-staged 拦截，eslint 报 `was not found by the project service`。根因：`scripts/` 下的独立运维脚本（入队 / seed / 审计，用 `tsx` 直接跑、不进 build、不被 src/test import）不属于任何 tsconfig project，而根 tsconfig 的 include 只有 `src / test / bin / typings`。

**本次已完成的治本动作（已在 commit `401a5a2` 落地）：**

- 在 `eslint.config.mjs` 给 `scripts/**/*.ts` 加 `disableTypeChecked` override。这些脚本本就 transpile-only 执行、不做 tsc 类型检查，关闭类型 lint 后只保留语法 / import / prettier 等非类型规则，project service 解析错误消除。
- 同类历史脚本 `enqueue-p4-batch.ts` 的隐患一并修复：纯格式改动 + `process.exit(1)` 标准化为 `process.exitCode = 1`，无逻辑变化。

以下是仍未处理的存量项。

---

## 2. 待办清单

### TD-1 · husky `commit-msg` 旧格式将在 v10 失败（优先级：P1，改动极小）

- 现象：提交日志出现 `husky - DEPRECATED`，提示 `.husky/commit-msg` 里的两行在 v10.0.0 会失败。
- 涉及文件：`.husky/commit-msg`
- 需删除的两行：
  ```
  #!/usr/bin/env sh
  . "$(dirname -- "$0")/_/husky.sh"
  ```
- 修复方式：删除这两行，保留实际的 commit-msg 逻辑；独立一次小提交。
- 风险：低，删除前确认文件里除这两行外还有需要保留的内容。

### TD-2 · scripts 下 5 个历史文件共 67 个 lint 存量问题（优先级：P2，潜在阻塞）

- 现象：对 `scripts/**/*.ts` 跑 eslint，5 个 clean 的历史文件共报 67 个问题（65 error + 2 warning）。
- 涉及文件：
  - `scripts/eval-runner.ts`
  - `scripts/ops/calibration/stagnation-calibration.ts`
  - `scripts/ops/quality/seed-verbal-voice.ts`
  - `scripts/ops/quality/visitor-quality-audit.ts`
  - `scripts/ops/quality/visitor-quality-lexicon.ts`
- 问题类型：函数复杂度过高（complexity / cognitive-complexity）、hardcoded IP、prettier 格式、`array-type`、`prefer-set-has`、`no-array-sort`、`no-negated-condition`、`no-exports-in-scripts` 等。
- 影响：当前这些文件是 clean 的，不触发 lint-staged、不阻塞；**一旦修改其中任一文件并提交，会被这些存量问题阻塞**。
- 已缓解部分：project service 解析错误已由 `disableTypeChecked` override 解决；剩下的是非类型存量规则。
- 修复方式：建议按文件逐个清理、每个文件独立提交，避免一次性大改。复杂度超标的 `visitor-quality-audit.ts` 需要拆分函数，属较大改动，优先安排。
- 复算命令：
  ```
  pnpm exec eslint "scripts/**/*.ts"
  ```

### TD-3 · commitlint 未安装（优先级：P3，按需）

- 现象：提交时只出现 conventional commits 格式提示，不强制；日志写明 `skipping commitlint check — install @commitlint/cli for enforcement`。
- 修复方式：如需要强约束提交信息格式，再安装 `@commitlint/cli` 并配置；当前靠人工遵守约定即可。
- 风险：低，纯增量设施。

---

## 3. 处理原则

- 三项均不影响已交付的 WP-K / WP-L 临床正确性，可在后续迭代穿插处理。
- TD-1 改动最小、且有明确的版本失效节点（husky v10），建议最先做。
- TD-2 按文件拆分、独立提交，不要批量重构；改动 `engine-core` 仍受内核分层红线约束（本清单文件均不在 engine-core 内）。
- 每次清理后用对应命令复算，并回写本文件状态。
