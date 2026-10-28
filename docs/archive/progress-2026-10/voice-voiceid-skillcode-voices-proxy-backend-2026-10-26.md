# 语音会话 · 音色代理 / 握手扩展 后端任务单（2026-10-26）

> 配套前端规划：`frontend/xin_su_app/docs/progress/unified-voice-session-and-voice-plan-2026-10-26.md`（§6 为原始出处）。
> 本单**只列后端要做的动作**，不含前端 UI/状态条/对话流（那些前端已落地，见规划 §11）。
> 本期范围：官方系统音色选择预留 + 握手 `voiceId`/`skillCode` + 无 `templateId` 兜底分支。
> 约束沿用现有 vpt 闭环：上游错误归一为可识别 `error`，**不伪造成功音频/文本**；MiniMax API key 永不下发前端。

---

## 任务 1 · WS 握手扩展（`/voice/training` query，现有白名单上增量）

现状握手纯函数：`src/voice/voice-handshake.ts`（白名单 + 越界裁剪 + 非法回退）。在其上增量两个可选字段，**不破坏现有字段**。

| 新增 query 字段 | 类型 | 规则 / 回退 |
|---|---|---|
| `voiceId` | string | **仅自定义来源传**；官方模板、专项兜底都不传。提供则覆盖 env `MINIMAX_TTS_VOICE_ID`（见任务 3）；未提供走模板/env 默认。**传入但不在账号可用系统音色内** → 回退 env 默认 + warn 日志，**不致命断连**；真正的 1004/2013 留到 TTS 建连阶段归一为 error。 |
| `skillCode` | enum `listening / questioning / voice` | 专项训练目标，用于 LLM 聚焦与事后专项反馈；**非法值直接忽略（不报错、不断连）**；全流程/个案不传（null）。 |

### 1.1 无 `templateId` 的分支（当前会断连，需改）

- **现状**：`templateId` 非空但查不到 → `template_not_found` + close(1008)；完全无 `templateId` 也走查不到分支。
- **要改成**：
  - 有 `templateId`：维持现逻辑（查到→注入；查不到→`template_not_found`，不回退）。
  - **无 `templateId`**：不再报 `template_not_found` 断连，进入"兜底人设 / 自定义注入"通道（本期兜底先用 env 默认人物/标准陪练；自定义人涉嫌荷是 P2，本单不实现，预留通道即可）。
- 鉴权（unauthorized）、传输错误等不可恢复错误仍按现有归一，不受本分支影响。

---

## 任务 2 · 官方系统音色列表代理（本期新增只读端点）

> 前端不直连 MiniMax，API key 只在后端。列表低频变动，建议短 TTL 内存缓存（如 5–10 分钟），避免每次进准备页都打上游。

```
GET /counselor/voices?type=system
Authorization: Bearer <jwt>   // 复用 JwtAuthGuard
```

- 后端调 MiniMax `POST https://api.minimax.cn/v1/get_voice`，body `{ "voice_type": "system" }`，**只取 `system_voice` 数组**（忽略 voice_cloning / voice_generation）。
- 响应精简（剥掉 `created_time` 等前端不需要的字段），按本仓 ASR 代理惯例直接返回业务字段：

```jsonc
{
  "voices": [
    {
      "voiceId": "Chinese (Mandarin)_Lyrical_Voice",
      "name": "抒情女声",
      "description": ["一位温柔抒情的普通话女声……"]
    }
  ]
}
```

- `type` 本期只接受 `system`；传其他值或缺省按 `system` 处理即可（克隆/文生列表后期才开）。
- **错误**：上游 1004 鉴权失败 / 1008 余额不足 → 返回 502 + 可读 message（前端隐藏或置灰选择器，不崩溃）；不向前端回传上游原始 key。
- 注意：`get_voice` 的 system 条目**不含试听音频**，本期端点只回名称+描述，不做试听（试听增强见"本期不做"）。

---

## 任务 3 · TTS 建连使用传入 `voiceId`

- 落点：`src/voice/tts/tts.service.ts`（现有取 env `MINIMAX_TTS_VOICE_ID` 的位置）。
- 取音色优先级：**握手 `voiceId` > 模板绑定音色（若有）> env `MINIMAX_TTS_VOICE_ID`**。
- 现状"全局统一 env、不按人切音色"放开为"**可选覆盖，缺省仍是 env**"；不传 `voiceId` 时行为与今天完全一致。
- env 现状（已填，勿动）：`MINIMAX_TTS_VOICE_ID=Chinese (Mandarin)_Lyrical_Voice`、`MINIMAX_TTS_MODEL=speech-2.8-turbo`、`MINIMAX_BASE_URL=https://api.minimax.cn`。

---

## 本期不做（边界，勿回流）

- **自定义结构化人涉嫌荷（P2）**：握手 JSON 子结构或 `persona_init` 帧、即时拼人设 prompt，本期不实现，仅预留无 `templateId` 通道。
- 用户自录克隆（`/v1/files/upload` voice_clone + `/v1/voice_clone`）、AI 文生音色（`/v1/voice_design`）、音色删除（`/v1/delete_voice`）——全部后期。
- 音色试听端点 `POST /counselor/voices/preview`（用 voice_id 合成固定示范文本回 mp3）——P1 可选增强，不阻塞主流程。
- 不把 MiniMax API key / 上游直连暴露给前端。

---

## 验收判据

1. `GET /counselor/voices?type=system`（带合法 JWT）返回非空精简列表，字段仅 `voiceId/name/description`；无 key/无余额时 502 可读，不泄露 key。
2. 握手带合法 `voiceId` → TTS 用该音色；带非法 `voiceId` → 回退 env 默认且不断连；不带 → 与现状一致。
3. `skillCode=listening/questioning/voice` 被接收并用于 LLM 聚焦；传乱值被忽略不报错。
4. 无 `templateId` 不再 `template_not_found` 断连，进入兜底通道；有 `templateId` 查不到仍按现逻辑拒绝。

## 留给本地执行（后端同学自跑）

- `npm test`（现有 `test/voice/voice-protocol.spec.ts` 回归不红；握手新增三态补纯函数用例）。
- `npm run build` / `npm run lint` 复跑通过；新增 env 键登记进 `ProcessEnv`（`typings/global.d.ts`）避免 TS4111。
