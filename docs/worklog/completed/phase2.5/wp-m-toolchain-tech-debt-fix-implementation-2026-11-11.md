# WP-M · 工程工具链技术债治本修复 — 交付记录

> **状态：✅ 已完成（M-3 / M-4）**
> 日期：2026-11-11
> 执行方：MiniMax Code
> 仓库：`E:\Work\Project\backend\mofang-nestjs` · 分支 `integrate` · HEAD `2216845`
> 任务单：[wp-m-toolchain-tech-debt-fix-2026-11-11.md](wp-m-toolchain-tech-debt-fix-2026-11-11.md)
> 技术债清单（单一事实源）：[phase2.5-toolchain-tech-debt-2026-11-11.md](../../pending/phase2.5-toolchain-tech-debt-2026-11-11.md)

---

## 1. 一句话总结

M-3 把 `scripts/` 下 5 个历史文件的 67 个存量 lint 问题（65 error + 2 warning）清到 **0 error 0 warning**，其中 `visitor-quality-audit.ts` 的两个超复杂度函数（`auditSession` 49/53、`main` 53/91）拆成 13 个纯函数且**审计报告输出逐字节一致**（前后 SHA256 相同、0 行差异）；M-4 采取**维持现状**——不新增 `scripts/tsconfig.json`，并把「scripts 不在任何 tsconfig」写成本单**已知并接受**项（附实测证据）。

> M-1 / M-2 已由 D 主控完成，本单**未重做、未做性能复测**，仅引用 commit：
>
> - M-1（删 husky 旧格式两行）→ commit `666b0a8`
> - M-2（裸 npx commitlint → 纯 shell 正则校验）→ commit `fc9285c`

---

## 2. 方案设计

### 2.1 M-3 · scripts 存量 lint 全清

**任务单原方案**：先 `eslint --fix` 吃掉 41 个可自动修复项，剩余手工修；`auditSession` / `main` 拆分，行为与输出口径不变。

**实际做法**（与原方案一致，仅问题数实测比任务单预估多）：

| 阶段     | 动作                                       | 结果                                                                                       |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 基线     | `pnpm exec eslint "scripts/**/*.ts"`       | exit **1**，**65 error + 2 warning = 67**（任务单预估「41 个可自动修复」实测为 **50 个**） |
| 自动修复 | `pnpm exec eslint --fix "scripts/**/*.ts"` | 吃掉 **50/67**，剩 17 个需手工                                                             |
| 手工修复 | 见 `2.1.1 ~ `2.1.5                         | 17 个全清                                                                                  |
| 终态     | `pnpm exec eslint "scripts/**/*.ts"`       | exit **0**，**0 error 0 warning**                                                          |

#### 2.1.1 `scripts/eval-runner.ts`（+17 / −10）

| 问题                                           | 处理                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unicorn/import-style`（`node:path` 具名导入） | 改默认导入 `import path from 'node:path'`，调用点同步改 `path.join` / `path.resolve`                                                                                                                                                                                                                                                             |
| `unicorn/no-exports-in-scripts` × 3            | `loadPreviousReport` / `main` 去掉 `export`（grep 全仓确认**无外部消费者**，仅本文件内部调用）；**`parseEvalCliArgs` 保留 `export`** 并加**文件内** `// eslint-disable-next-line unicorn/no-exports-in-scripts` + 原因注释（它被 `test/engine-adapters/eval/eval.runner.spec.ts` 直接 import，属测试消费面，去 export 会连带改测试断言——超红线） |
| `sonarjs/no-nested-conditional`（三元套三元）  | 把基线对比文案抽成 `deltaSign` + `baselineText` 两步，消掉嵌套三元，**输出字符串逐字不变**                                                                                                                                                                                                                                                       |
| `unicorn/no-array-sort`                        | `.sort()` → `.toSorted()`（就地排序改非变异版，语义等价且更安全）                                                                                                                                                                                                                                                                                |

#### 2.1.2 `scripts/ops/calibration/stagnation-calibration.ts`（+2 / −7）

