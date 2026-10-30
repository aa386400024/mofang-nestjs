# WP9-C · 引擎语音渲染路径 token 预算校准 + 安全边界 + E2E 验收

> 类型: 后端任务单（行为化，不含 src 实现）
> 前置: WP9-A ✅ / WP9-B ✅ / WP8-B 流式灰度 ✅
> 开工闸门: 见 §0（smoke test 通过才正式开工）
> 日期: 2026-10-29
> 红线: **不改 `src/engine-core/**` 纯层**；wiring 顶层不直引 SDK（wp8-wiring.spec §8-9 护栏）；不写 DB FK；不删旧 visitor 链路。

---

## 0. 开工闸门（smoke test）—— ✅ 已通过（2026-10-29 13:42）

**闸门状态：已通过，可正式开工。**

已完成的 smoke test：
1. `.env` 加 `ENGINE_VOICE_ENABLED=true`，重启服务。
2. 跑探针（最小 token 修复**尚未做**，当前仍是旧 `maxTokens:160`）：
   - 晚晴：`ready → llm_start → llm_text → llm_done → sentence_start → tts_audio → sentence_end → sentence_start → tts_audio → sentence_end → tts_done`，回复"……我先缓一下，我们接着说。"
   - 亦舟：`ready → llm_start → llm_text×3 → llm_done → tts_audio×3 → tts_done`，回复"嗯……其实也说不上具体什么事，最近就是有点提不起劲。不知道从哪说起。"
3. 服务端日志确认：`CharacterProfileEntity` 查询命中 `vpt_intimate_avoidance_l1`（approved+enabled），DB resolver 真查了库。
4. **结论**：引擎路径端到端通了；两角色回复不同（不是同一个兜底话术套皮）；无 error 帧；TTS 帧在流。回复偏短证实 token 预算 160 确实太紧，需要正式修复。

---

## 0.1 给后端的开工话术（直接转发）

> WP9-C 任务单在 `docs/progress/engine-wp9c-voice-render-token-budget-safety-boundaries-2026-10-29.md`。
> Smoke test 已过：引擎路径端到端通，晚晴/亦舟回复不同，无 error。正式开工，按 §2 顺序做：
>
> **第一步（最小修复，优先）**：
> 1. `ChatCompletionRequest` 加 `maxCompletionTokens?: number` 字段；
> 2. `llm-render.adapter.ts` 构造请求时传 `maxCompletionTokens`（从 `spec.tokenBudget.maxCompletionTokens` 解析），不再传 `maxTokens`；
> 3. 默认值从 160 提到 **1500**，走 env `ENGINE_RENDER_MAX_TOKENS` 可调；
> 4. voice render 路径 `reasoningEffort=low`（只影响 render taskKind，analysis/supervision 不动）；
> 5. 旧 `visitor.service.ts:137` 的 `maxTokens:200` 顺手切到 `maxCompletionTokens`。
>
> **第二步（边界硬化）**：按 §2.2 截断保护、§2.3 危机路由、§2.4 降级路径、§2.5 render prompt 注入 coreBeliefs 依次做。
>
> **第三步（探针增强）**：按 §2.6 修 `scripts/e2e-voice-ws-probe.mjs`——TTS 音频字节统计（base64 字段，不是 byte array）、抓 usage/reasoning_tokens、抓 TTFT、两角色句长对比断言。
>
> 红线：不动 `src/engine-core/**`；wiring 顶层不直引 SDK（wp8-wiring.spec §8-9 护栏）；不删旧 visitor 链路；不加 DB FK。
> 闸门命令见 §6，做完我跑探针验收。

---

## 1. 背景

WP9-B 交付后做真实 WS E2E，照出三个层面的问题：

1. **token 字段用错**：`llm-render.adapter` 传 `maxTokens`（旧字段），默认 160。`MiniMax-M3.1-Flash` 是推理模型，thinking token 计入生成长度上限，160 全被思考吃光 → `finish_reason=length` → `content` 为空 → 来访开不了口。`visitor.service.ts` 旧链路传 `maxTokens: 200`，同一个病。
2. **引擎路径从未在 WS 上跑通**：`ENGINE_VOICE_ENABLED` 缺省关，E2E 走的是旧 visitor 链路。ready 卡的"晚晴"来自模板速查卡，不是 `DbCharacterProfileResolver` 吐的——WP9-B 的角色基线注入挂在引擎路径上，还没被端到端验证过。
3. **边界未覆盖**：截断半句喂 TTS、危机轮次走低思考、降级到 error 帧断连、coreBeliefs 是否真进了 render prompt 未确认。

