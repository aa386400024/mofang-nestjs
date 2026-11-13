# G-4 · 规则轨词表子串重叠量级离线取证 · 交付回复

> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `399b6af`｜执行：MiniMax Code｜回复完成：2026-11-13 11:42 (GMT+8)
> 任务单：`docs/worklog/pending/phase2.5-g4-lexicon-substring-overlap-evidence-task-2026-11-13.md`（已归档至 `completed/phase2.5/`）
> 交付物：1 个只读复算脚本 + 取证结论交付记录 + 4 处文档回写；**core / adapter / 业务层 / 前端 / `.env.example` / `test` 零改动**。

## 0. 一句话结论

**机制成立、量级接近不可见**：静态穷举确认跨规则子串包含对**仅 1 对**（`open_probe.「你觉得呢」` ⊃ `empathy.「你觉得」`，同规则 0 对），但该双命中在归档 **646 场 / 18592 有效轮**里**只触发 3 轮（占 0.0161%）**，全部落在 baseline 目录且全部非退化（小满 2 轮 + 亦舟 1 轮）；§3.3 要求的「重叠对组 vs empathy 单命中组」群体对照因 **n=3 < `--min-samples` 20 → 样本不足 · 不出结论**（不强行给点值），量级改用**上界**报告：重叠对轮 trust 增量合计占全库正向 trust 累计的 **0.4016%**。

## 1. 已决口径复核（4 条）

| #   | 已决口径                                              | 复核结论                                                                                                       |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | 主控静态穷举跨规则子串对仅此 1 对                     | **复现一致**：按真相源 **9 条**规则全量穷举 → 跨规则 **1 对**、同规则 **0 对**（规则条数口径差异见 §3 偏差 1） |
| 2   | 归因走群体分布对照，不做逐事件分量分解                | **逐字照做**：只做分组分布对照（中位 + P25/P75），不反推单事件分量                                             |
| 3   | 种子向量仅作静态参照，不复制 DELTA_TABLE 进运行时复算 | **逐字照做**：`SEED_REFERENCE` 仅 3 条，只进「静态种子参照」表，不参与任何归档计算                             |
| 4   | lineage 未传则不按模式分层                            | **逐字照做**：默认不按 `counselorModeId` 分层；`--lineage` 已实现并试跑（命中 0 轮，见偏差 4）                 |

## 2. 取证结论

### 2.1 静态穷举（§3.1）

- 真相源规则条数 **9** · 内置静态声明 **9** 条 · 运行期逐条比对：**一致**（词表漂移即报错退出，不静默用旧副本）；
- **跨规则子串包含对 1 对**：`open_probe · 你觉得呢` ⊃ `empathy · 你觉得`；**同规则 0 对**。

### 2.2 频次分布（§3.2 · 归档事实）

| 分组                               | 轮数  | 占有效轮    | 备注                           |
| ---------------------------------- | ----- | ----------- | ------------------------------ |
| **重叠对轮（empathy+open_probe）** | **3** | **0.0161%** | 与子串重叠对口径一致的双命中轮 |
| 其他多事件轮（非重叠所致）         | 61    | 0.3281%     | 真实双事件，不计入重叠归因     |
| 单事件 · empathy                   | 801   | 4.3083%     | 主对照组                       |
| 单事件 · open_probe                | 7     | 0.0377%     | 次对照组（样本偏少）           |
| 单事件 · acceptance                | 453   | 2.4365%     | 频率最高的单事件 kind          |
| 单事件 · 其他 kind                 | 92    | 0.4948%     | —                              |
| neutral 单事件轮                   | 17175 | 92.3784%    | delta 为 ZERO                  |

**重叠对轮明细**（全在 `debug-sessions-baseline-20261109`，全部**非 degraded**）：

| 角色 | 轮次 | trust  | safety | bond   | valence |
| ---- | ---- | ------ | ------ | ------ | ------- |
| 亦舟 | 11   | 0.0900 | 0.0150 | 0.0050 | 0.1400  |
| 小满 | 15   | 0.1800 | 0.0210 | 0.0130 | 0.1400  |
| 小满 | 26   | 0.1800 | 0.0210 | 0.0130 | 0.1400  |