仅 `import/order` + `prettier/prettier` 格式调整，**零逻辑变更**。⚠️ 该文件存在 **2 个既有（非本次引入）** 类型错误，见 `7 遗留项。

#### 2.1.3 `scripts/ops/quality/seed-verbal-voice.ts`（+27 / −20）

| 问题                                        | 处理                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sonarjs/no-hardcoded-ip`（`117.72.30.78`） | **不是误报**——`grep .env` 确认 `DB_HOST=117.72.30.78`，是真实 dev 库主机。按任务单要求改为 `host: process.env.DB_HOST`，**不留裸 IP**，并加注释说明 dotenv 已在文件头加载 |
| `unicorn/no-process-exit`                   | `process.exit(1)` → `process.exitCode = 1`，与仓库既有先例 `scripts/ops/quality/enqueue-p4-batch.ts`（commit `401a5a2` 已同款改造）一致                                   |
| `@typescript-eslint/array-type` × 2         | `Array<T>` → `T[]`                                                                                                                                                        |
| `prettier/prettier` × 多                    | 长文案换行格式化，**文案字符串内容一字未改**                                                                                                                              |

#### 2.1.4 `scripts/ops/quality/visitor-quality-audit.ts`（+415 / −180）

**主战场**。超标函数拆分方案（**全部为「抽纯函数」而非「重写逻辑」**，保证口径不变）：

| 原函数         | complexity / cognitive | 拆出                                                                                                                                                         |
| -------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auditSession` | 49 / 37                | `deriveTraceSignals` · `deriveTextSignals` · `deriveRepeatRates` · `readKernelEndState`                                                                      |
| `main`         | 53 / 91                | `auditAll` · `groupByCharacter` · `reportD1` ~ `reportD5` · `printAnxiousGroup` · `buildOwnGrams` · `centroidExcluding` · `nearestCentroid` · `exportAnchor` |

另有 `unicorn/no-array-sort` × 5（含 `median` 内）→ `.toSorted()`；`@typescript-eslint/array-type` × 3、`unicorn/prefer-set-has` × 2、`unicorn/no-negated-condition` × 2、`unicorn/consistent-existence-index-check` × 3 由 `--fix` 自动处理。

#### 2.1.5 `scripts/ops/quality/visitor-quality-lexicon.ts`（+192 / −7）

**红线文件**。仅 `max-len` × 5 + `prettier/prettier` × 5 的换行/缩进格式化，**词表字符串内容零改动**（`5 有机械验证）。

### 2.2 M-4 · 「scripts 不在任何 tsconfig」的处置 → **维持现状（已知并接受）**

**结论：不新增 `scripts/tsconfig.json`。** 这是任务单明确允许的二选一之一（「维持现状是可接受选择，不必为了做而做」）。

**实测证据**（用临时 `eslint.probe.config.mjs` 强制开启类型感知规则 + `projectService: true`，跑完即删，未留任何残留文件）：

| 场景                                                                        | 结果                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **无** `scripts/tsconfig.json`                                              | `Parsing error: ... was not found by the project service`（`visitor-quality-audit.ts` / `seed-verbal-voice.ts`），exit 1 —— 证实 scripts **确实不在任何 tsconfig project 内**                                                                                                                                                                             |
| **有** `scripts/tsconfig.json`                                              | 类型感知规则跑通，exit 0 —— 证实 eslint project service **只认名为 `tsconfig.json` 的文件**（`tsconfig.ide.json` 这类名字不被识别，所以「仅供 IDE 用、project service 不读」的原设想不成立）                                                                                                                                                              |
| **有** `scripts/tsconfig.json` 时跑 `tsc -p scripts/tsconfig.json --noEmit` | **2 个既有错误**（非本次引入）：`stagnation-calibration.ts(25,27)` / `(25,51)` → `TS2459: Module '../../../src/auto-practice/practice-runner.service.js' declares 'CrisisWindowState' / 'StagnationState' locally, but it is not exported`（这两个 interface 在 `src/auto-practice/practice-runner.service.ts:165` 与 `:1070` 处**声明时没写 `export`**） |

**为什么维持现状（而不是「加个 tsconfig 显得更规范」）**：

