# Phase2.5 · 工程工具链技术债清单

> 建立日期：2026-11-11
> 发现来源：WP-K / WP-L 收尾提交（commit `401a5a2`）时，husky/lint-staged 拦截后排查所得
> 性质：**工程工具链待办，不阻塞当前已交付代码**；但其中部分项会在将来修改对应文件时阻塞提交，处理前先读本文
> **派单状态**：治本修复已派 **WP-M**（2026-11-11）→ [任务单](../completed/phase2.5/wp-m-toolchain-tech-debt-fix-2026-11-11.md) · [交付记录](../completed/phase2.5/wp-m-toolchain-tech-debt-fix-implementation-2026-11-11.md)
> **处理状态**：TD-1 ✅ 已修复（`666b0a8` / `fc9285c`）· TD-2 ✅ 已修复（2026-11-11）· TD-3 ✅ 已关闭（随 TD-1b 一并决策）· **闸门提速未决项 ✅ 已全部关闭（2026-11-12，见 §4）**
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

> **状态：✅ 已修复（2026-11-11，D 主控自做，commit `666b0a8`）**

- 现象：提交日志出现 `husky - DEPRECATED`，提示 `.husky/commit-msg` 里的两行在 v10.0.0 会失败（当前 husky 实装 9.1.7）。
- 涉及文件：`.husky/commit-msg`
- 已删除的两行：
  ```
  #!/usr/bin/env sh
  . "$(dirname -- "$0")/_/husky.sh"
  ```
- 修复结果：删除两行（并去掉因此产生的开头空行），共 3 行改动。
  - 安全性依据：husky 9 的 `.husky/_/h` 第 17 行用 `sh -e "$s" "$@"` **显式以 sh 执行用户脚本**，不依赖 shebang，故删除后钩子照常运行。
  - 验证：`sh -e .husky/commit-msg` 三类用例——合规 `487 ms/exit 0`、不合规 `716 ms/exit 1`、仅注释消息 `exit 1`；真提交 `666b0a8` 通过，提交日志**不再出现** `husky - DEPRECATED`。
- 风险：低。

#### TD-1b · 裸 `npx --no -- commitlint` 让每次提交白等约 13.4 秒（**本次核查新发现**）

> **状态：✅ 已修复（2026-11-11，D 主控自做，commit `fc9285c`）** —— 修复详情见本节末尾「修复结果」。

- 现象：`.husky/commit-msg` 正文有一句 `npx --no -- commitlint --edit "$1" 2>/dev/null || { ... 打印格式提示 ... }`。
- 双重问题：
  1. **`@commitlint/cli` 根本没装**（`node_modules/@commitlint/cli` 不存在、`package.json` 无该依赖），该句**每次都必然失败**，只走 fallback 打印提示 → 格式校验从未真正生效，形同虚设。
  2. **裸 npx 启动极慢**：实测三次 19 630 ms（冷启动）/ 13 487 ms / 13 376 ms，**稳定约 13.4 秒/次提交**。即每敲一次 `git commit`，在 lint-staged 真正开工前先空转 13 秒等一个注定失败的调用。
- 性质：既是**性能问题**（与用户「被速度逼疯」诉求直接冲突），也是**规范问题**（项目三处已固化「禁止裸 npx、优先 pnpm」），还是**功能问题**（校验形同虚设）。

**修复结果（2026-11-11，commit `fc9285c`）：**

- 做法：删掉裸 npx 整段，改为**纯 shell 正则校验**（零新增依赖、不引入 commitlint）。取提交消息首个有效行（跳过注释/空行），放行 `Merge` / `Revert` / `fixup!` / `squash!` 自动提交，其余必须匹配 `^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\([^)]+\))?: .+`，不匹配则打印格式提示并 **`exit 1` 真正阻断**。
- 决策：选择「**真阻断**」而非「只提示」。理由——该脚本注释本就写着「大厂标配 — 强制 conventional commit 格式」，且仓库既有全部提交均已是规范格式；只提示等于继续维持「形同虚设」的现状。
- 实测对比（`D:\Apps\Git\usr\bin\sh.exe` 直接执行钩子，补全 PATH）：

  | 场景                                       | 结果                                     |
  | ------------------------------------------ | ---------------------------------------- |
  | 合规消息 `docs: smoke test ...`            | exit **0**，**665 ms**（含 sh 进程启动） |
  | 不合规消息 `random message without prefix` | exit **1**，**627 ms**，打印格式提示     |
  | 改造前基线（裸 npx）                       | **约 13 400 ms**，exit 1 后走 fallback   |

  即单次钩子从约 13.4 秒降到约 0.67 秒（**约 20 倍**），且校验首次真正生效。

