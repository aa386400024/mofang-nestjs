# Phase2.5 · 工程工具链技术债清单

> 建立日期：2026-11-11
> 发现来源：WP-K / WP-L 收尾提交（commit `401a5a2`）时，husky/lint-staged 拦截后排查所得
> 性质：**工程工具链待办，不阻塞当前已交付代码**；但其中部分项会在将来修改对应文件时阻塞提交，处理前先读本文
> **派单状态**：治本修复已派 **WP-M**（2026-11-11）→ [任务单](../completed/phase2.5/wp-m-toolchain-tech-debt-fix-2026-11-11.md) · [交付记录](../completed/phase2.5/wp-m-toolchain-tech-debt-fix-implementation-2026-11-11.md)
> **处理状态**：TD-1 ✅ 已修复（`666b0a8` / `fc9285c`）· TD-2 ✅ 已修复（2026-11-11）· TD-3 ✅ 已关闭（随 TD-1b 一并决策）· **闸门提速未决项 ✅ 已全部关闭（2026-11-12，见 §4）** · **CI 三条遗留 ✅ 已处置（2026-11-13，TD-8）**：npm/pnpm 对齐 + 无效 coverage 步骤清理 + CI 缓存持久化 → [交付记录](../completed/phase2.5/td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md) · **TD-9 四条工程卫生 ✅ 已处置（2026-11-13，TD-9）**：spec 隔离残留清理 + oxlint 告警清零 + ESLint 缓存口径统一（并修掉 TD-8 遗留的失效缓存键）+ git 依赖 spec 环境前置 → [交付记录](../completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md)
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

> **状态：✅ 已修复**（2026-11-12，与 intake-v2 分档同单交付 → [交付记录](../completed/phase2.5/phase2.5-intake-v2-mode-stratified-acceptance-implementation-2026-11-12.md)）

- **现象**：`ap_practice_batches.config_fingerprint` 由服务端收尾按 dist/`.js` 计算；`bin/batch-report.ts` CLI 报告指纹从 src/`.ts` 计算。`src/auto-practice/config-fingerprint.ts:17` 文件头自述"`.ts` 与 `.js` 口径互不可比，统一用 dist"，CLI 违反了该口径。
- **影响**：任何"DB 快照 vs CLI 报告"的指纹比对必然报"全段变化"，跨来源指纹不可用；不影响运行时与批次门禁判定。
- **建议**：`bin/batch-report.ts` 改为按 `dist/` 计算指纹（与服务端口径一致），或在指纹字段显式标注口径来源。
- **证据**：交付记录 §4.3 逐段举证（src combined `491558624aeafdb3` / dist combined `cf032d71ea4849b1`，dist 值与库内落库逐位相同）。
- **修复方式（2026-11-12）**：新增共享口径解析器 `resolveFingerprintSource()`（`prompt-fingerprint.ts`）——包根下存在构建产物时，一律读 `<root>/dist/**/*.js`；`computePromptVersion()`（prompts 段）与 `computeConfigFingerprint()` 的其余 6 段全部走该口径。**没有在 CLI 里另写哈希**，修复落在指纹模块/调用链（符合本项建议）。
- **修复后证据**：CLI（`pnpm exec tsx` → src 上下文）与服务端（`node` → dist 上下文）**7 段逐段相同**，combined 同为 `ce51839d02ea4020`；fail-closed 保留（读不到 → 该段 `unknown` → combined `unknown`）。与库内旧落库值 `cf032d71ea4849b1` 不同是**判据文件内容变更**（acceptance 段）导致的预期差异，跨批判 `incomparable` 属设计预期。
- **残留**：无（本项关闭）。附带收益：`prompt` 段原先也两侧不等，只修 `config-fingerprint.ts` 不足以让 combined 可比，故修复面覆盖到 `prompt-fingerprint.ts`。

---

### TD-8 · CI 侧工具链遗留三条（优先级：P3，2026-11-13 处置）

> **状态：✅ 已处置（2026-11-13，MiniMax Code，TD-8 收尾单）** —— 代码级唯一改动 `.github/workflows/ci.yml`；`src` / `test` / `bin` / `scripts` / `admin-dashboard` 零改动，engine-core 零 diff → [交付记录](../completed/phase2.5/td8-ci-pnpm-parity-and-caching-implementation-2026-11-13.md)