1. **类型检查面已被 `disableTypeChecked` override 兜住** —— `eslint.config.mjs` 里 `files: ['scripts/**/*.ts']` 已 `extends: [tseslint.configs.disableTypeChecked]`，类型感知 lint 对 scripts 本就不生效，这不是缺口。
2. **scripts 本就 transpile-only** —— `tsx` 直跑、不进 build（`tsconfig.build.json` 的 `rootDir=src` 且 `exclude: ['bin/**/*']`），给它们加 tsconfig 会让 project service **开始对它们做类型检查**，立刻把上表那 2 个**既有** `TS2459` 顶出来——等于凭空开一个「一开就红」的类型检查面，**不增加任何 lint 价值**。
3. **修那 2 个 `TS2459` 要动 `src/` 业务代码的导出**，超出本单红线（不动 `src/` 业务代码），故记为遗留项（`7）。
4. **`scripts/tsconfig.json` 若要存在还必须 `include` `../typings/global.d.ts`** —— 否则 `src/` 侧文件会连环爆 `TS4111`（实测 20+ 条）；这条细节一并记录，避免将来有人踩。

**因此本单把「scripts 不在任何 tsconfig」记为：已知并接受。**

---

## 3. 改动文件清单

| 文件                                                | 增/删       | 一句话用途                                                                                                                               |
| --------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/eval-runner.ts`                            | +17 / −10   | 导入风格规范化、去掉两个内部函数的 `export`、保留测试消费的 `parseEvalCliArgs` 导出并加行内豁免、拆掉嵌套三元、`.sort()` → `.toSorted()` |
| `scripts/ops/calibration/stagnation-calibration.ts` | +2 / −7     | 仅 `import/order` + prettier 格式，零逻辑变更                                                                                            |
| `scripts/ops/quality/seed-verbal-voice.ts`          | +27 / −20   | 裸 dev IP → `process.env.DB_HOST`、`process.exit(1)` → `process.exitCode = 1`、`Array<T>` → `T[]`、prettier 换行                         |
| `scripts/ops/quality/visitor-quality-audit.ts`      | +415 / −180 | 拆分 `auditSession` / `main` 两个超复杂度函数为 13 个纯函数 + 5 处 `.toSorted()` 等自动修复                                              |
| `scripts/ops/quality/visitor-quality-lexicon.ts`    | +192 / −7   | **仅格式化**，词表字符串内容零改动                                                                                                       |

合计：**5 files changed, 653 insertions(+), 224 deletions(-)**

---

## 4. 闸门表（真实命令 / exit code / 真实数字）

| #   | 闸门             | 命令                                                                                   | exit code | 真实数字                                                                                                                                             |
| --- | ---------------- | -------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | scripts lint     | `pnpm exec eslint "scripts/**/*.ts"`                                                   | **0**     | **0 error 0 warning**（基线为 exit 1 / 65 error + 2 warning）                                                                                        |
| 2   | 词表单测         | `pnpm exec vitest run test/quality/p1d-visitor-quality-lexicon.spec.ts`                | **0**     | 1 file / **15 tests 全绿**（证明词表内容未被改）                                                                                                     |
| 3   | eval runner 单测 | `pnpm exec vitest run test/engine-adapters/eval/eval.runner.spec.ts`                   | **0**     | 1 file / **12 tests 全绿**（证明 `parseEvalCliArgs` 的 export 仍可被测试消费）                                                                       |
| 4   | 全量单测         | `pnpm test`                                                                            | **0**     | **Test Files 177 passed \| 1 skipped (178)**；**Tests 2892 passed \| 4 skipped (2896)**；Duration 116.66 s                                           |
| 5   | 主 lint          | `pnpm lint`                                                                            | **0**     | **0 error**（2 条既有 `import/order` warning，位于 `src/auto-practice/metrics/batch-metrics.service.ts`，非本单引入；冷缓存下耗时 >300 s，故后台跑） |
| 6   | 类型             | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                        | **0**     | **0 error**                                                                                                                                          |
| 7   | engine-core 边界 | `git diff --stat HEAD -- src/engine-core`                                              | —         | **空**（未触碰内核）                                                                                                                                 |
| 8   | src/test 边界    | `git diff --stat HEAD -- src/ test/`                                                   | —         | **空**（未碰业务代码与测试断言）                                                                                                                     |
| 9   | 审计输出一致性   | `pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/debug-sessions` | **0**     | 前后 **SHA256 相同**、**0 行差异**（详见 `5）                                                                                                        |

### 4.1 运行时冒烟（改完实际跑过，非静态推断）

| 脚本                                                                                            | exit  | 结果                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/debug-sessions`          | **0** | 报告正常产出，输出与基线逐字节一致                                                                                   |
| `pnpm exec tsx scripts/eval-runner.ts --mode offline --dataset synthetic-supervisor-v1 --out -` | **0** | 摘要正常打印（触发质量 / 建议质量 / 基线对比 / 数据质量 / 运行统计各行齐全）                                         |
| `pnpm exec tsx scripts/ops/calibration/stagnation-calibration.ts`                               | **0** | 口径输出正常                                                                                                         |
| `seed-verbal-voice.ts`（`DB_HOST=127.0.0.1 DB_PORT=1`）                                         | **1** | 证实 `DB_HOST` **确实从 env 读取**（改前写死 IP 连不到本机端口 1）；在**任何 UPDATE 之前**就失败，**未产生 DB 写入** |