本 WP 把这三层一次收口，目标是"引擎语音路径在 WS 上生产级可用"。

---

## 2. 范围（做什么）

### 2.1 token 预算与思考强度校准

- `ChatCompletionRequest`（`src/llm/common/interfaces/chat-provider.interface.ts`）加可选字段 `maxCompletionTokens?: number`。
- `llm-render.adapter.ts` 构造请求时，传 `maxCompletionTokens` 而非 `maxTokens`（从 `spec.tokenBudget.maxCompletionTokens` 解析）。
- 默认值从 160 提到 **1500**，走 env `ENGINE_RENDER_MAX_TOKENS` 可调。
  - 定 1500 的理由：thinking 留 ~700-1000，输出留 ~500-800（约 3-6 句中文），偶尔话多不截断，话少不浪费（LLM 不凑满预算，只为实际输出付费）。
- **不同时下发** `max_tokens` 与 `max_completion_tokens`（语义歧义，上游可能按旧字段截断）。
- voice render 路径 `reasoningEffort=low`：
  - 理由：BDI 的角色推理（这轮该什么情绪、什么防御）在 engine-core 做完了，LLM 只负责把它"翻译"成自然口语，不需要深思考。
  - 只对 **render taskKind** 生效；analysis / supervision / drill-evaluator 等重推理任务不受影响，仍走各自 config profile。
- 旧 `visitor.service.ts:137` 的 `maxTokens: 200` 顺手切到 `maxCompletionTokens`（不展开旧链路改造）。

### 2.2 截断保护（半句不喂 TTS）

- 渲染层检测到 `finish_reason=length` 时：
  - 丢弃最后一个未闭合句子（按句号/问号/叹号/换行切分）；
  - 或补一个自然收束短语（"……大概就是这样"）。
- **不得**把半截文本喂给 TTS 队列。
- 流式路径同理：流被 length 截断时，未闭合的最后一句不触发 `sentence_start` / 不进 TTS。

### 2.3 危机轮次路由（per-turn）

- 引擎在 turn 决策时判定这轮是否带 risk signal（自伤/自杀/伤人/高危）。
- **risk 轮次**：
  - `reasoningEffort` 强制 `medium` 或 `high`（不走 low）；
  - 同步触发危机检测 / `supervision_hint` 帧（不等异步 worker）；
  - render prompt 带安全护栏（不生成危险操作细节）。
- **正常轮次**：仍走 low reasoning + 标准 render prompt。
- 这个分支现在可能不存在，需要新增 risk signal → render 参数的路由。

### 2.4 降级路径（不发 error 帧断连）

- LLM 空回复 / 429 / 上游故障 / 主备全挂时：
  - 降级到**本地预写兜底话术**（每个角色 3-5 句，如"我想想……""嗯……""最近确实有点难说出口"）；
  - 通过正常 `llm_text` / `tts_audio` 帧流出，会话不崩；
  - 兜底话术在日志里标记 `degraded=true`，不冒充真实角色回复。
- 兜底话术从 config 加载（未来可换成 character service 远程拉取），不硬编码在 adapter 里。

### 2.5 render prompt 注入角色基线（确认而非假设）

- **确认** coreBeliefs 真的拼进了 render 的 LLM prompt（不是只在持久化快照里）。
- dev only debug 日志：打印实际拼进 render prompt 的角色片段（codename + coreBeliefs 前 100 字），便于人工核对。
- render prompt 带"轮次权重"指令：
  - 这轮该说短（回避 / trust 低 / defense 高）→ prompt 写"简短、躲闪、用嗯/还好吧"；
  - 这轮该说长（焦虑理智化 / trust 上升）→ prompt 写"可以多解释几句"；
  - 说完一两句就停顿交话语权（真人对话不是独白）。
- 这个"轮次权重"来自 engine-core 的 turn 决策结果，不是前端传的。

