# AF-557 · TTS 统一档位决策层交付记录

- **taskId**：AF-557
- **日期**：2026-11-26
- **分支**：`task/AF-557-tts-profile-routing`
- **基线**：`c92f6e22f1f603fada1fd3f899d71457f9e1cb2a`
- **性质**：架构收敛 + 新 provider 接入，不是单点修 env。
- **环境**：Windows 本机，Node `v22.23.2`（engines 要求 `>=26`，仅告警），pnpm `9.15.0`。

## 1. 交付结论

TTS 从“`.env` 默认 + 各入口各自硬编码”收敛为**一个决策层 + 多传输适配器**：

- 一个 `TtsProfileResolver` 统一解析 provider、profile、模型、音色、端点、音频参数、会员档位与回退。
- 一个 `TtsProfileRegistry` 作为 provider 能力、profile 表、档位映射、音色映射的唯一事实源。
- MiniMax 保留连接池 + 现有 bidi 客户端；豆包新增 V3 双向流式 WS 客户端。统一的是决策，不是执行。
- 会员档位只认质量类：Free/Plus → `minimax-turbo`，Pro → `minimax-hd`，Max → `doubao-seed-2.0`。
- 豆包未配置或启动失败 → `minimax-turbo`，产生 `[tts_profile_fallback]` 日志；Pro HD 失败**不降档**。
- 本场首次解析后 profile 冻结，中途会员变更不切模型。

## 2. 关键实现

### 2.1 决策层

新增 `src/voice/tts/runtime/`：

- `tts-profile.types.ts`：`TtsProviderId`、`VoiceQualityClass`、`TtsAccessTier`、`TtsProfileId`、`ResolvedTtsProfile`。
- `tts-profile.registry.ts`：
  - `minimax-turbo` → `speech-2.8-turbo`，`https://api.minimax.cn`，32k/128k mp3；
  - `minimax-hd` → `speech-2.8-hd`，同 base；
  - `doubao-seed-2.0` → `seed-tts-2.0`，`wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection`，24k/64k mp3；
  - MiniMax 官方音色 → 豆包 `_uranus_bigtts` 音色映射。
- `tts-profile.resolver.ts`：会员档 → 质量类 → profile；豆包不可用回退 Turbo；运行期 `fallbackProfile()` 只允许豆包降级；配置自检只告警不阻断。
- `tts-membership-tier.adapter.ts`：`MembershipAccountService.getEffectiveTier()` → `free/plus/pro/max`；异常统一 `free` + warn。
- `tts-config.doctor.ts`：`OnApplicationBootstrap` 输出配置告警。
- `src/voice/tts/ports/membership-tier.port.ts`：`MEMBERSHIP_TIER_PORT` 窄端口，避免 voice 直接依赖会员实现细节。

### 2.2 豆包传输

- `src/voice/tts/doubao-tts-protocol.ts`：V3 二进制帧编解码，header `0x11`、message type/flags、JSON/raw、event、session/connection id、payload size；支持错误帧、截断帧防御、事件分类。
- `src/voice/tts/doubao-tts-client.ts`：`StartConnection → StartSession → TaskRequest → FinishSession / CancelSession`；句级 mp3 聚合；`TTSSentenceStart/End` 转 `sentence_start / sentence_audio / sentence_end`；`SessionFinished` 转 `done`；错误映射后关闭队列；`dispose` 幂等。
- `TtsService.startSession()` 按 `profile.provider` 分派：豆包每场一条 WS，MiniMax 继续连接池；对外仍是统一 `TtsSessionHandle`。

### 2.3 业务接线

- `VoiceService`：首轮 `resolve()` 后把 profile 冻结到 `VoiceSessionState.ttsProfile`；解析失败给 `tts_profile_invalid`；豆包启动失败时用 `fallbackProfile()` 重试 Turbo；Pro HD 失败不降档。
- `MembershipAccountService`：新增 public `getEffectiveTier(uid, now)`；`isActive` 以 `periodEnd ?? expiresAt` 判定，修复旧 `expiresAt` 先过期导致付费档误降；`periodEnd/expiresAt` 为空按未到期处理。
- `admin-debug/tts`：模型从 registry 取，base URL 优先 `minimax.ttsBaseUrl`，豆包 key 只读专用语音 key；不再本地硬编码 `speech-2.8-turbo` / `speech-2.8-hd`。
- 删除无引用死代码 `src/counselor/config/membership-tier-presets.ts`；旧 `counselor/billing` 保持只读兼容，不新增旧档位值。
- `.env.example` 增加 `MINIMAX_TTS_BASE_URL` 与豆包 TTS 段；本机 `.env` 已校正 TTS 值（ignored，不入库）。

## 3. 安全与配置边界