- 真提交验证：commit `fc9285c` 通过钩子，日志中已**不再出现** `skipping commitlint check`。
- 后续：顶部两行旧格式（TD-1a）已于同日一并删除（commit `666b0a8`），`husky - DEPRECATED` 警告随之消失。

### TD-2 · scripts 下 5 个历史文件共 67 个 lint 存量问题（优先级：P2，潜在阻塞）

> **状态：✅ 已修复（2026-11-11，MiniMax Code）** —— 67 → **0 error 0 warning**；详见本节末尾「修复结果」。

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

**修复结果（2026-11-11，MiniMax Code）：**

- **终态**：`pnpm exec eslint "scripts/**/*.ts"` → exit **0**，**0 error 0 warning**（基线为 exit 1 / 65 error + 2 warning = 67）。
- **做法**：`eslint --fix` 自动吃掉 **50 个**，剩余 **17 个**手工修。
- **`visitor-quality-audit.ts` 复杂度拆分**：`auditSession`（complexity 49 / cognitive 37）与 `main`（53 / 91）拆成 **13 个纯函数**（`deriveTraceSignals` / `deriveTextSignals` / `deriveRepeatRates` / `readKernelEndState` / `auditAll` / `groupByCharacter` / `reportD1`~`reportD5` / `printAnxiousGroup` / `buildOwnGrams` / `centroidExcluding` / `nearestCentroid` / `exportAnchor`）。
- **口径零漂移（强证据）**：重构前后各跑一次审计脚本，输出 **SHA256 相同**（`9F7D9923…397CA`）、**0 行差异**。
- **词表零改动（红线）**：`visitor-quality-lexicon.ts` **186 个字符串字面量逐字未改**（仅换行/缩进），词表单测 `test/quality/p1d-visitor-quality-lexicon.spec.ts` **15/15 绿**。
- **裸 IP**：`seed-verbal-voice.ts` 的 `117.72.30.78` 改为 `process.env.DB_HOST`（已核对 `.env` 同值），不留裸 IP。
- **唯一规则豁免**：`scripts/eval-runner.ts` 中 1 行**文件内** `eslint-disable-next-line unicorn/no-exports-in-scripts`（`parseEvalCliArgs` 被 `test/engine-adapters/eval/eval.runner.spec.ts` 消费，不能去 export），**未改全局 eslint 配置**。
- **回归闸门**：全量 `pnpm test` → **178 files（177 passed / 1 skipped）、2896 tests（2892 passed / 4 skipped）**、exit 0；`pnpm lint` exit 0；`pnpm exec tsc -p tsconfig.build.json --noEmit` exit 0；`git diff --stat HEAD -- src/engine-core` 为空。
- **遗留（✅ 已关闭 2026-11-11 · RESID-1）**：`stagnation-calibration.ts` 的 **2 个既有** `TS2459`（`CrisisWindowState` / `StagnationState` 未从 `src/auto-practice/practice-runner.service.ts` 导出）—— 改动前就存在。**已由独立小单 RESID-1 关闭**：两个接口加 `export`（纯可见性，零运行时行为变化），脚本侧类型检查 **TS2459 由 2 → 0**（错误总数 114 → 112，无新增）→ [RESID-1 交付记录](../completed/phase2.5/resid1-stagnation-state-exports-2026-11-11.md)。**M-4 决策（scripts 不进任何 tsconfig）维持现状不变。**
- **交付记录**：[wp-m-toolchain-tech-debt-fix-implementation-2026-11-11.md](../completed/phase2.5/wp-m-toolchain-tech-debt-fix-implementation-2026-11-11.md)

### TD-3 · commitlint 是否正式安装（优先级：P3，与 TD-1b 联动）

> **状态：✅ 已关闭（2026-11-11，D 主控，commit `fc9285c`）** —— 决策结论：**不安装 `@commitlint/cli`**，改用**纯 shell 正则校验**（零新增依赖、不引入 commitlint）。TD-1b 已按此路径完成提速与真阻断，TD-3 的「是否安装」决策随之落地，**不再作为独立待办**。若将来确需 commitlint 的完整规则集，再单独立项（届时走 `pnpm add -D` + `commitlint.config.js` + 钩子走 `pnpm exec commitlint`）。

- 现象：提交时只出现 conventional commits 格式提示，不强制；日志写明 `skipping commitlint check — install @commitlint/cli for enforcement`。
- 与 TD-1b 的关系：TD-1b 的 13.4 秒开销正是「调用了 commitlint 但没装」造成的。**只要按 TD-1b 改成纯 shell 校验，本项前半段（性能损耗）就一并消失**。
- 修复方式：本项退化为一个**决策**——是否要「真强制」而不仅是提示。若需要，安装 `@commitlint/cli`（用 `pnpm add -D`）并配 `commitlint.config.js`，钩子里改走 `pnpm exec commitlint`；若不需要，明确关掉该决策并依赖人工约定。
- 风险：低，纯增量设施；装后每次提交会增加约 2 秒（pnpm exec 启动），需在交付记录里如实记账。