**其他多事件轮构成（不混入重叠归因）**：`acceptance+empathy` 46 · `empathy+preaching` 6 · `empathy+sensitive_touch` 5 · `empathy+normalization` 1 · `acceptance+minimizing` 1 · `preaching+sensitive_touch` 1 · `acceptance+empathy+preaching` 1。

### 2.3 增量群体对照（§3.3 · 群体分布口径）

单元格 = 中位 [P25~P75]，n = 有 delta 的轮数。

| 分组                                | n   | trust                  | safety                 | bond                   | verbal                    | depth                     |
| ----------------------------------- | --- | ---------------------- | ---------------------- | ---------------------- | ------------------------- | ------------------------- |
| **重叠对轮**（样本不足 · 不出结论） | 3   | 0.1800 [0.1350~0.1800] | 0.0210 [0.0180~0.0210] | 0.0130 [0.0090~0.0130] | -0.1375 [-0.1375~-0.1111] | -0.2000 [-0.2000~-0.1615] |
| 单事件 · empathy（主对照）          | 793 | 0.0800 [0.0600~0.1200] | 0.0140 [0.0100~0.0140] | 0.0100 [0.0050~0.0130] | -0.0615 [-0.1000~-0.0615] | -0.0769 [-0.1250~-0.0769] |
| 单事件 · open_probe（样本不足）     | 7   | 0.0500 [0.0300~0.0600] | 0.0070 [0.0050~0.0070] | 0.0000                 | -0.0300                   | -0.0600                   |
| 单事件 · acceptance                 | 446 | 0.0720 [0.0480~0.0960] | 0.0140                 | 0.0100                 | -0.0500                   | -0.0667                   |
| 其他多事件轮（真实双事件）          | 61  | 0.1080 [0.1080~0.2000] | 0.0200                 | 0.0130                 | -0.1077                   | -0.1385                   |
| 参照：acceptance+empathy 真实双事件 | 47  | 0.1800 [0.1080~0.2000] | 0.0280                 | 0.0200                 | -0.1077                   | -0.1500                   |

**判定**（仅样本充足组给结论）：

- 重叠对轮 vs empathy 单命中（trust 中位差）：重叠对 n=3 / empathy n=793 → **样本不足 · 不出结论**（不强行给点值）；
- 重叠对轮 vs open_probe 单命中：重叠对 n=3 / open_probe n=7 → **样本不足 · 不出结论**（两侧均不足）；
- 参照 acceptance+empathy 真实双事件 vs empathy 单命中：n=47 / n=793 → **可给结论**：trust 中位 **0.1800 vs 0.0800**，即一次**合法**双事件叠加的 trust 中位增量约 **+0.10**。这条参照给出「若重叠对高频触发，它大概会贡献多少」的量级坐标系。

### 2.4 静态种子参照（§3.4 · 仅量级参照，非实测结论）

| 事件                                      | trust      | safety     | bond       | verbal  | depth   | style   | valence | arousal | positive |
| ----------------------------------------- | ---------- | ---------- | ---------- | ------- | ------- | ------- | ------- | ------- | -------- |
| empathy（种子）                           | 0.1000     | 0.0200     | 0.0100     | -0.0300 | -0.0200 | -0.0100 | 0.0300  | -0.0200 | 0.0300   |
| open_probe（种子）                        | 0.0500     | 0.0100     | 0.0000     | -0.0200 | -0.0300 | -0.0150 | 0.0200  | 0.0200  | 0.0000   |
| **empathy + open_probe 理论相加（参照）** | **0.1500** | **0.0300** | **0.0100** | -0.0500 | -0.0500 | -0.0250 | 0.0500  | 0.0000  | 0.0300   |

> 未含角色倍率 / 人格调制 / capTurnDelta 折损 / 时序权重；**归档侧一切数值均取自 `trace.delta` 原值**。

### 2.5 量级小结（事实陈述，不作临床结论）

