---
taskId: AF-557
contextId: phase2.5-audit-remediation
title: TTS 统一档位决策层
type: implementation
status: backlog
baselineRef: c92f6e22f1f603fada1fd3f899d71457f9e1cb2a
riskClass: R2
gateProfile: full
dependsOn: []
priorTasks: [AF-517, AF-555]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, docs/team/agent-orchestration/README.md]
createdAt: 2026-11-26T22:35:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/voice
    - src/membership
    - src/admin-debug/tts
    - src/config/envs
    - src/counselor/config/membership-tier-presets.ts
    - test/voice
    - test/admin-debug
    - docs/worklog/pending
    - docs/worklog/completed/phase2.5
    - docs/worklog/records/phase2.5-audit-remediation/AF-557
    - .env.example
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af557-tts-profile-routing-2026-11-26.md
    kind: report
gates:
  - command: pnpm exec vitest run test/voice/tts-profile-resolver.spec.ts test/voice/doubao-tts-protocol.spec.ts test/admin-debug/debug-tts.spec.ts
    check: 定向单测全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit 0
successCriteria:
  - 新增 TtsProfileRegistry 与 TtsProfileResolver，统一解析 provider、profile、模型、音色、端点、音频参数、优先级与错误分类；HTTP 调试链路和 WS 对练链路共享同一决策源
  - 会员档位经 MembershipTierPort.getEffectiveTier 判定，只认 status Active 且 periodEnd 大于当前时间；Free 为正式兜底档
  - 档位映射固定为 Free/Plus 到 minimax-turbo、Pro 到 minimax-hd、Max 到 doubao-seed-2.0；豆包不可用或启动失败时回退 minimax-turbo 并留下可观测日志
  - 新增豆包双向流式 WebSocket 适配器，使用 V3 二进制帧协议，支持 StartConnection、StartSession、TaskRequest、FinishSession、CancelSession 与句级音频事件
  - 音色解析按 provider 归一：MiniMax 官方音色直用，模板音色映射到豆包 2.0 音色目录；非法/未知音色有确定性回退，不静默使用占位值
  - 会话首次解析后 profile 冻结，本场中途会员变更不切模型
  - 删除无引用的 membership-tier-presets 死代码；旧 counselor/billing 保持只读兼容映射，不产生新的 quarterly/lifetime
  - .env.example 增加豆包 TTS WebSocket 与密钥契约；本机 .env 的 MINIMAX_TTS_MODEL/音色/baseUrl 与现行协议对齐
  - 不修改 src/engine-core；git diff --stat HEAD -- src/engine-core 为空
---

## 背景

用户在对练页遇到 `tts_start_failed`。只读排查确认根因是 af070 本地 `.env` 仍停留在 2026-10-23 TTS 协议重写前的旧值：`MINIMAX_TTS_MODEL=speech-2.8`、`MINIMAX_BASE_URL=https://api.minimax.chat`、`MINIMAX_TTS_DEFAULT_VOICE=mandarin_female_001`。`TtsBidiClient.resolveModel()` 在构造期白名单校验失败，零网络请求即抛错，所以表现为秒级失败。

更深一层的问题是 TTS 决策分散：`.env` 默认、`VoiceService` 直传、`admin-debug` 硬编码模型、会员档位常量各自一套。用户要求按企业级标准收敛为“共享决策层 + 多传输适配器”，而不是继续修补单个入口。

## 已确认的产品决策

| 档位 | 质量类 | TTS Profile |
| --- | --- | --- |
| Free | standard | minimax-turbo |
| Plus | standard | minimax-turbo |
| Pro | hd | minimax-hd |
| Max | premium | doubao-seed-2.0 |

- 豆包 WS 未就绪或启动失败时回退 `minimax-turbo`，不回退 HD。
- 无会员、会员过期、查询异常一律落 Free -> Turbo；Free 是正式档位。
- 本次把豆包接入 Max，Flutter 端不改。
- 旧 5 档体系目标废弃，但 Flutter 仍在消费旧 billing wire，本次只删死代码并保持兼容层。

## 实现要求

1. 新增 `src/voice/tts/runtime/` 下的 profile 类型、registry、resolver、tier 映射、音色归一、配置自检；provider 能力与模型枚举只存一份。
2. `TtsService` 按 resolved profile 分派传输：MiniMax 继续走连接池，豆包走新的双向流式客户端；统一对外仍是 `TtsSessionHandle`。
3. `VoiceService` 在会话首轮解析 profile 并冻结到 session state；握手音色、模板音色、env 默认按 provider 归一，不让 MiniMax 音色直接进豆包。
4. `MembershipAccountService` 暴露有效档位查询：`status Active` 且 `periodEnd > now`；会员适配器把档位映射为 Free/Plus/Pro/Max 访问档。
5. `admin-debug/tts` 改为从 registry/resolver 取模型与音色，不再在本地硬编码 `speech-2.8-turbo` / `speech-2.8-hd`；调试仍可显式选 profile。
6. 豆包客户端按火山 V3 双向流式二进制协议实现：4 字节 header、event、session id、payload size、JSON/audio payload；句级 mp3 聚合；错误帧映射为现有 `tts-error.mapper` 口径。
7. 配置自检覆盖：profile 模型合法性、豆包 key/WS URL、MiniMax 音色非空；启动时只告警不阻断，但建连前 fail-fast 给业务错误。
8. 清理 `src/counselor/config/membership-tier-presets.ts`（无 import 死代码）；旧 billing 不再新增旧档位值。

## 非目标

- 不改 Flutter 仓库。
- 不删除旧 `counselor/billing` 端点与 DTO；Flutter 迁移完成后另开任务。
- 不做豆包连接池、不做多实例 Pub/Sub。
- 不改 `src/engine-core`。
- 不把密钥写入代码、日志或交付记录。

## 验收

- 定向单测、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全绿。
- 手动/脚本验证：Free/Plus 解析到 turbo，Pro 解析到 hd，Max 解析到豆包；豆包未配置时解析结果回退 turbo 且日志含 `tts_profile_fallback`。
- 豆包协议帧单测覆盖 connect/session/task/finish/cancel 与音频/错误帧解析。
- 本机 `node scripts/orchestration/cli.mjs events verify` 与 `worklog verify --strict --state-free` 通过。