### 2.6 E2E 探针增强（改 `scripts/e2e-voice-ws-probe.mjs`）

smoke test 暴露探针本身的三个缺口，一并修：

- **TTS 音频字节统计修对**：当前探针算 `(msg.audio ?? msg.data ?? []).length` 得 0，因为 TTS 帧的音频是 **base64 字符串**（不是 byte array）。需确认 tts_audio 帧实际字段名（可能是 `audio`/`payload`/`data` 里的 base64 string），按 base64 解码后算实际字节数。验收：TTS bytes > 0。
- **抓 LLM usage**：从上游响应（或后端透传的帧）提取 `prompt_tokens` / `completion_tokens` / `reasoning_tokens`（若有），打印出来。验收：能看到 reasoning_tokens > 0（证明 M3.1-Flash 确实在思考），且 completion_tokens 不再是被 thinking 吃光的极小值。
- **抓 TTFT**：从发 `user_text` 到收到第一个 `llm_text` 的毫秒数，打印。验收：TTFT < 3s（voice render 走 low reasoningEffort 后应明显下降）。
- **两角色对比断言**：同一句咨询师开场，晚晴 vs 亦舟，断言：
  - 两角色回复文本不同（不是同一个字符串）；
  - 句长分布有差异（晚晴更短/躲闪，亦舟更长/解释）；
  - 口吻关键词不同（回避型用"嗯/还好吧/不知道"，焦虑型用"其实/就是/有点"）。
- **截断测试**：构造一个会触发 `finish_reason=length` 的输入（可临时把 `ENGINE_RENDER_MAX_TOKENS` 调到很小），断言 TTS 帧不含半截句子（最后一句有句号收尾）。
- **危机测试**：发一句自伤输入（"我活着没什么意思，想结束"），断言收到 `supervision_hint` 帧（而不是普通 render 路径静默略过）。

---

## 3. 明确不做项

- ❌ 不改 `src/engine-core/**` 纯层（BDI 算子、轨迹、记忆、伦理纯函数一律不动）。
- ❌ 不按角色硬编码 token 预算（等真实逐字稿数据再分档）。
- ❌ 不做 per-turn 动态预算（基于对话上下文实时算 token 上限）——那是 Phase2。
- ❌ 不删旧 visitor 链路（M2 后退役，这轮只顺手切字段名）。
- ❌ 不迁 PG / 不改 DB schema / 不加 DB FK。
- ❌ 不做 character service 抽离 / 开放 API（Phase2）。
- ❌ 不碰 Flutter 前端代码（前端"思考中"UI 提示另立项，见 §5）。
- ❌ 不实现 PsyGUARD-RoBERTa Python 服务（WP11，这轮只做规则层 + 路由）。

---

## 4. 验收标准

### 4.1 成功验收

| # | 项 | 怎么验 |
|---|---|---|
| 1 | tsc 0 错、eslint 干净 | 闸门命令 |
| 2 | wp8-wiring.spec §8-9 护栏仍绿（wiring 顶层不直引 SDK） | `npm test -- wp8-wiring` |
| 3 | 晚晴探针：llm_text 非空 + tts_audio 出声 | 探针输出 |
| 4 | usage 含 reasoning_tokens，TTFT 在可接受范围（< 3s） | 探针抓 |
| 5 | 亦舟 vs 晚晴：句长/口吻有可观测差异 | 探针对比 |
| 6 | 截断测试：TTS 帧不含半截句子 | 构造超长输入 |
| 7 | 危机测试：自伤输入触发 supervision_hint | 探针发自伤句 |
| 8 | 降级测试：额度耗尽时收到兜底话术音频，不是 error 帧 | 拔 MiniMax key 或等额度耗尽 |
| 9 | dev 日志能看到 render prompt 拼入了 coreBeliefs 片段 | 后端日志 |

### 4.2 失败/边界验收

- `max_tokens` 与 `max_completion_tokens` **不同时**下发（grep 确认）。
- `reasoningEffort=low` 只对 render taskKind 生效，analysis/supervision 路径不受影响。
- 兜底话术在日志里带 `degraded=true` 标记，不冒充真实回复。
- 危机检测是**同步**触发（不因为异步 worker 而错过触发窗口）。
- 截断保护不吞掉正常短回复（一句"嗯"不该被误判为未闭合）。
- `ENGINE_VOICE_ENABLED=false` 时旧链路行为零变化（可一键回退）。