- 重叠对轮 **3 / 18592 = 0.0161%** 的有效轮；
- 其他多事件轮 **61 轮（0.3281%）** —— 量级是重叠对轮的 **20 倍**（真实双事件远多于重叠双计数）；
- 重叠对轮 trust 增量合计 **0.4500**；全库正向 trust 增量合计 **112.0440** → **占比 0.4016%（上界）**；
- **机制确实存在**（词表层面 1 对子串包含 + D-1 基线 spec 逐字锁定），**但在现有归档样本上的贡献量级接近不可见**。

## 3. 偏差清单（任务单 / 主控口径 vs 源码与归档，共 8 条）

| #   | 任务单口径                                                                                    | 实际做法                                                                                                                              | 理由 / 影响                                                                                                   |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | §2.1「`EVENT_LEXICON` **8 条** `EventRule`」（枚举却列了 9 个 kind）                          | 真相源实为 **9 条**规则，脚本按 9 条穷举                                                                                              | **任务单笔误**（数字 8 / 枚举 9）；穷举结论不受影响                                                           |
| 2   | §3.2-1「`eventTags` 同时含 `empathy` 与 `open_probe` 的轮次（**即由该重叠对导致的双命中**）」 | 同口径采集，但**按上界报告**，不逐轮断言因果                                                                                          | **归档不存命中词（matchedTerms）** → 文本同时含「你觉得」与另一个 open_probe 词条也会产出同样双标签           |
| 3   | §3.3「重叠对轮相对 empathy 单命中轮的增量差（中位差 + 区间）」                                | 按 **n < `--min-samples` 标「样本不足 · 不出结论」**，改用**上界占比** + **真实双事件参照组**给量级坐标系                             | 口径纪律优先：重叠对组 n=3 不足以给中位差（强行给点值即违反 §3.3）                                            |
| 4   | §2.3「模式切片须经 lineage 按 `debugSessionId` 关联」                                         | `--lineage` 已实现（认 `lineage[]` 与 `sessions[]` 两种形状）；试跑 `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json` → **命中 0 轮**   | 归档 6 目录场次**不在**该批次血缘里 → 当前归档上模式分层**不可用**（G4-L2 维持），不影响主口径                |
| 5   | §2.5 基线闸门数字（全量 3236 + 4 skipped / 3240 例 / 193 文件；类型债 401 / 87）              | HEAD `399b6af` 实测**逐字一致**                                                                                                       | 任务单数字**核实为真**，无需修正                                                                              |
| 6   | §3.5「运行前后全清单哈希，口径同 I-11」                                                       | 本单脚本内置**自描述口径**（逐文件 `relPath:size:sha256` → 再 sha256），得 `acd43052…`；**FILES 650 / BYTES 65957602 与 I-11 单一致** | I-11 单哈希是临时口径（该单脚本未内置哈希），两单 SHA256 不可逐字比；FILES / BYTES 可跨单对照，**已核对一致** |
| 7   | §5「墙钟数字须带机器状态（盘读取延迟）」                                                      | 盘读计数器本轮取到 **0.000 ms**（瞬时采样值，计数器未给出有效延迟）                                                                   | 如实登记，不虚报；I-11 单同机实测 avg 0.094 ms/read（不同采样窗口，非同一口径）                               |
| 8   | §6「报告落 `data/quality/`，该目录未被 gitignore 覆盖，提交时显式排除」                       | 与任务单描述**一致**                                                                                                                  | 无需修正；沿用 I-11 单偏差 9 处置：**提交时显式只 add 本单文件**                                              |

**未发生的偏差**：core 零改动、adapter / 业务层 / 前端 / env / test 零改动、未新增 vitest spec、不连 DB / Redis / 网络、不调模型、不读 `messages[].text`、不改词表 / 分类器 / D-1 基线 spec、归档文件零修改。

## 4. 交付物

**新增 3 个文件**：