---

## 5. 口径一致性对比（审计脚本重构前后逐字节）

`visitor-quality-audit.ts` 的产出是审计报告，数值口径不能变，因此做**双份输出 + 哈希比对**：

| 项                        | 重构前                                                             | 重构后                                                             |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| SHA256                    | `9F7D99230DD4160F192A201C9A1FD2D190B4430C9F005DC57D8C1888336397CA` | `9F7D99230DD4160F192A201C9A1FD2D190B4430C9F005DC57D8C1888336397CA` |
| 行数                      | 55                                                                 | 55                                                                 |
| `Compare-Object` 差异行数 | —                                                                  | **0**                                                              |

复算命令：

```powershell
$before = Join-Path $env:TEMP 'wp-m-audit-before.txt'
$after  = Join-Path $env:TEMP 'wp-m-audit-after.txt'
pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/debug-sessions 2>$null |
  Out-File -FilePath $after -Encoding utf8
Compare-Object (Get-Content $before) (Get-Content $after) -SyncWindow 5   # → 无输出 = 完全一致
(Get-FileHash $before -Algorithm SHA256).Hash
(Get-FileHash $after  -Algorithm SHA256).Hash
```

**词表零改动机械验证**（`visitor-quality-lexicon.ts`）：

```
before=186 after=186 identical=true
```

即：改动前后从源文件抽取的 **186 个单引号字符串字面量序列完全相同**（逐字符、逐顺序），差异仅存在于换行/缩进。

---

## 6. 风险与回归