---

### TD-4 · 批次报告 CLI 指纹走 `src/.ts`、服务端落库走 `dist/.js`，两者按设计永不相等（优先级：P2）

> **状态：待修复**（2026-11-12 批次 `g3ONzlqSGMVJqkFMF9Lwh` 发现，[交付记录 §9 B-2](../completed/phase2.5/phase2.5-verification-batch-96-implementation-2026-11-12.md)）

- **现象**：`ap_practice_batches.config_fingerprint` 由服务端收尾按 dist/`.js` 计算；`bin/batch-report.ts` CLI 报告指纹从 src/`.ts` 计算。`src/auto-practice/config-fingerprint.ts:17` 文件头自述"`.ts` 与 `.js` 口径互不可比，统一用 dist"，CLI 违反了该口径。
- **影响**：任何"DB 快照 vs CLI 报告"的指纹比对必然报"全段变化"，跨来源指纹不可用；不影响运行时与批次门禁判定。
- **建议**：`bin/batch-report.ts` 改为按 `dist/` 计算指纹（与服务端口径一致），或在指纹字段显式标注口径来源。
- **证据**：交付记录 §4.3 逐段举证（src combined `491558624aeafdb3` / dist combined `cf032d71ea4849b1`，dist 值与库内落库逐位相同）。

---

## 3. 处理原则

- 三项均不影响已交付的 WP-K / WP-L 临床正确性，可在后续迭代穿插处理。
- TD-1 改动最小、且有明确的版本失效节点（husky v10），建议最先做。
- TD-2 按文件拆分、独立提交，不要批量重构；改动 `engine-core` 仍受内核分层红线约束（本清单文件均不在 engine-core 内）。
- 每次清理后用对应命令复算，并回写本文件状态。

---

## 4. 闸门提速轮次（2026-11-11 ~ 11-12）未决项关闭登记

> 登记原因：任务记忆里仍留着 2026-11-12「火绒卸载轮」的三项未决，与本轮收尾后的实际状态不符。任务记忆由系统自动沉淀、无法直接改写，故在此留痕——**下个会话读到记忆条目时以本节与主文档为准，不要照抄记忆里的未决表述**。

| 未决项（记忆原文口径）                  | 现状                                                                                                                                         | 证据                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 是否撤销 Defender 排除                  | ✅ 已撤销 2026-11-12。该排除对普通权限 node 从未命中该现象（提权归零、普通仍 45ms），属无收益地降低安全面                                    | `%TEMP%\defender-excl-revoke.txt`；撤后次轮 88ms / slow=0 / 0.4ms 单文件 |
| 清 10 例 env 泄漏后启用 `isolate:false` | ❌ 已证伪，不是"再省 25.7s"。读税清零后它比权威 `isolate:true` **慢 47 秒**（WALL 179.2s vs 132s），失败面从 10 例扩到 27 例。P-DEBT-1 降 P2 | 主文档 §1.5.3 A/B 表；`%TEMP%\test-fast-repro.log`                       |
| watch 与 vite dev 未重启                | ✅ 已重启 2026-11-12。Nest `3000`（pid 21048）、admin vite `5174`（pid 3872）均在监听                                                        | `Get-NetTCPConnection -State Listen`                                     |

**权威口径指向**（本节不复制数字，只给入口）：

- 机制与实证：主文档 [`docs/team/gate-performance-remediation-2026-11-11.md`](../../team/gate-performance-remediation-2026-11-11.md) §1.5（三轮对照 / 治本动作 / `isolate:false` 判定）
- 当前实测与机器状态：同文档 §1.5.2 实证表；命令附录 §7.2
- 日常命令口径：任务模板 [`docs/team/wp-task-template.md`](../../team/wp-task-template.md) §5（统一 pnpm、`pnpm doctor:fs` 先体检、验收不重跑全量）
- 技术债台账：同文档 §9 P-DEBT-1 ~ 10

**给下个会话的三条硬提醒：**

1. 引用任何闸门耗时前先看 §1.5.2 的机器状态列。`80.42s` / `1102.6s` / `140.29s` 都是特定机器状态下的产物，**不标机器状态的时间数字不可比、不可验收**。
2. `pnpm test:fast`（`isolate:false`）只作快速冒烟，**不作交付证据**；交付证据一律用 `pnpm test` 全量。
3. 读延迟先跑 `pnpm doctor:fs`；不合格（>1.0ms/文件 或 慢文件占比 >5%）说明 inode 环境税回归，按主文档 §1.5 的 copy 装法重装，不要转去攻 vitest 配置。
