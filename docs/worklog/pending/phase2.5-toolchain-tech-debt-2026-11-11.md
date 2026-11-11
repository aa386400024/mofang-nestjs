# Phase2.5 · 工程工具链技术债清单

> 建立日期：2026-11-11
> 发现来源：WP-K / WP-L 收尾提交（commit `401a5a2`）时，husky/lint-staged 拦截后排查所得
> 性质：**工程工具链待办，不阻塞当前已交付代码**；但其中部分项会在将来修改对应文件时阻塞提交，处理前先读本文
> **派单状态**：治本修复已派 **WP-M**（2026-11-11）→ [任务单](wp-m-toolchain-tech-debt-fix-2026-11-11.md)
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

### TD-1 · husky `commit-msg` 两处问题（优先级：P1，改动极小但收益大）

#### TD-1a · 旧格式两行将在 husky v10 失败

- 现象：提交日志出现 `husky - DEPRECATED`，提示 `.husky/commit-msg` 里的两行在 v10.0.0 会失败（当前 husky 实装 9.1.7）。
- 涉及文件：`.husky/commit-msg`
- 需删除的两行：
  ```
  #!/usr/bin/env sh
  . "$(dirname -- "$0")/_/husky.sh"
  ```
- 修复方式：删除这两行，保留实际的 commit-msg 逻辑；独立一次小提交。
- 风险：低，删除前确认文件里除这两行外还有需要保留的内容。

#### TD-1b · 裸 `npx --no -- commitlint` 让每次提交白等约 13.4 秒（**本次核查新发现**）

- 现象：`.husky/commit-msg` 正文有一句 `npx --no -- commitlint --edit "$1" 2>/dev/null || { ... 打印格式提示 ... }`。
- 双重问题：
  1. **`@commitlint/cli` 根本没装**（`node_modules/@commitlint/cli` 不存在、`package.json` 无该依赖），该句**每次都必然失败**，只走 fallback 打印提示 → 格式校验从未真正生效，形同虚设。
  2. **裸 npx 启动极慢**：实测三次 19 630 ms（冷启动）/ 13 487 ms / 13 376 ms，**稳定约 13.4 秒/次提交**。即每敲一次 `git commit`，在 lint-staged 真正开工前先空转 13 秒等一个注定失败的调用。
- 性质：既是**性能问题**（与用户「被速度逼疯」诉求直接冲突），也是**规范问题**（项目三处已固化「禁止裸 npx、优先 pnpm」），还是**功能问题**（校验形同虚设）。
- 修复方式（推荐，零新增依赖）：删掉该句，改为**纯 shell 正则校验** conventional commit 前缀（`grep -Eq '^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\(.+\))?: .+'`），不匹配则打印现有提示（阻断或仅提示，二选一并在交付记录写明理由）。若确需 `@commitlint/cli`，安装后**必须走 `pnpm exec`**。
- 复算命令（改造后应为毫秒级）：
  ```
  # 计时单次 commit-msg 钩子
  ```
  改造前基线：约 13.4 秒。
- 风险：低；但需实测确认钩子改造后仍能正常触发（见任务单 §5.3）。

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

### TD-3 · commitlint 是否正式安装（优先级：P3，与 TD-1b 联动）

- 现象：提交时只出现 conventional commits 格式提示，不强制；日志写明 `skipping commitlint check — install @commitlint/cli for enforcement`。
- 与 TD-1b 的关系：TD-1b 的 13.4 秒开销正是「调用了 commitlint 但没装」造成的。**只要按 TD-1b 改成纯 shell 校验，本项前半段（性能损耗）就一并消失**。
- 修复方式：本项退化为一个**决策**——是否要「真强制」而不仅是提示。若需要，安装 `@commitlint/cli`（用 `pnpm add -D`）并配 `commitlint.config.js`，钩子里改走 `pnpm exec commitlint`；若不需要，明确关掉该决策并依赖人工约定。
- 风险：低，纯增量设施；装后每次提交会增加约 2 秒（pnpm exec 启动），需在交付记录里如实记账。

---

## 3. 处理原则

- 三项均不影响已交付的 WP-K / WP-L 临床正确性，可在后续迭代穿插处理。
- TD-1 改动最小、且有明确的版本失效节点（husky v10），建议最先做。
- TD-2 按文件拆分、独立提交，不要批量重构；改动 `engine-core` 仍受内核分层红线约束（本清单文件均不在 engine-core 内）。
- 每次清理后用对应命令复算，并回写本文件状态。
