TD-7 契约漂移残留收尾单已完成并归档。三条残留全部处置，**生产 `src/` 零改动**、**engine-core 源码零 diff**、**零运行时行为变化**、**用例数量与基线逐字一致**。最直接的收益：**lint 从 HEAD 既存的 2 warning 清到 0 warning**。

## 一、三条处置结论

| #   | 残留项                                    | 处置                                                                                                               | 落地文件                                                     |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| B-1 | 3 处局部角色行 builder 未纳入共享 builder | 改调 `buildCharacterProfileRow()`，**行构造处 `as CharacterProfileEntity` 断言全部消除**；缺列由夹具按实体口径补齐 | `wp10a` / `wp49` / `wp51` 三个 spec                          |
| B-2 | wp-list §四 三行超列 + 引言行数过期       | **方向 A**：TD-5 / L-2 / G-4 三行折叠回 **3 列**（竖线数 6→4），表头不动；引言「25 行」→ 实测 **35 行**            | `phase2.5-wp-list-2026-11-08.md`                             |
| B-3 | 2 处失效 `prettier/prettier` disable      | **分支 1（unused directive）**：`knowledge-search` 保留 `import/order` 只移除失效规则名，`privacy-guard` 整行删除  | `knowledge-search.e2e-spec.ts` / `privacy-guard.e2e-spec.ts` |

## 二、B-1 明细

**wp49 / wp51 的 `makeRow()`**：各自传入 11 项覆盖列（`templateId: 'vpt_x'`、6 个基线数值 + `baselineSafety: 0.25` / `baselineBond: 0.05`、`auditStatus: 'approved'`、`createdAt` / `updatedAt`）。`auditStatus` 原值 `'approved'` 与夹具默认 `'draft'` 不同 —— 按任务单要求**显式传入 overrides**，不让默认值漂进用例语义。

**wp10a 的 ⑬ 用例内联行**：保留为直接调用共享夹具（该行只在一处使用，抽局部 builder 反而多一层间接）。传入 16 项覆盖列，其中**表达风格三列 `speechVolumeBaseline: 0.5` / `narrativeStyle: 'mixed'` / `expressionTone: 'restrained'` 与夹具默认同值**，故不重复铺陈 —— 而该用例的断言正是这 3 列的值，结果不变。

**去断言后暴露的真实类型不匹配（已修正）**：seed 的集合列是 **readonly 数组**（`CharacterProfileSeed.coreBeliefs: readonly {...}[]`），实体列是**可变数组**（`CharacterProfileEntity.coreBeliefs: CoreBelief[]`）—— 这个不兼容原先被 `as` 断言掩盖，去掉断言后立刻变成 TS 报错。处置**照抄 TD-6 已落地的 wp9b 同款写法**：`coreBeliefs` / `underlyingDesires` 走 `.map()` 复制，`forbiddenBehaviors` / `sensitiveTopics` 走 `[...]` 展开。这是把掩盖显性化并修正，不是新增行为 —— 复制的是同一个 seed 的同值副本。

**缺列补齐的逐列行为复核（与 backlog B-1 论证一致）**：`versionMajor/Minor/Patch`（resolver 不读）；`personalityTraits`（`== null` 同分支）；`verbalVoice`（同为 falsy）；`baselineSafety: 0.5` / `baselineBond: 0`（与内核 `DEFAULT_SAFETY` / `DEFAULT_BOND` 同值）—— **全部等值，零行为变化**。

`toCharacterSeed(row) as unknown as Record<string, unknown>` 是对**映射输出**的断言（不是行构造），按任务单 §3.1 第 4 条保持原样。

## 三、B-2 明细

折叠规则：第 1 列保持 `**TD-5**` / `**L-2**` / `**G-4**`；原第 2 列（描述）与原第 3 列（优先级）合并为新第 2 列（`·` 分隔）；原第 4 列（说明）与原第 5 列（交付态）合并为新第 3 列。**三行的全部文字与相对链接逐字保留**，只是从 5 个单元格挪进 3 个 —— Markdown 渲染时被丢弃的第 4、5 列内容**现在可见了**（TD-5 行的完整闸门摘要与任务单 / 交付记录链接不再消失）。