---

## 5. 终局形态预留（引擎后期抽离为独立服务）

- `maxCompletionTokens` / `reasoningEffort` 走 config factory，不硬编码在 adapter。
- 兜底话术从 config 加载，未来 character service 上线后换成远程拉取。
- `reasoningEffort` 按 taskKind 路由（render/analysis/supervision 各自配置），新增 taskKind 不改路由逻辑。
- 危机检测走 `RiskProbePort` 抽象（WP4 已预留），未来换 PsyGUARD Python 服务时 adapter 不动。
- render prompt 的"轮次权重"是 engine-core turn 决策的输出，不是外部传入——抽离服务时这个契约不变。

---

## 6. 闸门命令（由后端在 Windows PowerShell 跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx tsc --noEmit
npm run lint
npm test -- wp8-wiring
# 探针（后端起着服务时）：
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴
node scripts/e2e-voice-ws-probe.mjs vpt_workplace_intellectualization_l1 亦舟
```

---

## 7. 前端配套（另立项，不在本 WP）

- 思考中 UI 提示：llm_start 阶段显示"来访正在考虑…"轻提示，避免 3-5 秒静音像卡死。
- 兜底话术视觉区分：降级轮次在逐字稿里带标记（浅灰/斜体），让咨询师知道这轮是系统兜底而非真实角色回复。
- 这两项等 WP9-C 后端交付后，前端评估排期。

---

## 8. commit 文案（后端完成时）

```
fix(engine): 渲染路径切 max_completion_tokens(1500) + voice render 低思考 + 截断/危机/降级边界收口
```

---

## 9. 交付回写（2026-10-29）

> **状态：代码已交付并复跑绿，待用户跑探针验收。**
> 交付记录：[engine-wp9c-voice-render-token-budget-safety-boundaries-implementation-2026-10-29.md](./engine-wp9c-voice-render-token-budget-safety-boundaries-implementation-2026-10-29.md)

### 9.1 闸门实测

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ 0 错 |
| `npx tsc -p tsconfig.scripts.json --noEmit` | ✅ 0 错 |
| `npm run lint` | ✅ exit 0（**0 error 0 warning**） |
| `npm test -- wp8-wiring` | ✅ **34 例全绿**（§8-9 护栏未改未破） |
| 全量 jest（engine-core / adapters / voice / agent / llm） | ✅ **25 套件 / 495 例全绿** |
| `npm run build` + `npm start` | ✅ 真起服务成功，`/engine/admin/character-profiles` → 401（路由 mapped，鉴权生效） |
| `git diff --stat HEAD -- src/engine-core` | ✅ **空**（内核整树零改动） |
| `node --check scripts/e2e-voice-ws-probe.mjs` | ✅ OK |

> `npx tsc --noEmit`（含 `test/`）的 41 个报错**全部集中在 `test/e2e/knowledge-search.e2e-spec.ts`（13）与 `test/good-state-diary.e2e-spec.ts`（28）** —— 两个文件引用了不存在的模块（`../src/...` 相对路径错误），是**早于本轮的失效 e2e**，本轮一行未碰。生产构建口径（build / scripts）均 0 错。

### 9.2 §2 逐条对照

| 小节 | 落地情况 |
|---|---|
| §2.1 token 预算与思考强度 | ✅ `ChatCompletionRequest.maxCompletionTokens` + `reasoningEffort`（canonical 类型 `ChatReasoningEffort` 落厂商抽象层）；`llm-render.adapter` 两处请求构造改传 `maxCompletionTokens`（不再传 `maxTokens`）；默认 **160 → 1500** 走 `ENGINE_RENDER_MAX_TOKENS`；**不同时下发**两字段（基类 `maxCompletionTokens ?? maxTokens` 只取其一 + MiniMax 走 `modelKwargs` 只发 `max_completion_tokens`）；voice render `reasoningEffort=low` **只对 render taskKind**；`visitor.service.ts` 切 `maxCompletionTokens: 200` |
| §2.2 截断保护 | ✅ 新增 `render-truncation.ts`（纯函数）；聚合路径 `applyTruncationGuard()` 裁未闭合尾句、裁空则降级；流式路径改**句边界缓冲**（只下发已闭合句，`length` 丢 pending，正常收尾 flush）—— **半句不进 TTS** |
| §2.3 危机路由 | ✅ `LocalCrisisProbe` 实现内核 `RiskProbePort`（内核来访词典 + 咨询师输入面补差）；`AdaptiveRenderSpec.riskSignal` 驱动 **`reasoningEffort` 抬档（medium/high，只升不降）** + **prompt 安全护栏** + **同步 `supervision_hint` 帧**（本轮结算当场推，不等异步 worker） |
| §2.4 降级路径 | ✅ 兜底话术**从 config 加载**（`ENGINE_RENDER_FALLBACK_UTTERANCE` `|` 分隔多句 → `fallbackUtterances` 池，**轮换不复读**）；走正常 `llm_text` / `tts_audio` 帧**不发 error 帧**；日志带 **`degraded=true`** |
| §2.5 render prompt | ✅ **coreBeliefs 确认已注入**（`turn-render-orchestrator.ts:634-635`，本轮加单测钉住）；新增**轮次权重**指令（由内核 turn 决策的 `resistance.verbal` / `trust` / `intention.strategy` 算出，**非前端传入**）+「说完一两句就停下来」；dev-only 日志打印 codename + coreBeliefs 前 100 字 |
| §2.6 探针增强 | ✅ TTS 按 `audio_base64` **解码后**算字节数；抓 `llm_done.usage`（prompt/completion/**reasoning** tokens）；抓 **TTFT**；`--compare` 断言文本不同 / 句长差异 / 口吻关键词不同 / TTFT<3s / reasoning_tokens>0 / TTS bytes>0；断言进 TTS 每句都**以句末标点收尾**；危机场景断言收到 `supervision_hint` |

### 9.3 顺手拆掉的真缺陷（不在任务单原列，但属本 WP 范畴）

**LangChain 1.6.2 写的是 snake_case `finish_reason`**（`generationInfo.finish_reason`），而本仓 provider 原来只读 camel `finishReason` → **每次调用的 `finishReason` 恒为 `'stop'`**，截断信号**从来收不到**。已加 `readFinishReason()` 双键读取并修流式 / 非流式两处。

**为什么这条必须记**：§2.2 截断保护的触发条件就是 `finish_reason=length` —— 在这个缺陷修好之前，防护**连触发都不会触发**。

### 9.4 真实上游实测（MiniMax-M3.1-Flash）

| 项 | 旧（`max_tokens=160`） | 新（`max_completion_tokens=1500` + `reasoning_effort=low`） |
|---|---|---|
| completion_tokens | 121（其中**思考 94**） | 正文不被思考吃光 |
| 思考 token | 94 | **39** |
| 单次耗时 | 2428ms | **1911ms** |

→ 证实"160 太紧"：**121 个 completion token 里 94 个是思考**，正文只剩 27 个 token 的半句话。

### 9.5 待用户验收（探针）

服务起着（`ENGINE_VOICE_ENABLED=true`）时在仓库根跑：

```powershell
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴
node scripts/e2e-voice-ws-probe.mjs vpt_workplace_intellectualization_l1 亦舟
node scripts/e2e-voice-ws-probe.mjs --compare
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice crisis
node scripts/e2e-voice-ws-probe.mjs vpt_intimate_avoidance_l1 晚晴 voice truncation
```

对应任务单 §4.1 的第 3–8 项（§4.1 第 1、2、9 项已在闸门侧完成）。

### 9.6 已知边界（留给后续 WP）

- 危机探测目前是**本地规则**；WP11 PsyGUARD 上线只换 probe 实现，adapter / 装配层不动。
- 轮次权重是**可解释的粗粒度分档**（非连续预算）；per-turn 动态预算按 §3 属 Phase2。
- 兜底话术池是**通用 4 句**（config 可覆盖），非按角色定制 —— 按角色定制需角色服务（Phase2）。
- `supervision_hint` 的 `hintText` 是固定文案，未接督导话术库。
- **前端配套未做**（思考中 UI / 兜底视觉标记）：按 §7 另立项。

