# AF-226 · 来访者真人度 R6-C 交付记录

> 任务：线上 voice/text 场景补样本与切片基线
> 日期：2026-11-21
> 状态：已完成；AI 预评审，不是真人督导结论
> 分支：`task/AF-226-realism-r6c-online-scenes`

## 结论

R6-C 补上了此前完全缺失的线上场景样本：两个真实对练批次，`online/voice` 入队 48 场、`online/text` 入队 48 场，按 8 个已审核角色 × `expert` / `intermediate` / `cold` × 2 次重复、`maxTurns=20` 生成。

- `online/voice`：47 场可用（`completed=47`、`crisis_ended=1`、`failed=4`），832 条 visitor 台词，场景误判 0，硬违约 1 条。
- `online/text`：46 场可用（`completed=47`、`crisis_ended=1`），830 条 visitor 台词，场景误判 0，硬违约 0 条。
- 宽词表里“电话/视频/听见/画面”等命中 37 处，逐条复核后全部是现实生活内容（给第三人打电话、计划和家人视频、听见门外动静、情绪性的“听我说”），没有指向当前咨询媒介的越界表达。

评分链路用 24 个分层 packet（`in_person` / `online_voice` / `online_text` 各 8）真实跑完，**24/24 完成、0 失败、0 未仲裁分歧**。这是 R6-B 截断恢复之后第一次在线上场景上给出五维切片，不再只有 `in_person` 一种样本。

## 关键数字

| 切片 | n | 总体 | 自然度 | 情绪连续性 | 话轮形态 | 场景一致 | 关系在场 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `in_person` | 8 | 3.35 | 2.8125 | 3.625 | 2.8125 | 3.8125 | 3.6875 |
| `online_voice` | 8 | 3.8875 | 3.5 | 4.25 | 3.5625 | 4.0625 | 4.0625 |
| `online_text` | 8 | 3.8125 | 3.5625 | 4.0 | 3.5 | 4.0 | 4.0 |
| 全样本 | 24 | 3.683333 | 3.291667 | 3.958333 | 3.291667 | 3.958333 | 3.916667 |

双评分员总体：exact=0.75、within±1=1.00、线性加权 κ=0.614973。自然度 κ=0.36、场景一致 κ=0.333333，样本只有 24 个，维度 κ 只能作参考。

**不能把这组数字写成“线上比面对面更自然”。** 两个线上切片各只有 8 个 packet，packet 是不同会话，AI 评分员同模型不同温度，分数差异在 AI 预评审噪声范围内。可以成立的结论只有：线上 voice/text 在本次 8+8 样本上没有复现 R5 基线里 `in_person` 自然度 2.75/5 的结构性短板，且场景一致维度没有掉；是否稳定成立，需要更大样本与真人督导师双标。

## 实现

1. **场景加载单一入口**：新增 `bin/realism-scene-loader.ts`，优先级为旧记录显式 `scene` / `realismScene` > 新记录 `encounter` > prompt 场景层 > `in_person`。`online/video` 与 `online/voice` 同归 `online_voice`，`online/text` 归 `online_text`；老 360 场没有 `encounter`，继续按 prompt 推断、缺省 `in_person`，行为不变。
2. **两个真人度 CLI 接线**：
   - `bin/visitor-realism-baseline.ts` 改用统一加载器，报告里的 `sceneInference` 改为 `explicit_scene_or_encounter_else_prompt_scene_layer_else_in_person`。
   - `bin/visitor-realism-blind.ts` 改用统一加载器，不再只认 `scene` / `realismScene`；同时把 `sceneSlices` 从“只有总体均值”扩成“总体 + 五维”，Markdown 场景表同步展开。
3. **测试**：`test/auto-practice/af226-online-scene-loader.spec.ts` 覆盖 encounter 优先、voice/video 归一、旧 scene 字段优先、prompt 回落、缺省 in_person、畸形 encounter 不猜线上。

## 真实批次与评分