- 豆包语音 plan 端点只接受专用语音 key：`DOUBAO_TTS_API_KEY` 或 `ARK_AGENT_PLAN_API_KEY`。
- 普通方舟 chat key `LLM_DOUBAO_API_KEY` **不再**回落到 TTS；真实 probe 已证明会 401（`45000010 AuthenticationError`），不能假装已配置。
- 未配置专用 key 时，Max 在决策期直接回退 Turbo，不发起失败 WS，不持续制造上游 401。

## 4. gateResults

| 命令 | exitCode | 结果 |
| --- | --- | --- |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint` | 0 | 0 error / 0 warning（src/test/bin + scripts） |
| `pnpm test` | 0 | 359 files：358 passed / 1 skipped；5096 tests：5092 passed / 4 skipped |
| 定向 `vitest run`（resolver / protocol / adapter / debug-tts） | 0 | 4 files / 29 tests 全过 |
| `node scripts/orchestration/cli.mjs worklog verify --strict --state-free` | 0 | 写入本记录后复跑通过 |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空 |

补充运行态证据：

- `pnpm build` 0 error。
- 以 `PORT=3101` 启动 `dist/app.js`：日志出现 `InstanceLoader TtsModule dependencies initialized`，DI 装配通过；随后被仓库既有 GraphQL schema 校验错误（`Type Payload must define one or more fields`）阻断，该错误与 AF-557 无关，未在本次修复。
- 真实豆包 WS probe：`wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection` 可建连并收到 `ConnectionStarted`，使用现有 `LLM_DOUBAO_API_KEY` 时 `StartSession` 被 401 拒绝（错误码 `45000010`）。因此真实音频链路**未完成实机验证**，需专用语音 key 才能验收。

## 5. scopeCheck

- **in-scope**：`src/voice`、`src/membership`、`src/admin-debug/tts`、`src/config/envs`、`src/counselor/config/membership-tier-presets.ts`、`test/voice`、`test/admin-debug`、`docs/worklog/pending`、`docs/worklog/completed/phase2.5`、AF-557 记录包、`.env.example`。
- 未改 Flutter；未改 `src/engine-core`；未删除旧 `counselor/billing` 端点/DTO；未做豆包连接池。
- `test/membership` 未纳入本任务 scope，因此会员有效档位用例落在 `test/voice/tts-membership-tier.adapter.spec.ts`，通过真实 `MembershipAccountService` 覆盖 `periodEnd` 语义。

## 6. 与任务单的偏差

| 任务单要求 | 实际实现 | 理由 |
| --- | --- | --- |
| 配置自检覆盖 MiniMax 音色非空 | 自检检查 `MINIMAX_API_KEY`，音色由 session/模板/profile 缺省解析 | 建连必需的是 key；音色可来自会话或模板，不能只看 env。`inspect()` 文案已改为 key。 |
| 会员有效档位用例在 `test/membership` | 放在 `test/voice/tts-membership-tier.adapter.spec.ts` | `test/membership` 不在任务 scope；不越界提交。 |
| 豆包不可用回退 Turbo | 豆包未配置在**决策期**回退；启动失败在 `VoiceService` 运行期回退 | 双层回退，避免 Max 每轮先发失败 WS；两条路径都有可观测日志。 |
| 只要求豆包回退 | 额外把 Pro HD 失败固定为不降档 | 防止 HD 启动失败被悄悄降成最低档；只有 premium 有降级契约。 |

## 7. 遗留与风险

1. **豆包真实音频未验收**：协议单测 + 建连 probe 通过，但 `StartSession` 因缺专用语音 key 被 401；需要配置 `DOUBAO_TTS_API_KEY` 或 `ARK_AGENT_PLAN_API_KEY` 后跑一场真实 Max 对练，确认句级 mp3 与前端播放。
2. **Max 当前实际落 Turbo**：在专用 key 到位前，`TtsProfileResolver` 会按设计回退；这不是故障，但付费档体验未达产品目标。
3. **全量启动被既有 GraphQL 错误阻断**：`TtsModule` DI 已初始化，应用随后因 `Payload/SimpleInput` schema 错误退出；该问题不在 AF-557 scope，需另开任务。
4. **旧 5 档未彻底退出**：`counselor/billing` 仍是 Flutter 兼容层，`MembershipTier` enum/DTO/DB 列未删；按“删死 preset → 只读兼容 → Flutter 迁 v2 → 删列”的顺序后续处理。
5. **豆包无连接池**：Max 低频场景一场一条 WS；高并发前需要池化或限流。
6. **本机 3000 端口旧进程仍加载旧 `.env`**：需整进程重启后新 TTS 配置才生效；`nest --watch` 不会重载 `.env`。

## 8. 回写

- backlog：AF-557 完成后从 pending 清单移入 completed，遗留项见第 7 节。
- commit message：`feat(af557): 收敛 TTS 统一档位决策层并接入豆包 Max`
