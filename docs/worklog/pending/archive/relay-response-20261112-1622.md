# Phase3 P0 · 文字层真人度「不流利表达」度量层 —— 已交付

**一句话**：在 `src/auto-practice/metrics/` 下新增不流利（disfluency）纯函数分析器与词表模块，把 AI 来访者台词判成六类计数；判读只在服务层做一次、原文用完即弃，只把纯数值投影进 `TraceInput`，再由纯计算层聚合成 8 个 `text.disfluency.*` 指标写入批次快照（字典升 `dict-v2`）。**零行为变化**，engine-core 零改动。

## 闸门真实数字（全部 exit 0）

| 命令                                            | exit | 数字                                                                                                         |
| ----------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm exec tsc -p tsconfig.build.json --noEmit` | 0    | 0 error                                                                                                      |
| `pnpm lint`                                     | 0    | 0 error / 0 warning                                                                                          |
| `pnpm exec vitest run test/auto-practice`       | 0    | 19 文件 / 293 例全过，Duration 8.21s（墙钟 11.7s）                                                           |
| `pnpm test`（全量）                             | 0    | 187 passed + 1 skipped 文件（188）；3058 passed / 4 skipped（3062），failed 0，Duration 85.07s（墙钟 80.4s） |
| `git diff --stat HEAD -- src/engine-core`       | 0    | 输出为空                                                                                                     |

- 机器：Windows 11 Home China 10.0.26300 x64 / i7-8550U @ 1.80GHz / 15.9GB / Node v26.13.0 / pnpm；vitest 前 PATH 补 `D:\Apps\Git\cmd`；全程 pnpm，未用裸 npx。
- 全量基线 3029 passed / 4 skipped → **3058 passed / 4 skipped（+29）**，无新增 failed、无新增 skipped。

## §8 回写清单：7 / 7 已做，无遗留

1. ✅ 交付记录 → `docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-implementation-2026-11-12.md`（含任务单 §7 要求的全部 8 项）
2. ✅ 任务单归档到 `docs/worklog/completed/phase2.5/`，状态行改 ✅ 并链接交付记录；`pending/` 下原件已删（已核对不存在）
3. ✅ 蓝图 `phase3-text-disfluency-humanization-plan-2026-11-11.md` 回写：头部标注 P0 已交付 + 新增「P0 落地状态」小节（任务单 / 交付记录链接、闸门数字、6 处偏差、L-1 ~ L-10 遗留项）
4. ✅ 确认未碰 P1 / P2 / P3 范围文件；遗留项登记在蓝图「P0 落地状态与遗留项」小节
5. ✅ `git diff --stat HEAD -- src/engine-core` 为空
6. ✅ 提交分组核对完成（本单 12 个文件 / 并行进程 9 个文件分开列，未代提交）
7. ✅ commit message 草稿已给

## 需要你知道的 3 件事

1. **6 处方案偏差**（交付记录 §2）：数值契约落在 `disfluency-lexicon.ts` 而非 analyzer（否则 compute 层为拿类型就得 import analyzer，红线自破）；归一化拆两套（audit 口径会删掉省略号 / 破折号，用它 pause 与 elongation 永不命中）；repetition 收窄为「只认子句开头」（消除「今天天气」类跨词边界误计，代价是句中口吃式重复漏计）；`TraceInput.disfluency` 设必填；8 指标不含 `elongation_per_turn`；新键断言落字典 spec + compute spec 而非快照 schema spec。
2. **契约变化**：字典 `dict-v1 → dict-v2`，新增 8 个 `text.disfluency.*` 键（只增不改不复用）；快照 `schemaVersion` 仍为 1，`batch-metrics.schema.ts` 未改。前端侧注意两点 —— 按版本缓存字典的需失效旧缓存；`text.disfluency.*` 是新键族，旧快照没有，跨批次比较时「键缺失 ≠ 0」。
3. **既有测试被改的原因**：只有 `TraceInput` 新增必填字段导致 3 个 spec 夹具必须补 `disfluency`（取零值结构），**没有删除或放宽任何既有断言**，也没有改任何既有期望值。

## 遗留项（已登记蓝图，交 P1 接手）

L-1 审计脚本迁 lexicon + D7 段 / L-2 bounds 基线后补 / L-3 density 取值域校准 / L-4 repetition 子句口径取舍 / L-5 filler 词表与位置阈值 / L-6 `TRAILOFF_MIN_CHARS=4` 阈值 / L-7 `humanization-v1` 判据 / L-8 角色侧联动 / L-9 角色实体与灰度 / L-10 Phase3 backlog 台账（并行进程已新起 P1 草稿单 `phase3-disfluency-p1-audit-baseline-draft-2026-11-12.md`，正好对应 L-1，本单未碰）。

## commit message 草稿（未 commit / 未 push）

```
feat(auto-practice): 新增 Phase3 P0 文字层不流利度量层 (dict-v2 + 8 个 text.disfluency.* 指标)
```