| 风险点                                                                         | 结论                   | 依据                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 审计报告口径漂移                                                               | **无风险**             | 重构前后输出 SHA256 相同、0 行差异（`5）                                                                                                                                                                             |
| 词表内容漂移（连带动 `test/quality/p1d-visitor-quality-lexicon.spec.ts` 失败） | **无风险**             | 186 个字符串字面量逐字一致 + 该单测 15/15 绿                                                                                                                                                                         |
| engine-core 分层红线                                                           | **未触碰**             | `git diff --stat HEAD -- src/engine-core` 为空                                                                                                                                                                       |
| 业务代码 / 测试断言被误改                                                      | **未触碰**             | `git diff --stat HEAD -- src/ test/` 为空                                                                                                                                                                            |
| 全局 eslint 配置被放宽                                                         | **未放宽**             | `eslint.config.mjs` 本单**零改动**；唯一的规则豁免是 `scripts/eval-runner.ts` 里 1 行**文件内** `eslint-disable-next-line unicorn/no-exports-in-scripts` + 原因注释（符合任务单「只允许文件内豁免 + 注释说明原因」） |
| 新增依赖                                                                       | **无**                 | `package.json` 本单零改动                                                                                                                                                                                            |
| `package.json` 的 lint 范围被改成含 `scripts/`                                 | **未改**               | 保持 `"{src,test,bin}/**/*.ts"`，日常 lint 速度不受影响                                                                                                                                                              |
| 隐私红线（心理原文进日志）                                                     | **未触碰**             | 本单只做 lint 清理与函数拆分，审计脚本仍只输出计数与布尔，不打印逐字稿内容                                                                                                                                           |
| `seed-verbal-voice.ts` 改读 env 后连不上库                                     | **行为已对齐本机配置** | `.env` 已有 `DB_HOST=117.72.30.78`，与改前写死值一致；未设 `DB_HOST` 时 `mysql2` 会走默认 host（localhost），属合理降级                                                                                              |

---

## 7. 遗留项与建议人工复核

1. **`scripts/ops/calibration/stagnation-calibration.ts` 的 2 个既有 `TS2459`（非本单引入，未修）**
   `stagnation-calibration.ts:25` 从 `src/auto-practice/practice-runner.service.js` 类型导入 `CrisisWindowState` / `StagnationState`，但这两个 interface 在 `src/auto-practice/practice-runner.service.ts:165` / `:1070` **声明时没写 `export`**。已用 `git show HEAD:` 核对确认为**改动前就存在**。
   - **为什么不修**：修它必须改 `src/` 业务代码的导出（动业务层 API 面），超出本单红线。
   - **为什么没暴露**：scripts 是 transpile-only（不进 `tsconfig.build.json`，也不在任何 tsconfig project 内），类型错误一直被隐藏。
   - **建议**：单独开一个小任务，给这两个 interface 补 `export`（纯增量、不改行为），或在 `src/` 侧建一个类型聚合出口。

2. **`pnpm lint` 剩 2 条既有 `import/order` warning**（`src/auto-practice/metrics/batch-metrics.service.ts`）
   非本单引入、本单也未改 `src/`，故未处理。可留待下次动该文件时顺手清。

3. **`scripts/` 不在 `package.json` 的 lint 范围内**（按任务单要求**不改**）
   所以日常 `pnpm lint` 不查 scripts，仍靠 lint-staged 对**暂存的** .ts 触发。本次已清零，scripts 改动不再被存量问题阻塞。

4. **`scripts/tsconfig.json` 的两处坑（留给将来真要加的人）**
   - eslint project service **只认文件名恰好是 `tsconfig.json`** 的文件，`tsconfig.ide.json` 不会被识别；
   - 一旦加，必须 `include` `../typings/global.d.ts`，否则 `src/` 侧文件连环爆 `TS4111`（实测 20+ 条）。

5. **建议人工复核**
   - `visitor-quality-audit.ts` 拆出的 13 个辅助函数目前**无独立单测**，靠「端到端输出逐字节一致」兜底。若后续还要动这个脚本，建议补一组针对 `deriveTraceSignals` / `deriveTextSignals` 的快照单测，把口径锁死。
   - `seed-verbal-voice.ts` 现在**完全依赖环境变量**提供 `DB_HOST`。在没加载 `.env` 的 shell 里直接跑会连 localhost。建议将来在脚本入口加一句 `DB_HOST` 缺失时的显式报错（本次未加，因超出 lint 清理范围）。

6. **不在本单范围**（供大炮知悉）
   `git status` 中 `admin-dashboard/` 下的 Vue3 改动（`components.d.ts` / `src/App.vue` / `src/api/*` / `src/i18n/locales/*` / `src/router/index.ts` / 新增 `src/components/Batch*.vue` 等）来自**并行的另一个 AI 进程**，不是本单产物；本单**未 stage、未 revert、未提交**它们。

---

## 8. 回写清单

| 项                  | 位置                                                                                                                               | 状态        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 交付记录            | `docs/worklog/completed/phase2.5/wp-m-toolchain-tech-debt-fix-implementation-2026-11-11.md`（本文件）                              | ✅          |
| 任务单迁移          | `docs/worklog/pending/wp-m-toolchain-tech-debt-fix-2026-11-11.md` → `docs/worklog/completed/phase2.5/`，顶部状态改 ✅ 并链接本记录 | ✅          |
| WP 登记表           | `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` 本任务行                                                                     | ✅          |
| 阶段入口            | `docs/worklog/pending/phase2.5-README.md` `3.0                                                                                     | ✅          |
| 技术债清单          | `docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md` TD-1 / TD-2 / TD-3 逐条标状态                                    | ✅          |
| commit message 草稿 | 给大炮，不自动 commit / push                                                                                                       | ✅（见 `9） |

---

## 9. commit message 草稿

```
fix(toolchain): clear scripts lint debt and document tsconfig disposition (M-3/M-4)
```

> 本单**未执行** `git commit` / `git push`，等大炮指令。
> 注意：仓库里同时存在**另一个 AI 进程**对 `admin-dashboard/` 的未提交改动，提交时建议**只 stage** 本单的 5 个 `scripts/*.ts` 与本单的 docs 文件。
