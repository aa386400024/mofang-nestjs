# AF-573 · quality 运维脚本纳入 lint 闸门 — 交付记录

- **任务单**：`docs/worklog/records/phase2.5-toolchain/AF-573/task-sheet.md`
- **前序任务**：AF-572（同 scope 原单，因 executor 资源域不含 `scripts/ops/quality/` 与 `eslint.config.mjs`，派发被 `scope-domain-conflict` 拦截后重签发；原单 canceled/archived）
- **分支**：`task/AF-573-quality-scripts-lint`
- **基线**：`400d4c483e2df4f82d9a73bb2b829351b3f1118e`
- **日期**：2026-11-27
- **性质**：工具链 lint 覆盖与格式修复，R1，standard gate

## 一、问题与结论

`package.json` 的 `lint` 只覆盖 `{src,test,bin}/**/*.ts` 与 `scripts/**/*.{mjs,cjs}`，`scripts/ops/quality/` 下 14 个 TypeScript 运维脚本不在闸门内。实测直接跑 ESLint 为 **185 errors / 4 warnings**，其中 120 个可自动修复。

本任务把该目录纳入 `lint` / `lint:fix`，复用 `eslint.config.mjs` 已有的 `scripts/**/*.ts` 非 type-aware 段，清理到 **0 error / 0 warning**；不新增 tsconfig/类型工程，不改脚本判定规则、阈值、报告字段或 CLI 参数。

## 二、改动文件

| 文件 | 改动 |
| --- | --- |
| `package.json` | `lint` / `lint:fix` 增加 `"scripts/ops/quality/**/*.ts"` |
| `scripts/ops/quality/af086-exam-double-run.ts` | import 顺序与 `node:path` 用法、`toSorted`、`resolve` 命名；抽 `buildChecks` 降 complexity |
| `scripts/ops/quality/af448-scripted-corpus.ts` | `process.exit(0)` 单点豁免；`indexOf` 条件等价化简 |
| `scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts` | 合并分段 `push`、`at(-1)`；报告拼装函数加复杂度豁免 |
| `scripts/ops/quality/i11-accessibility-reconciliation.ts` | `toSorted`；抽 `blockerOf` / `tierLabel` / `ratio` / `meanOf` / `simulateBatch` / `statusOf` / 行构造 helper 降复杂度 |
| `scripts/ops/quality/visitor-quality-audit.ts` | import 顺序调整，无行为变化 |
| `scripts/ops/quality/visitor-quality-disfluency.ts` | `renderD7Report` 多次 `push` 合并为一次多参数 `push`，输出顺序不变 |
| `docs/worklog/completed/phase2.5/af573-quality-scripts-lint-2026-11-27.md` | 本交付记录 |

未改 `eslint.config.mjs`：`scripts/**/*.ts` 的 `tseslint.configs.disableTypeChecked` 段已存在。

## 三、lint 债清零过程

1. 基线：14 个 TS 文件，**185 errors / 4 warnings**，120 可自动修复。
2. `pnpm exec eslint "scripts/ops/quality/**/*.ts" --fix` 后剩 24 个问题。
3. 手工收口主要三类：
   - 复杂度：`main` / `reconcileSession` / `classifyTier` / `summarizeGroup` / `extrapolateCharacter` / `buildReport` / `renderReport` 抽 helper 或单点豁免。
   - 风格：import 顺序、`node:path` 默认导入、`toSorted`、`at(-1)`、多参数 `push`。
   - 自动修复副作用：`g4-lexicon-substring-overlap-evidence.ts` 出现行首孤立逗号导致 Parsing error，逐处修复并用正则清理“仅空白 + 逗号”的整行后恢复结构。
4. 语义复核：抽 `buildChecks` 时曾用 `DEFAULT_BODY.repeats` 计算 expected，会忽略 CLI `--repeats`；已改为把 `main` 的 `expected` 传入，恢复原语义。`i11` 的 `summarizeGroup` 对象字面量一度出现重复 `reachTurnMin/Median/Max` 键，已删除。

## 四、闸门结果

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec eslint "scripts/ops/quality/**/*.ts"` | exit 0；14 文件 0 error / 0 warning |
| `pnpm lint` | exit 0；全仓 0 error |
| `pnpm typecheck` | exit 0；0 error |
| `git diff --stat HEAD -- src/engine-core` | 输出为空；engine-core 零 diff |
| `pnpm test`（标准并发） | **本机 1 个文件 4 例超时失败**：`test/auto-practice/af073-batch-report-cli.spec.ts` 的 4 个 CLI 用例各自 `spawnSync` 30s 超时返回 `status=null`（5139 passed / 4 failed / 4 skipped，792s）。同 3 个失败文件单独复跑 **48 passed / 0 failed**（`af073` 4 例、`wp12` 40 例、`crud.service` 4 例）。改动不触碰 `bin/batch-report.ts` 与 `test/`，失败原因是本机 363 并发 worker 下冷启动超过用例内置 30s 上限。 |
| `pnpm exec vitest run --exclude "**/e2e/**/*.ts" --no-file-parallelism` | **exit 0；362 passed / 1 skipped 文件，5143 passed / 4 skipped 用例，3586.86s**。全量用例在同一轮内无失败，确认标准并发下的 4 例失败是冷启动抖动，不是代码回归。 |

补充复核：`--maxWorkers=64` 下仍出现 `af073` 4 例与 `wp12`、`crud.service` 各 1 例超时（5 failed / 5134 passed），单独复跑全部通过；进一步确认是并发/冷启动抖动。

## 五、偏差与边界

1. **任务单 artifacts 路径仍写 `af572-quality-scripts-lint-2026-11-27.md`**：AF-573 由 AF-572 任务单复制重签发，登记时未改该路径；本交付记录按实际任务号落为 `af573-...md`，任务单本体未改（登记后不改任务单）。
2. **`pnpm test` 标准并发下未全绿，改用单文件串行跑全量取得全绿**：标准并发下失败集中在本机 363 worker 冷启动超时，隔离复跑与 `--no-file-parallelism` 全量复跑均为 0 失败；测试超时值属 `test/` 范围，本单 out-of-scope，未改。
3. **未新增类型工程**：按任务单约束复用既有 `scripts/**/*.ts` disableTypeChecked 段，因此 quality 脚本仍不做 type-aware 检查。
4. **未改脚本业务行为**：所有复杂度拆分均为等价抽取，输出顺序、字段、阈值、CLI 参数保持原样；`af448` 的 `dirFlag` 判断由 `>= 0` 自动改为 `=== -1` 分支，因 `indexOf` 仅返回 -1 或非负，语义等价。

## 六、机读字段

| 字段 | 内容 |
| --- | --- |
| taskId | AF-573 |
| contextId | phase2.5-toolchain |
| type | fix |
| agentRole | orchestrator |
| baselineRef | 400d4c483e2df4f82d9a73bb2b829351b3f1118e |
| priorTasks | AF-572 |
| scopeCheck | in-scope |
| reviewVerdict | conditional-pass |
| filesChanged | 7（package.json + 6 个 quality TS 脚本） |
| lintBaseline | 185 errors / 4 warnings（14 files，120 auto-fixable） |
| lintFinal | 0 errors / 0 warnings |