- `scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts`（脚本；纯函数与 `main()` 分离，`import.meta.url` 守卫；仅 `node:fs`/`node:path`/`node:url`/`node:crypto`；**不 import `src/**`**；词表真相源按脚本自身位置解析并运行期逐条比对，漂移即报错退出）；
- `docs/worklog/completed/phase2.5/phase2.5-g4-lexicon-substring-overlap-evidence-implementation-2026-11-13.md`（交付记录 · 10 章）；
- `docs/worklog/completed/phase2.5/phase2.5-g4-lexicon-substring-overlap-evidence-task-2026-11-13.md`（任务单已归档；状态行改 ✅；§8 开工 checklist 8 项全勾；§7 遗留补 G4-L5~L4-L7）。

**改动 4 个既有文档（回写）**：台账 I-01 段 G-4 登记段改「已交付」+ 结论指向 · 结构债草案 §4.2 G-4 附带登记行补取证落地状态 + §6 建议顺序 D-5/G-4 行补进度 · `phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md` 的 G-4 待开工行改已交付 + 结论摘要。

**脚本输出**：`data/quality/g4-lexicon-substring-overlap-evidence.md`（167 行 / 10882 字节，**未被 gitignore 覆盖 → 提交时不 add**）。

**零改动面（`git diff --stat HEAD` 实测全空）**：`src/engine-core` / `src/engine-adapters src/auto-practice src/voice src/counselor src/ai-engine src/llm src/practice` / `src/admin-dashboard` / `.env.example` / `test` / `scripts`（除本单新增文件外）。

## 5. 闸门实测（真实命令 / exit code / 数字 / 墙钟）

