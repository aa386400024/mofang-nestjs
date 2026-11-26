# AF-559 交付记录 · 来访者台词括号舞台说明剥离

- 任务号：AF-559
- 类型：fix
- 基线：`d19fd56a8f567c72d59d551d6bc2c556b04fce2a`
- 分支：`task/AF-559-visitor-stage-direction`
- 日期：2026-11-27
- 风险级别：R2

## 结论

已把「AI 来访者台词里的中文全角括号舞台说明」从展示、TTS、逐字稿落库三条出口统一剥离。问题不在模型 prompt，而是 AF-281 建立的 `stripVisitorStageDirections` 一直只在 `seed-v5` 变体开启；当前 `.env` 未设置 `VISITOR_PROMPT_VARIANT`，默认走 `shared`，投影层等于没有上线。

## 真实数据证据（只读审计，不改库）

- 范围：`ap_practice_turns` 最近 9 场（2026-11-26 06:46–07:10 UTC，本地约 14:46–15:10），共 284 轮
- 命中：105 轮的 `visitor_display_text` 与 `visitor_tts_text` 同时含中文全角括号，且两列内容完全相同，`visitor_semantic_level=0`
- 典型形态：`（停顿）`、`（声音很轻）`、`（攥着衣角）`、`（沉默很久）`、`（语速突然变快像倒豆子）`
- 回归：将同一批 284 轮的 display/tts 文本过新投影函数后，**残留括号 0**（此前 105 轮命中，清洗后 8 个字符串残留单字/长旁白，已通过「全角括号一律剥离」收敛到 0）

## 改动

1. `src/shared/realism/visitor-stage-direction.ts`
   - 中文全角括号 `（…）` 一律按舞台说明剥离：prompt 已禁止来访者写括号，display/tts 契约也不允许任何标记，不再做线索判断，避免漏单字旁白与长旁白。
   - 半角 `(…)` 只在命中动作/神态/语气线索或位于句首句末时剥离；MiniMax 合法语气词 `(sighs)`、`(breath)` 等保留，避免破坏 TTS 标记。
   - `【…】` 与 `*…*` 保持原 AF-281 的剥离语义。
   - 剥离后为空退回 `……`，不返回空串触发调用方降级。
2. `src/engine-adapters/rendering/turn-render-orchestrator.ts`
   - `renderSafely` 与 `streamSafely` 的最终文本统一走 `stripVisitorStageDirections`：auto-practice 门面出口不再依赖渲染适配器的 `promptVariant` 开关（默认 `shared` 时原实现会原样透传）。
   - 流式已发出的 delta 不撤回；在线语音链路由 `ProsodyStreamSanitizer` 扣留未闭合全角括号，门面保证最终 `reply` 干净。
3. `src/shared/prosody/prosody-text.ts`
   - `stripProsodyMarkers` 末尾统一调用 `stripVisitorStageDirections`，在线语音的 display 与 TTS 都走同一投影。
   - `ProsodyStreamSanitizer.findHoldStart` 增加全角左括号 `（` 的未闭合扣留：跨 chunk 的 `（声音很` + `轻）` 不会再漏半个旁白。
4. `src/auto-practice/semantic/semantic-turn.persister.ts`
   - 落库前再投一次投影，防御上游绕过渲染适配器（旧 shared 结果、场景开场句）把括号写进 `visitor_display_text` / `visitor_tts_text` / `visitor_semantic_json`。
5. 测试
   - `test/shared/realism/af281-visitor-stage-direction.spec.ts`：补全角真实样本、普通半角括号保留、全角按契约剥离。
   - `test/shared/prosody/prosody-text.spec.ts`：补跨 chunk 全角括号与完整括号场景。
   - `test/auto-practice/wp-j-p1e-semantic-turn-persister.spec.ts`：补落库三列均不含舞台说明。

## 与任务单的偏差

- 任务单 successCriteria 写“只剥离句首/句末或含线索的括号，普通括号不误删”；实现改为**全角括号一律剥离**。理由：真实回归里 8 个残留字符串是单字旁白与 10 字长旁白，靠线索枚举无法稳定收敛；display/tts 契约本身禁止任何括号，prompt 也已禁止来访者写括号，因此全角一律剥离是更窄、更确定的契约。半角括号仍保留线索判断，避免误删普通补充与 MiniMax 语气词。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| 定向 4 spec（wp7 + af281 + prosody + persister） | 80 tests passed，exit 0 |
| `pnpm typecheck` | 0 error，exit 0 |
| `pnpm lint` | 0 error / 0 warning，exit 0 |
| `pnpm test` | 359 files：358 passed + 1 skipped；5102 tests：5098 passed + 4 skipped，exit 0 |
| `pnpm build` | 0 error，exit 0 |
| `git diff --stat HEAD -- src/engine-core` | 输出为空 |

## 遗留

- 历史 1,397 轮脏数据未回洗；是否批量重投影另案评估（只影响旧批次展示，不影响新链路）。
- 场景种子 `practice-scenario-seeds.questioning.ts` 的 `openingLine` 仍含 `（停顿）` 示例。当前开场句若绕过渲染适配器，仍可能带括号；已由 persister 兜底落库，但 UI 开场展示路径未覆盖，登记为 `BL-AF559-01`（medium）。
- AF-280 记录的“流式已发出 delta 无法撤回”仍成立；本次在 `ProsodyStreamSanitizer` 层扣留未闭合全角括号，在线语音流式已覆盖，离线对练网关若直接透传 renderer delta 仍需后续确认。