**实测复核**：§四 表格共 **37** 行 = 表头 1 + 分隔 1 + **数据 35**；竖线数**全部为 4**（3 列），**超列行 0 条**（折叠前是 34 条 4 竖线 + 3 条 6 竖线）。引言行数改为实测的 **35**。

## 四、B-3 明细

**动手前先跑 lint 拿真实文案**（不凭印象改）：两条都是 `Unused eslint-disable directive (no problems were reported from 'prettier/prettier')` → 判别为**分支 1**，不是分支 2。

**连带处理**：`privacy-guard` 整行删除后首行留下一个空行，prettier 报 `1:1 error Delete ⏎` —— 这正是分支 2 描述的情形（移除 directive 后暴露真实违规）。处置是**只删那一个空行**，**不跑 `prettier --write` 全文**，避免无关格式重排。

**未改配置**：`eslint.config.mjs` 一字未动；两个 e2e 文件的用例逻辑、断言、mock 一行未动，用例数与 HEAD 逐字一致（`knowledge-search` 4 describe / 4 it；`privacy-guard` 5 describe / 8 it）。

## 五、闸门

| 闸门                                                                 | exit                 | 结果                                                                                                                                                                                 |
| -------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 根 tsc `tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0                    | **0 error**                                                                                                                                                                          |
| build tsc `tsc -p tsconfig.build.json --noEmit`                      | 0                    | **0 error**                                                                                                                                                                          |
| `pnpm lint`                                                          | 0                    | **0 error / 0 warning**（基线 2 warning → **清零**）                                                                                                                                 |
| `vitest run test/engine-core/boundary.spec.ts`                       | 0                    | **12 passed / 12**                                                                                                                                                                   |
| `vitest run test/engine-core`                                        | 0                    | **23 文件 / 461 例全绿**                                                                                                                                                             |
| 定向 `wp10a` + `wp49` + `wp51`                                       | 0                    | **3 文件 / 55 例全绿**，用例数与改动前一致                                                                                                                                           |
| `pnpm test` 全量（跑了 4 次）                                        | 0（3 次）／1（1 次） | 4 次中 **3 次全绿**（**193 passed \| 1 skipped（194 文件）· 3248 passed \| 4 skipped（3252 例）**，0 failed），墙钟 81.4s / 73.9s / 82.2s；**1 次偶发 1 例失败**，已复核归属（见下） |
| `git diff --stat HEAD -- src/engine-core`                            | 0                    | **空输出**                                                                                                                                                                           |
| `git diff --name-only HEAD`                                          | 0                    | **8 个已跟踪文件**：3 spec + 2 e2e + 3 docs；**生产 `src/` 零改动**                                                                                                                  |
| `pnpm doctor:fs`                                                     | 0                    | 均值 **0.09 ms/文件**，判定「读取延迟正常，闸门数字可信」                                                                                                                            |

**关于那次偶发失败（未静默跳过）**：全量第 3 次出现 `1 failed | 3247 passed`（exit 1）。做了三步复核 —— ① 第 4 次全量全绿，4 次里 3 次绿；② 落盘后全日志**无任何 `AssertionError` / `expected ... to be` / `❯ ... failed` 痕迹**，属时序型而非断言值不符；③ 本单触碰的 3 个 spec 在全量里始终全绿（定向 55 例全绿），与本单无关的 `debug-session-persistence` + `wp21-report-stream` 两个时序敏感文件单跑 41 例全绿，且**本单的两个 e2e 文件不在默认全量内**（`test/e2e/` 需 `test/vitest.e2e.mts` 单独配置才收集）。**归属为仓库既有的时序 flaky**（与 `docs/worklog/completed/phase1/` 多份交付记录的同类记述一致），与本单改动无因果关系，处置为「如实记录 + 复跑取证」，没有改任何 spec 断言去迎合它。

**机器状态**：Windows 11 Home China（10.0.26300 build 26300）· Node **v26.13.0** · pnpm **9.15.0** · PS 5.1.26100.9818 · 8 逻辑核。跑闸门期间有**用户侧的并行 `pnpm start:dev` / `nest start --watch` / `dist/app`**（起于 17:42:58，**非本单启动**，本单全程未执行任何 dev / start 命令），这是首次全量墙钟偏慢的原因；`doctor:fs` 判定读取延迟正常，排除读税因素。

## 六、改动面

**测试 3 spec**（B-1）：`wp10a` / `wp49` / `wp51` —— 行构造改调共享夹具 + 去 `as` 断言 + sibling import 前置（满足 `import/order`）。

**e2e 2 文件**（B-3）：两个文件各改文件头注释。

**docs 3 文件**：wp-list（B-2 + TD-7 索引行）、README（TD-7 索引行）、契约漂移 backlog（三条标记闭环）。

`git diff --stat HEAD` = **8 files changed, +36 −73**（净减 37 行 —— 三处局部 builder 被共享夹具取代，重复字面量消失）。**未新增测试文件、未新增 helper、未改依赖、未改任何配置文件**。

## 七、交付物

- 交付记录：`docs/worklog/completed/phase2.5/td7-contract-drift-remediation-implementation-2026-11-13.md`
- 任务单（已归档 ✅、**DoD 7/7 全勾**）：`docs/worklog/completed/phase2.5/td7-contract-drift-remediation-task-2026-11-13.md`
- 索引回写：`phase2.5-wp-list-2026-11-08.md`（TD-7 行 3 列）、`phase2.5-README.md`（TD-7 行 2 列）
- backlog 闭环：`phase2.5-contract-drift-backlog-2026-11-13.md`（B-1 / B-2 / B-3 三条标 ✅ 已处置，状态改「✅ 已闭环」）

**断链复查**：5 个文档共 **199 条相对链接全部可达，零断链**；wp-list §四 全表 37 行统一 4 竖线、backlog 表格 6 列统一（7 竖线）、任务单 DoD 7/7、无 `- [ ]` 残留、无空单元格。

## 八、commit 草稿（未提交，等你指令）

```
refactor(test,docs): TD-7 收尾契约漂移残留（3 处角色行复用共享 builder · wp-list 表格列数对齐 · e2e 失效 disable 清理，零运行时变化）
docs(worklog): TD-7 任务单 / 交付记录与索引回写
```

建议分 2 个提交（一个提交一个意图，不跳 `--no-verify`）。**注意**：wp-list 与 README 在本单开工前已是「已修改」状态 —— 那是 TD-6 的索引回写尚未提交（TD-6 只提交了代码那一组），docs 一组提交时会一并带上 TD-6 的索引回写。

## 九、未做的事（留给你决定）

1. **未提交、未 push** —— 只给草稿，等你手动提交。
2. **未动 §3.4 排除项**：两处 `StubRepo.create` 的 `{ ...entity } as Entity` 断言（`wp38-character-version-semver.spec.ts:61`、`wp9b-character-admin.spec.ts:57`）按任务单保持现状 —— 那是仓储 Stub 的 `Partial<Entity> → Entity` 签名适配惯用法，不是行夹具漂移源，已在交付记录 §八列为观察项。
3. **未改 `eslint.config.mjs`** —— B-3 只处理两处文件头 directive。
4. **未跑 e2e** —— `test/e2e/` 依赖 DB / Qdrant，且不在默认全量内，不在本单闸门范围。
5. **未发现新契约缺陷** —— B-1 去断言后根 tsc 0 error（三处夹具与实体口径已对齐）、B-2 折叠后全表列数一致、B-3 清理后 lint 0 warning，故无需新开 backlog。