| #   | 遗留项                                              | 处置结论                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 | CI 包管理用 npm，与本地 / Dockerfile 的 pnpm 不一致 | 三个 job（`lint-and-typecheck` / `test` / `security-audit`）全部改 pnpm：**corepack enable**（与 Dockerfile 逐字一致）→ `pnpm install --frozen-lockfile` → 脚本名逐字对应 `package.json`（`lint` / `test` / `test:e2e` / `migration:run` / `pnpm exec tsc --noEmit -p tsconfig.json`）；`npm audit --omit=dev` → `pnpm audit --prod`（pnpm 无 `--omit=dev` 参数，`--prod` 为语义等价项）；`cache: 'npm'` 移除 → 独立 `actions/cache` 缓存 `~/.pnpm-store` |
| C-2 | coverage 上传步骤无效（上传空目录）                 | **移除** `test` job 的 `Upload coverage` 步骤（`name` / `if` / `uses` / `with` 四行整体）。证据：`test` 脚本无 `--coverage`、`vitest.config.mts` 的 coverage 段只有 include/exclude 无 provider/reporter → `coverage/` 目录不生成。**`vitest.config.mts` 的 coverage 段保留不动**（未来启用采集可直接复用）                                                                                                                                               |
| C-3 | CI 未持久化依赖与 vitest 转换缓存                   | 新增 **pnpm store 缓存**（3 job，path `~/.pnpm-store`，key `pnpm-store-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`）+ **vitest 转换缓存**（仅 `test` job，path `node_modules/.vite/vitest`，key 同口径）；**未缓存 `node_modules` 本体**（pnpm 走 store + 硬链，缓存 node_modules 跨 CI 易产生路径 / 符号链接抖动）；缓存未命中时行为与现状等价                                                                                                  |

**遗留（待主控拍板 / 另案）**：

- **D-a · npm 锁去留**：✅ **已关闭（2026-11-14，TD-11）** —— 根目录 `package-lock.json`（659 714 B）**已删**，版本控制只留 `pnpm-lock.yaml` 一份锁文件真相源；被删锁打断的 4 处 `npm ci` 活路径（README 快速开始 / `bin/dev-up.ps1` / `bin/check-dev-env.sh` / `docs/runbooks/local-setup.md`）经主控拍板一并改口 `pnpm install --frozen-lockfile`；`deploy-tested.cjs` 上传清单 + README scp 清单同步 `pnpm-lock.yaml`；`docs/runbooks/docker-deploy.md` 的 npm 时代口径**只标注不改写**（部署文档历史债另案）。
- **D-b · 是否在 CI 开启覆盖率采集**：✅ **采集已接通（2026-11-14，TD-11）** —— `vitest.config.mts` 补 `provider: 'v8'` / `reporter: ['text','lcov']` / `reportsDirectory: './coverage'`；CI 新增**独立 `coverage` job**（单进程全量跑 unit 并把 `coverage/` 上传为 artifact），本地 `pnpm test` 仍不插桩。**首轮真实报告已产出**：Statements **46.92%** / Branches **45.66%** / Functions **42.48%** / Lines **46.68%**（26 408 stmts）。**阈值门禁已落地（2026-11-14，TD-12 已交付）** —— `vitest.config.mts` 的 `coverage.thresholds` 立**全局聚合**四指标下限（stmts 44 / branch 43 / funcs 40 / lines 44，`perFile: false`），低于阈值即采集命令 exit 非 0、CI coverage job 转红；复跑实测 stmts **46.92%** / branch **45.67%** / funcs **42.48%** / lines **46.69%**，四指标全部高于阈值（缓冲 +2.48 ~ +2.92 pp）、相对首轮基线偏差 ≤0.01 pp，且**反向验证**小样本采集四指标全部报错 exit 1（证明门禁真会转红）；**阈值唯一真相源 = `vitest.config.mts`**，别处不另抄数字；观察期**不阻断 build**（`build` 的 `needs` 未改）。**另案 A–F 登记**：A 分层阈值（待分目录 lcov 明细）/ B 逐文件阈值 `perFile` + `perFileThresholds`（待逐文件基线）/ C coverage 纳入 `build` 的 `needs` 阻断链（观察期后评估）/ D entities exclude 口径（调整则基线与阈值须重拍）/ E 低覆盖模块补测专项 / F 阈值复核与上调节奏机制 → [TD-12 任务单](../completed/phase2.5/td12-coverage-threshold-gate-task-2026-11-14.md) · [TD-12 交付记录](../completed/phase2.5/td12-coverage-threshold-gate-implementation-2026-11-14.md)。
- **audit registry 容错**：✅ **已关闭（2026-11-14，TD-11）** —— CI `security-audit` 改 `pnpm audit --audit-level=high --prod --ignore-registry-errors`（registry 网络 / 服务故障放行，**真实 high 及以上 advisory 仍按阈值阻断**）。
- **P-DEBT-5 的分片（shard）部分**：✅ **已落地（2026-11-14，TD-11）** —— `ci.yml` matrix **2 片**（`pnpm run test -- --shard=N/2`，仅 unit、e2e 不进矩阵），`build` 的 `needs` 改 `[unit, e2e]`；前置核查通过（单测不连真实 MySQL、无固定端口占用），本机实跑 **97 + 97 = 194 文件 / 3252 例**与基线逐字一致；收益仅在 CI 多 runner 并行成立（**CI job run 净增 2**）。
- **CI 侧结果待复核**：本机跑不了 GitHub CI，交付记录**未写「CI 已通过」**；需在 Actions 复核 ① matrix shard 传参 ② coverage artifact 上传 ③ audit 容错不影响真实 high+ 阻断 ④ `build` 的 `needs` 等齐两片。