| 闸门               | 命令                                                                                                                                                                                                    | exit  | 实测数字                                                                                                                | 墙钟   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| 脚本可运行         | `pnpm exec tsx scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts --dir data/archives --out data/quality/g4-lexicon-substring-overlap-evidence.md`                                            | **0** | 646 场 / 18592 轮；表 0~7 全部产出；跳过披露齐全；归档前后哈希一致                                                      | 2.18s  |
| 类型（build）      | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                                                         | **0** | 0 error                                                                                                                 | —      |
| 类型（含 spec）    | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                                                                                                                                 | **2** | **401 条 / 87 文件 = HEAD `399b6af` 实测基线逐字一致（本单新增 0 错）**                                                 | —      |
| 脚本单文件严格类型 | `pnpm exec tsc --ignoreConfig --noEmit --strict --target es2024 --module nodenext --moduleResolution nodenext --types node --skipLibCheck scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts` | **0** | 0 error（补验：根 tsconfig 的 include 不含 `scripts/**`）                                                               | —      |
| Lint               | `pnpm lint`                                                                                                                                                                                             | **0** | **0 error / 0 warning**                                                                                                 | —      |
| 脚本格式           | `pnpm exec prettier --check scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts`                                                                                                               | **0** | Prettier code style                                                                                                     | —      |
| 脚本 lint          | `pnpm exec oxlint scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts`                                                                                                                         | **0** | 0 error / 0 warning                                                                                                     | —      |
| 边界护栏           | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                                                                                                                                | **0** | **12 例全绿**                                                                                                           | 2.37s  |
| 定向测试（三路径） | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters`                                                                                                                               | **0** | **102 文件 / 1890 例**（= 基线逐字一致）                                                                                | 72.37s |
| 定向测试（四路径） | `pnpm exec vitest run test/auto-practice test/quality test/engine-core test/engine-adapters`                                                                                                            | **0** | **121 文件 / 2196 例**（= 基线逐字一致）                                                                                | 50.17s |
| 全量               | `pnpm test`                                                                                                                                                                                             | **0** | **193 文件（192 passed + 1 skipped）/ 3240 例（3236 passed + 4 skipped + 0 failed）**                                   | 97.57s |
| 六个变更面         | `git diff --stat HEAD -- src/engine-core src/engine-adapters src/auto-practice src/voice src/counselor src/ai-engine src/llm src/practice src/admin-dashboard .env.example test scripts`                | **0** | **全空**                                                                                                                | —      |
| 归档完整性         | 脚本运行前后全清单哈希 + 外部 node 同口径复核                                                                                                                                                           | **0** | `FILES=650 BYTES=65957602 SHA256=acd43052b1ec61f873267d2b86cbd355d218bbbcf6dbce2fe8f458c421ae9cda` **运行前后逐字一致** | —      |

**机器状态（2026-11-13 11:30~11:40 实测）**：Node v26.13.0 / pnpm 9.15.0 / PowerShell 5.1.26100.9818；Windows 11 Home China 10.0.26300（build 26300）；8 逻辑核（负载 25%）；内存 15.88 GB 总、5.15 GB 空闲；常驻进程 290 个（TOP5：MiniMax Code 1129 MB、Memory Compression 1025 MB、Doubao 897 MB、explorer 495 MB、Code 492 MB）；盘读 Avg. Disk sec/Read 本轮取到 **0.000 ms**（瞬时采样，计数器未给出有效延迟）；C 盘空闲 69.5 GB。无 `nest start --watch` / `vite dev` 常驻。

**关于类型债**：401 条 / 87 文件是 **HEAD `399b6af` 实测基线**，本单**未新增、未清理**任何一条（脚本不在根 tsconfig 的 include 内 → 另跑单文件严格类型检查补验）。

## 6. 遗留（本单不闭合）

**沿用任务单 §7**：G4-L1 是否消歧及选型（改词 / 分类器互斥 / 最长匹配），动规则轨口径须同步评估 D-1 基线快照 spec `:453-456` 锚 → 取证结论 + 用户拍板后另派实现单｜G4-L2 重叠对增量在 cold / expert 模式下的分层量级 → 标定 / 灰度批次｜G4-L3 规则轨整体待模型轨替换 → 另案｜G4-L4 新增词条时须复核跨规则子串包含 → 后续词表变更单。

**本单新增 3 条**：

- **G4-L5** 归档不落命中词（`matchedTerms`）→ 重叠对贡献只能给上界，无法逐轮证明因果；若要精确归因，需在归档侧补存命中词快照（归档 / 采集层另案）。
- **G4-L6** 归档场次不在现有批次血缘内 → 模式分层（cold / expert）在当前归档上不可用；`--lineage` 试跑命中 0 轮（批次血缘治理单）。
- **G4-L7** 重叠对触发量级过小（3 轮 / 0.0161%）→ 群体对照在现有样本上永远样本不足；若要给出统计结论，需先造**针对性语料批次**（大量含「你觉得呢」的规则轨回放）（灰度 / 语料批次单）。

## 7. 提交建议

**提交时只 add 本单文件**（`data/quality/*.diff`、`data/quality/g4-*.md`、`data/quality/i11-*.md`、`docs/worklog/archive/relay-response-*` 均为非本单产物 / 不入库）：

```
scripts/ops/quality/g4-lexicon-substring-overlap-evidence.ts
docs/worklog/completed/phase2.5/phase2.5-g4-lexicon-substring-overlap-evidence-implementation-2026-11-13.md
docs/worklog/completed/phase2.5/phase2.5-g4-lexicon-substring-overlap-evidence-task-2026-11-13.md
docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md
docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md
docs/worklog/pending/phase2.5-wp-list-2026-11-08.md
docs/worklog/pending/phase2.5-README.md
```

**commit message 草稿**（不自动 commit / push）：

```
feat(scripts): G-4 规则轨词表子串重叠量级离线取证（跨规则子串对仅 1 对，归档实测仅 3 轮 / 0.0161%）
```

---

**一句话给拍板**：这个重叠**机制是真的**（词表 1 对子串包含 + D-1 护栏逐字锁定），但**在现有归档上几乎看不见** —— 18592 轮里只触发 3 轮（0.0161%），对正向 trust 累计的贡献上界 0.4016%；同一批里「合法双事件」有 61 轮，是它的 20 倍。所以如果要问「消歧值不值得」，本单给的答案是：**在当前规则轨语料分布下，消歧能回收的量级 ≈ 0.4% trust 累计**，而动规则轨口径要连带评估 D-1 基线护栏；**是否消歧仍属拍板范畴**（改词 / 分类器互斥 / 最长匹配三条路都没在本单里选型），另外要让这个对照真正统计化，得先造一批高频「你觉得呢」的针对性语料（G4-L7），否则任何结论都会停在「样本不足」。