- voice batch：`3L5EyPpaLJFGbVjC179cg`
- text batch：`hRW4V44-t43yyty_EyLke`
- 生成方式：本地 dev 服务 `POST /admin/api/auto-practice/batch`，未改 `.env`、未换 provider、未换模型。
- 评分命令（实际）：
  `node --env-file=.env --import tsx bin/visitor-realism-blind.ts --source data/debug-sessions --target-scored 24 --max-packets 48 --max-parse-retries 2 --out data/phase25-exit/af226-online-scenes/blind`
- 盲评候选 460 场、剔除 `too_short=2` / `hard_violation=17`；三场景 eligible 为 `in_person=343`、`online_voice=50`、`online_text=48`。

## 与任务单的偏差

1. 任务单闸门写的是 `--packets 24`，CLI 实际参数是 `--target-scored 24 --max-packets 48`；按实际参数执行，效果是 48 个分层候选、评到 24 个即停，三场景各 8。
2. 第一轮 24 packet 有 1 个 `online_text` packet 在 compact 重试后仍因证据定位失败（`R1_parse_failed:evidence_not_in_turn:emotional_continuity`），当时分布是 9/8/7；未改评分口径，按 CLI 既有 `--max-parse-retries` 把解析重试从 1 提到 2 重跑，24/24 完成、三场景各 8。
3. voice 批次 DB 行数为 52（入队 48），其中 4 条 `failed` 是 `nest start --watch` 在 13:29 被并行任务的文件变更触发重启、打断在途会话留下；改用非 watch `node dist/app.js` 后未再发生。可用场次仍为 47，满足 ≥40。
4. `sceneSlices` 增加五维是任务单“按场景给出五维均值”的必要实现；没有改评分协议、prompt、provider 或 `.env`。

## 闸门证据

| 闸门 | 结果 |
| --- | --- |
| 定向 vitest（AF-226 + AF-225 + AF-214 盲评包 + AF-214 评分） | 4 files passed，36 tests passed |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint`（全量，带缓存） | exit 0，0 error / 0 warning |
| `pnpm test`（全量） | 248 files passed + 1 skipped；4181 tests passed + 4 skipped |
| 线上批次 | voice 可用 47 / text 可用 46，场景误判 0，当前媒介越界 0 |
| 24 packet 盲评 | 24/24 完成、0 失败、每场景 8、0 未仲裁分歧 |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 遗留

- 线上每通道只有 48 场、评分每场景 8 packet，不能替代完整 360 场线上基线；要给出“线上稳定不劣于面对面”的批次级结论，需要把线上样本扩到与 in_person 同量级。
- 自然度维度 κ=0.36，维度一致性偏弱；这是评分员同模型 + 24 packet 小样本的已知限制。
- 真人督导师双标与仲裁仍未做，`humanSupervision=false`、`clinicalAcceptanceEligible=false`。
- 工作区仍有并行任务与历史取证文件（`data/batch-reports/*`、`data/phase25-exit/af13*`、`.af214-check.mjs` 等），本单不清理、不纳入提交。

## 机读字段标记

- `scopeCheck`：in-scope（仅改 `bin/`、`test/auto-practice/`、任务记录与交付记录；未碰 engine-core、provider、`.env`、scripts/orchestration、admin-dashboard、Flutter）
- `contractChecks`：taskId / state-write / index-schema / event-chain / engine-boundary / deploy-contract / text-privacy 全部 pass
- `backlogItems`：BL-AF226-01 线上样本未扩到 360 场；BL-AF226-02 自然度维度 κ 偏低；BL-AF226-03 真人督导师双标未做
- `deviationTable`：4 条（CLI 参数名、首轮 1 packet 失败后提高解析重试、watch 重启打断 4 场、sceneSlices 增加五维），均已在“与任务单的偏差”逐条说明
- `reviewVerdict`：passed（机器闸门全绿；24/24；线上每场景 8 packet；仅样本规模与 AI 评分随机性已如实登记）

## commit message

`feat(af226): 线上 voice/text 场景补样本与三场景五维基线`