> **TD-11 立项（2026-11-14）**：上述 D-a 锁文件单轨（T-A 删 `package-lock.json` + 部署脚本 / README 清单同步，runbook npm 历史口径登记另案）、D-b coverage 采集接通（T-D v8 + text/lcov，CI 采集、本地不插桩；**阈值门禁仍另案**，待首轮真实报告拍板）、audit registry 容错（T-C `--ignore-registry-errors`，registry 网络故障放行、真实 high+ 漏洞仍阻断）、P-DEBT-5 分片矩阵（T-E matrix 2 片 `--shard`，仅 unit，前置核查不足降级另案）四项纳入 [TD-11 任务单](../completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-task-2026-11-14.md)；L-1b 仓储端口抽象不在本单。coverage 阈值门禁已另立 [TD-12 任务单](../completed/phase2.5/td12-coverage-threshold-gate-task-2026-11-14.md)（2026-11-14，✅ 已交付）。

### TD-9 · 测试隔离残留 · lint 告警 · ESLint 缓存 · git 环境前置（优先级：P3，2026-11-13 处置）

> **状态：✅ 已处置（2026-11-13，MiniMax Code，TD-9 收尾单）** —— **engine-core 零 diff**、断言期望与用例数逐字未变（3252 例 / 194 文件）；改动落在 `test/`、少量 `src/` 告警点、`.oxlintrc.json`、`.github/workflows/ci.yml` → [交付记录](../completed/phase2.5/td9-test-isolation-and-lint-hygiene-implementation-2026-11-13.md)

| #   | 遗留项                                               | 处置结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1 | spec 间 `process.env` / mock 单例 / 模块级 stub 残留 | 4 个非 e2e spec 补**统一重置钩子**（共享 `test/helpers/isolation.ts`）：`resetTestDoubles` = 还原 spy + `mockReset` 把替身复位回 `vi.fn` 工厂默认实现（清计数 + 清一次性实现）；4 文件现场复核**零** `process.env` 读写（env 快照 helper 仍封装为可复用件，本单无调用点）；`good-state-diary.service.spec` 已不在权威 `pnpm test` 集合                                                                                                                                                                     |
| T-2 | `.eslintcache` 存在却大面积失效                      | 对照实验定位：失效变量 = **解析后配置对象的内容**（改规则 → 189.9 s 整体失效；只改配置注释 → 5.6 s 不失效）+ ESLint / Node 版本 + 文件自身 mtime/size；**tsconfig 内容不在键里**（改 tsconfig → 8.2 s 仍命中 → 旧缓存会给出过期 type-aware 结论）。统一口径 `eslint-<os>-<hash(eslint 配置 + tsconfig 指纹)>`，**不带 restore-keys**（指纹不同宁可冷跑）；CI lint job 新增 ESLint 缓存步骤（冷 183.6 s → 热 5.8 s，31.8×）；**顺带修掉 TD-8 遗留的 4 个失效缓存键**（单 `$` → `[object Object]`，共 8 处） |
| T-3 | oxlint 既有告警（fast 4 + deep 57）                  | 逐条定性后**清零**（fast **0/0**、deep **0/0**）：22 条 `no-misused-spread` 规则层豁免（DTO / row 字段拷贝；权威 ESLint 闸门用 `recommendedTypeChecked` 本就不含该规则）、17 条 `unbound-method` 在 `.oxlintrc.json` 的 test / bin 段豁免（取路由元数据 / 挂原型方法 spy 的标准写法）、10 条 `no-base-to-string` 走新共享纯函数 `safeString` / `toUtf8Text`（`src/shared/infra/string-utils/`）、其余 8 条真问题最小修正（可选链补 `?.`、恒等零项化简、去多余 `await`、模板串窄化）                        |
| T-4 | 依赖外部命令的 spec 无环境前置                       | 新增 `test/helpers/git-probe.ts` 探测（`GIT_BIN` 注入优先 → 回退 PATH 的 `git` → 跑 `--version`）；三处 `execFileSync` 统一走解析后的路径；不可用时该用例 `it.skipIf` 跳过（跳过条件取"注入路径与 PATH 同时可用"，因 src 侧 `gitDescribeDirty()` 硬编码走 PATH）                                                                                                                                                                                                                                           |

**遗留（待主控拍板 / 另案）**：

- **ESLint 缓存键不含 tsconfig / 插件版本**：本机改 tsconfig 或升 eslint / 插件版本后**必须删 `.eslintcache`**，否则会读到过期的 type-aware 结论；本单只写纪律，**未**做自动化（后续可加 `lint:cache:reset` 脚本）。
- **本机 ESLint 冷跑 183.6 s 远高于模板记录的 49.3 s**：归因于用户侧长驻进程并行（`nest start --watch` + vite + `dist/app`），读税已归零（`doctor:fs` 0.11 ms/文件合格）→ 属环境状态，非本单引入。
- **CI 侧结果待复核**：本机跑不了 GitHub CI，交付记录未写「CI 已通过」；需在 Actions 复核新增的 ESLint 缓存步骤与修正后的 4 个缓存键。

---

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
