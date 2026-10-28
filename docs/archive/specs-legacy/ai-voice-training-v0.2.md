> **⚠️ 本版本已 superseded by V0.3 (V2026-10-15 治本, 8 处 spec-vs-代码修订 + 2 对重复章节合并)**
> **当前主 spec**: [`docs/specs/ai-voice-training-v0.3.md`](./ai-voice-training-v0.3.md) (22 章, 整合 V0.1 + V0.2 + 8 处修订)
> **变更摘要**: 见 V0.3 §21 Changelog v0.2 → v0.3 (8 处修订 + 2 对重复合并)
> **保留原因**: V0.2 culture "保留历史 reference", V0.2 内容 = V0.x 实际 push 状态 snapshot, 不删

<!-- V2026-10-15 治本 (V0.3 整合 — V0.2 顶部 superseded 标注):
     原因: V0.3 spec 整合 V0.1 + V0.2 + 8 处修订 + 2 对重复合并, V0.2 已 outdated, 需指引后续读 V0.3.
     修法: V0.2 spec 顶部加 superseded 标注 + V0.3 spec 链接, V0.2 内容保留作历史 reference (跟 V0.2 culture "保留历史 reference" 一致, V0.2 文档作为 ground truth snapshot).
     反双胞胎: 不删 V0.2 spec (V0.2 culture "保留历史 reference"); 不改 V0.2 内容 (历史 = ground truth snapshot); 不写 V0.4 (V0.3 整合够).
     验证: 大炮跑 git diff --stat 验 V0.2 顶部有 superseded 标注 + 跳到 V0.3 spec 链接.
     时间戳: 2026-10-15 -->

# 心塑 + 咨询师训练 产品规格说明书 V0.2

> **本版本**: V0.2 (整合 v0.1 + 新 spec, 反映 7.10 P0-1..P0-6 已 push 实际状态)
> **生成日期**: 2026-10-13
> **作者**: agent (V0.2 整合 + 大炮拍板)
> **位置**: `mofang-nestjs/docs/specs/ai-voice-training-v0.2.md` (跟 v0.1 同根)
> **跟 v0.1 关系**: V0.2 包含 v0.1 全部 24 章 + 新 spec 10 节 + 6 P0 实际状态 + V1.x 路线图
> **跟 progress doc 关系**: 跟 `docs/progress/v0.1-progress-snapshot-2026-10-13.md` 配套 (snapshot 是即时状态, 本文件是路线图)

---

## 0. 元信息

| 项 | 值 |
|----|----|
| **V0.2 跟 V0.1 关系** | V0.1 全部 24 章 + 新 spec 10 节 (v0.2 整合) |
| **V0.2 跟 new spec 关系** | 整合 (大炮 2026-10-13 13:25 贴的 v0 文档, 内容吸收进 V0.2 各章) |
| **实际完成度** | 88% (心塑 主 100% + v0.1 AI 语音训练 100% + counselor 5 Tab 100% + life_map 100% + V1.x 0%) |
| **P0 全部 done** | counselor_home / counselor_training / counselor_exam / counselor_growth / counselor_profile / life_map (6/6) |
| **commit 历史** | 7.10 + 7.11 (e2e 校准) + P0-1..P0-6 (vertical slice) — 全部 push |
| **本版本变更** | 见 §23 Changelog (v0.1 → v0.2) |

---

## 1. 范围 (整合 v0.1 §2 + 新 spec §1)

### 1.1 In Scope (V0.x 已 done)

| 域 | 模块 | 状态 |
|----|------|------|
| **心塑 主 app** | home / profile / companion / practice / breathing / assessment / life_map / good_state_diary / inner_world | ✅ 100% (Batch 3-A) |
| **AI 引擎** | ai-profile (7 维) / ai-recommend / ai-unlock / ai-effect | ✅ 100% (Batch 4) |
| **危机 + 转介** | crisis (5 工具) / referral (4 端点) / emergency (4 端点) | ✅ 100% |
| **AI 语音训练** | v0.1 §6-§11 (ASR / TTS bidi / LLM stream / Visitor / Supervisor / barge-in) | ✅ 100% (7.10 + 8.x) |
| **KB + CMS** | v0.1 §12 (knowledge CRUD / workflow / version / scheduled / preview) | ✅ 100% (7.1-7.11) |
| **Counselor 5 Tab** | home / training / exam / growth / profile | ✅ 100% (P0-1..P0-5) |
| **心理地图** | life_map controller (心塑 主 3 大入口 + 渐进解锁 + 漂流瓶 + 时间轴) | ✅ 100% (P0-6) |

### 1.2 Out of Scope (V1.x pending)

| 域 | 模块 | 优先级 |
|----|------|--------|
| **商业化完整** | billing module 会员/单次/B 端 + 微信/支付宝支付 + 配额 guard | P1 |
| **RAG 真联调** | v0.1 §13-§14 Qdrant + bge 真联调 (V0.5 简化 LIKE) | P1 |
| **隐私分级合规 enforcement** | PrivacyGuard 装饰器 + service 校验点 + SQLCipher 端到端 | P2 |
| **7.2/7.3 KB schema 校准** | knowledge_repository_impl.dart L47 改 `total` (1 line) | P2 |
| **Phase 9 调优** | 等保 / OpenTelemetry / 限流 / 监控 | P2 |
| **B 端服务体系** | 机构/高校/协会 | P3 |
| **游戏化 4+4** | 工作室 / 碎片 / 徽章 / 皮肤 + 通关树 / 徽章墙 / 错题闯关 / 晋级赛 | P3 |

---

## 2. 假设 (整合 v0.1 §3 + 大炮 拍板新增)

| # | 假设 | 来源 | 状态 |
|---|------|------|------|
| A1 | 心理产品咨询师需要 24h 模拟训练 | v0.1 §3 | ✅ |
| A2 | MiniMax m3 + speech-2.8 是稳定 LLM/TTS 供应商 | v0.1 §3 | ✅ (7.10 server 已 push 集成) |
| A3 | WebSocket 是最低延迟的 ASR/TTS 通道 | v0.1 §3 | ✅ |
| A4 | 训练数据需 tenant 隔离 (B 端场景) | v0.1 §3 | ✅ (V0.5 V0.x 默认 `tenantId = uid`) |
| A5 | 用户需要至少 3 维度反馈 (分数 + 维度 + 文本) | v0.1 §3 | ✅ |
| A6 | 心理产品伦理红线 > 商业指标 | v0.1 §3 | ✅ |
| A7 | 渐进解锁比"全量开放"更符合心理产品节奏 | v0.1 §3 + 新 spec §3.3 | ✅ (4 module 渐进解锁 status 字段已实现) |
| A8 | Flutter 3.x 是 client 唯一选型 | v0.1 §3 | ✅ |
| A9 | 现有 User entity 加 tenantId 字段, V0.x 默认 `tenantId = uid` | v0.1 §3 | ✅ |
| **A10 (V0.2 新)** | **京东云 ECS 已确认有, V0.x push 走服务器, V1.x 部署走 ECS** | **大炮 13:45 拍板** | **✅** |
| **A11 (V0.2 新)** | **V0.5 简化: 知识库/题库/训练走内存 mock, V1.x 接真数据库 (Qdrant + bge + TypeORM entities)** | **本 spec 整合** | **✅** |
| **A12 (V0.2 新)** | **counselor 端 V0.x 用 `tenantId = uid` 单租户, V1.x 接 B 端才走多租户** | **本 spec 整合** | **✅** |

---

## 3. 架构 (整合 v0.1 §5 + 新 spec §2)

```
┌────────────────────────────────────────────────────────────────┐
│ xin_su_app (Flutter 3.x · Android/iOS/Web)                       │
│   ├─ 心塑 主 22 module: home/profile/companion/practice/...      │
│   └─ counselorLearner 5 Tab (V6.1 §2):                           │
│      ├─ CounselorHomeRoute    → counselor_home_page             │
│      ├─ CounselorTrainingRoute → counselor_training_page          │
│      ├─ CounselorGrowthRoute  → counselor_growth_page            │
│      ├─ CounselorExamRoute    → counselor_exam_page              │
│      └─ CounselorProfileRoute → counselor_profile_page           │
└────────────────────┬───────────────────────────────────────────┘
                     │ Dio / WebSocket
┌────────────────────▼───────────────────────────────────────────┐
│ mofang-nestjs (NestJS 11 · TypeORM · MySQL 8)                    │
│   ├─ 心塑 主 14 module: companion/home/practice/...             │
│   ├─ AI 引擎 5 controller: ai-profile/recommend/unlock/effect/llm│
│   ├─ counselor 5 controller: home/training/exam/growth/profile    │
│   └─ life_map 1 controller: overview (P0-6)                      │
└────────────────────┬───────────────────────────────────────────┘
                     │ Tenant + JWT
┌────────────────────▼───────────────────────────────────────────┐
│ Data Layer (V1.x):                                               │
│   ├─ Qdrant (向量库, JD ECS 同机部署, 0 边际)                  │
│   ├─ bge-large-zh-v1.5 (embedding, JD ECS 自托管)                │
│   └─ MySQL 8 (TypeORM, 实体 + 软删 + tenantId 索引)            │
└────────────────────────────────────────────────────────────────┘
```

**V0.x 实际**: 全部 mock (Qdrant/bge 接入待 V1.x).

---

## 4. 模块清单 (V0.2 整合版)

### 4.1 client (xin_su_app) 39 module

| 类别 | 模块 | Done | 文件数 | 状态 |
|------|------|------|--------|------|
| 心塑 主 22 | home / profile / companion / practice / breathing / assessment / life_map / good_state_diary / inner_world / voice / emergency / referral / ai_engine / growth / auth / genome_reshape / guide / emotion / theme / ai_companion | 22/22 | 500+ | ✅ 100% |
| counselor 5 Tab | counselor_home / counselor_training / counselor_growth / counselor_exam / counselor_profile / counselor_script_workshop | 6/6 (1 真 + 5 placeholder unlock) | 30+ | ✅ 100% P0 |
| 小 module 11 | settings / splash / shell / messages / companions / micro_intervention / support / onboarding / legal / counselor_shared / shared | 11/11 | 50+ | ✅ 100% |

### 4.2 server (mofang-nestjs) 38 module

| 类别 | 模块 | Done | 状态 |
|------|------|------|------|
| v0.1 spec 5 段 | knowledge-base / voice / agent / analytics / auth | 5/5 | ✅ 100% (含 7.10/7.11 e2e 校准) |
| counselor 5 module | counselor (home/training/exam/growth/profile) | 5/5 | ✅ 100% (P0-1..P0-5) |
| life_map 1 module | life_map (controller + DTO + service + module) | 1/1 | ✅ 100% (P0-6) |
| 心塑 主体 server 12+ | home / practice / companion / inner_world / life_map / good_state_diary / assessment / breathing / emergency / guide / genome-reshape / ai-engine / ai-companion / agent | 15+/15+ | ✅ 100% |
| 基础设施 7+ | user / common / shared / config / base / entity / auth | 7+ | ✅ 100% |
| 待 V1.x | rag (Qdrant 真联调) / billing (会员/支付完整) | 0/2 | ⚠️ V1.x pending |

---

## 5. AI 语音训练 (v0.1 §6-§11, V0.2 整合)

✅ **V0.x 全部 done**, V0.5 内存 mock, V1.x 接真数据库.

| 模块 | 端点 | 状态 |
|------|------|------|
| voice gateway | ASR token (短期) + TTS bidi pool + barge-in | ✅ 7.10 push |
| agent/visitor | L1/L2/L3 persona + 滑动窗口 history + 3 端点 | ✅ 7.10 push |
| agent/supervisor | 6 维度评分 + 4 维度 JSON 解析 + BullMQ 集成 | ✅ 7.10 push |
| agent/llm | SSE 流式 + manual curl 测试端点 | ✅ 7.10 push |
| voice/session | client 5 态状态机 (idle/listening/thinking/speaking/error) | ✅ 7.10 push |
| counselor/supervision | 督导报告 (6 维度 + annotations + 错误模式 + 成长建议) | ✅ 7.10 push (Batch 2) |

---

## 6. 知识库 + CMS (v0.1 §12, V0.2 整合)

✅ **V0.x 全部 done**, 7.1-7.11 push 完整.

| 端点 | 端点 | 状态 |
|------|------|------|
| KB CRUD | POST / GET / PATCH / DELETE | ✅ 7.1-7.3 |
| KB workflow | 3 端点 (my-drafts / pending-review / published) | ✅ 7.6 + 7.10 e2e |
| KB version | 滚动版本 + line diff + 回滚 | ✅ 7.5 |
| KB scheduled | POST /kb/:id/schedule | ✅ 7.7 |
| KB preview | WebSocket 流式 + flutter_markdown | ✅ 7.4 |
| KB search | 全文 + tag filter (V0.5 LIKE, V1.x vector) | ✅ 7.6 + 7.10 e2e |
| admin analytics | GET /admin/analytics/overview | ✅ 8.3 (7.10) |

**V1.x 改造**: 接 Qdrant 真 RAG (A10 JD ECS) + bge embedding (chatanywhere fallback).

---

## 7. 客户 5 Tab (新 spec §4, V0.2 整合)

✅ **V0.x 全部 done** (P0-1..P0-5 push).

| Tab | endpoint | 文件 | V0.5 mock | V1.x 改造 |
|-----|----------|------|----------|-----------|
| **home** | `GET /counselor/home/overview` | counselor-home | 4 区 (问候/快捷/雷达/AI 推荐) | 接 ai-profile 7 维 + 9 训练场景 |
| **training** | `GET /counselor/training/overview` | counselor-training | 4 大分类 + 9 场景 (复用 home data) | per-scenario 进度 + 评分 |
| **growth** | `GET /counselor/growth/overview` | counselor-growth | 4 区 (能力/KPI/训练/错题/工作室) | 跨表聚合 (training-sessions + wrong-questions + studio unlock) |
| **exam** | `GET /counselor/exam/overview` | counselor-exam | 4 大分类 + 11 卡片 (硬编码 metadata) | 真题库 + 答题 + 错题聚合 + 模考 |
| **profile** | `GET /counselor/profile/overview` | counselor-profile | 3 toggle + membership (V0.5 写死) | 持久化 + billing 真实会员 |

**V0.5 全部 Stage 1 placeholder 解锁**: 8 个 locked cards 全 unlocked, 4 区块数据驱动渲染, V0.5 内存 mock (跟 server 1:1).

---

## 8. AI 引擎 4 件套 (新 spec §3, V0.2 整合)

✅ **V0.x 全部 done** (P0-4 跟 home Tab 一起 push, 4 controller + 1 LLM).

| 件套 | 端点 | 状态 |
|------|------|------|
| **画像** (§3.1) | `GET/POST /ai/profile/*` (7 维度 upsert / batch / user_override) | ✅ 4 endpoint (ai-profile.controller.ts) |
| **推荐** (§3.2) | `GET /ai/recommend` (emotion-aware) | ✅ 1 endpoint (ai-recommend.controller.ts) |
| **动态解锁** (§3.3) | `GET /ai/unlock/states` + `POST /ai/unlock/evaluate` + `POST /ai/unlock/:feature/rollback` | ✅ 3 endpoint (ai-unlock.controller.ts) |
| **效果追踪** (§3.4) | `POST /ai/effect/immediate` + `GET /ai/effect/history` + `GET /ai/effect/stats/:toolId` | ✅ 3 endpoint (ai-effect.controller.ts) |
| **LLM 流式** (§3.5) | `POST /agent/llm/stream` (SSE) | ✅ 1 endpoint (llm.controller.ts, 7.10 push) |

**V0.x 路径**: 4 controller 全内存 mock (V0.5), V1.x 接 ai-profile + 训练会话表.

---

## 9. 游戏化 (新 spec §5, V0.2 整合)

⚠️ **V0.x 部分 done** (inner_world badges/fragments push, 内心小岛 client 真功能). **P3 待做**: 4 件套 + 4 增强.

| 件套 | 状态 | 备注 |
|------|------|------|
| 工作室 | ⚠️ P3 pending | counselor_growth /studio 字段返 locked 占位, V1.x 接入游戏化系统解锁 |
| 碎片 | ✅ 部分 | inner_world/fragments controller (4 endpoint), V0.5 真功能 |
| 徽章 | ✅ 部分 | inner_world/badges controller (4 endpoint), V0.5 真功能 |
| 皮肤 | ⚠️ P3 pending | 跟 breathing module 联动, V1.x 接入 |
| 通关树 | ⚠️ P3 | 跟 life_map / counselor_training 联动 |
| 错题闯关 / 晋级赛 | ⚠️ P3 | 跟 counselor_exam 联动 |

---

## 10. 商业化 (新 spec §7, V0.2 整合)

⚠️ **V0.x 部分 done** (server billing module 雏形). **P1 待做**: 会员/单次/B 端完整.

| 域 | V0.x | V1.x |
|----|------|------|
| 会员 (月卡/季卡/年卡) | server billing 雏形 + counselor_profile 写死 `'membership': 'none'` | 真实支付 (微信/支付宝) + 自动续费 + 配额 guard |
| 单次增值 | ❌ | 5/19.9/39.9/9.9 元 SKU + 一次性消耗 |
| B 端 (机构/高校/协会) | ❌ | Tenant 多租户 + 管理员后台 + 团体方案 |
| 退款 / 发票 | ❌ | V1.x 后议 |

**V0.5 实现**: counselor_profile 显示 "未开通" chip + "月卡/季卡/年卡" 文字 (后端写死).

---

## 11. 安全合规 (新 spec §8, V0.2 整合)

⚠️ **V0.x 部分 done** (consent module 3 endpoint + crisis_detector 3 级 + emergency 5 工具). **P2 待做**: 完整 enforcement.

| 域 | V0.x | V1.x |
|----|------|------|
| 同意管理 (consent) | ✅ 3 endpoint (record/status/bind-to-user) | 完整 audit log |
| 危机检测 (crisis_detector) | ✅ 3 级关键词 (端侧) | server-side 实时检测 + 干预路由 |
| 急救工具 (emergency) | ✅ 5 工具 (54321/呼吸/safe place/TIPP/defusion) | + 跨设备同步增强 |
| 转介 (referral) | ✅ 4 端点 (hotlines / resources) | EAP 集成 |
| 双重免责 UI | ⚠️ 提示文案 | UI 强制弹窗 (首次 + 每次轻提示) |
| SQLCipher 端到端 | ❌ | 关键字段加密 (情绪 + 训练记录) |
| 隐私分级 enforcement | ❌ | PrivacyGuard 装饰器 + service 校验点 |

---

## 12. 技术选型 (V0.1 §9 + 新 spec §9, V0.2 整合)

| 层 | 选型 | 状态 |
|----|------|------|
| client 框架 | Flutter 3.x | ✅ |
| client 状态 | bloc 8.x + bloc_concurrency + equatable + dartz | ✅ |
| client 路由 | auto_route 10.x | ✅ |
| client 持久化 | HydratedBloc (V0.x) → Isar / SQLCipher (V1.x) | ⚠️ |
| client 音频 | record + just_audio + silero_vad | ✅ |
| server 框架 | NestJS 11 + TypeORM | ✅ |
| server LLM | MiniMax m3 (主) + OpenAI compatible (fallback) | ✅ 7.10 push |
| server TTS | MiniMax speech-2.8 (speech-t2a-websocket-bidi) | ✅ 7.10 push |
| server 鉴权 | JWT (HS256, 7d access + 30d refresh) + Passport | ✅ |
| server 验证 | class-validator + @nestjs/throttler | ✅ |
| 监控 | Pino + Sentry | ✅ V0.x |
| 部署 | V0.x 本地; V1.x JD ECS (A10) + Docker Compose | ⚠️ |

---

## 13. 数据模型 (V0.1 §15, V0.2 整合)

✅ **V0.x 全部 done**, V0.5 软删 + tenantId 索引.

| Entity | 关键字段 | 状态 |
|--------|----------|------|
| User | uid, phone, email, passwordHash, state, lastLoginAt, failedLoginCount, lockedUntil, **tenantId** (A9) | ✅ |
| TrainingSession | id, tenantId, userId, personaId, status, transcript, emotionTimeline, totalTurns, userUtterances, visitorUtterances, bargeInCount, supervisionReport, costAsr, costTts, costLlm | ✅ |
| Persona | id, tenantId, name, age, personality, complaint, background, emotionBaseline, defenseLevel, difficulty, voiceId, isActive, knowledgeRefs | ✅ |
| KnowledgeItem | id, tenantId, type, title, content, metadata, status, version, authorId, reviewerId, scheduledPublishAt, publishedAt | ✅ |
| KnowledgeVersion | id, itemId, version, snapshot, authorId, diff | ✅ |
| WorkflowEvent | id, itemId, type, fromStatus, toStatus, actorId, comment, createdAt | ✅ |
| AIProfileSnapshot | userId, 7 维度 (listening/empathy/questioning/boundary/voiceProfessionalism/caseConceptualization/customDimension), source (cloud/local/user_override) | ✅ |
| AIUnlockState | userId, feature, unlocked, reason, unlockedAt | ✅ |
| AIEffectRecord | userId, toolId, immediateDelta, positiveRate, recordedAt | ✅ |
| MoodLog | userId, level, loggedAt | ✅ |
| EmergencySession | id, userId, toolKind, intensity, completedAt | ✅ |
| GoodStateDiary | id, userId, body, AI feedback, softDeleted, expiresAt | ✅ |

**V1.x 改造**: AI 引擎表 (ai_profile + ai_unlock + ai_effect 持久化) + Qdrant vector index (knowledge_chunks).

---

## 14. 鉴权多租户 (V0.1 §16, V0.2 整合)

✅ **V0.x 全部 done**.

| 项 | V0.x | V1.x |
|----|------|------|
| JWT (HS256, 7d access + 30d refresh) | ✅ | 续 |
| JwtAuthGuard (Passport) | ✅ | 续 |
| TenantContext (V0.x `tenantId = uid`) | ✅ (V0.5) | 多租户 (B 端) |
| @CurrentUser 装饰器 | ✅ | 续 |
| @TenantId 装饰器 | ✅ | 续 |
| V0.x dev fallback (admin role 默认开) | ✅ (7.10) | V1.x 切真下发 |

**V0.5 V0.x 路径**: JwtStrategy V0.x dev fallback (admin role 默认开, 旧 token 走 fallback 走通). V1.x: server 真值下发 adminRole + tenantId (Q11 拍板).

---

## 15. 商业化 (V0.1 §17, V0.2 整合)

→ 见 §10. ⚠️ V0.x 雏形, V1.x 完整.

---

## 16. 可观测性 (V0.1 §18, V0.2 整合)

| 项 | V0.x | V1.x |
|----|------|------|
| Pino 结构化日志 | ✅ | + 关键链路 traceId |
| Sentry 错误聚合 | ✅ | + 性能监控 |
| Prometheus 指标 | ⚠️ P2 | 关键 endpoint 埋点 |
| OpenTelemetry 全链路 | ❌ P2 | V1.x |
| 告警 | ❌ P2 | V1.x |

**V0.x 路径**: Pino + Sentry 足够 dev/staging. V1.x 加 Prometheus + OTel.

---

## 17. 安全合规 (V0.1 §19, V0.2 整合)

→ 见 §11. ⚠️ V0.x 部分, V1.x 完整.

---

## 18. 性能预算 (V0.1 §20, V0.2 整合)

| 指标 | 预算 | V0.x 实测 (估) | V1.x 实测 |
|------|------|---------------|----------|
| 训练 session 首响 (ASR→LLM→TTS) | < 1s | 内存 mock 0ms | 需 e2e 测 |
| barge-in 打断恢复 | < 400ms | 同上 | 同上 |
| 督导报告生成 | < 5s | 6 维度 mock 0ms | 需 e2e 测 |
| 首页概览首屏 | < 500ms | V0.5 mock 50ms | 跨表聚合后估 200ms |
| 题库概览 | < 500ms | 11 卡片硬编码 50ms | 真题库后估 300ms |
| 会员状态检查 | < 200ms | billing mock 20ms | 真 billing 后估 100ms |

---

## 19. 12 周排期 (V0.1 §21, V0.2 整合 + 大幅更新)

### 19.1 V0.x 实际进度 (Week 1-8, 已 done)

| Week | Phase | 状态 |
|------|-------|------|
| W1-2 | Phase 1 MVP: MiniMax 接入 + ASR/TTS + barge-in | ✅ 7.10 push |
| W3-4 | Phase 2-3 Visitor + Supervisor + 督导报告 | ✅ 7.10 push |
| W5-6 | Phase 4-5 KB CRUD + version + workflow | ✅ 7.1-7.11 push |
| W7 | Phase 5 (续) scheduled + preview + search | ✅ 7.4-7.7 push |
| W7-8 | **Phase 7.10 P0-1..P0-6 counselor 5 Tab + life_map** | ✅ **本批次** |

**V0.x 累计**: 7.10 (e2e 校准) + P0-1..P0-6 (6 vertical slice), 总 ~80 commits, 82 file 改, 43 lint fix.

### 19.2 V1.x 计划 (Week 9-12, pending)

| Week | Phase | 估 | 备注 |
|------|-------|----|----|
| W9 | Phase 6 RAG 真联调 (Qdrant + bge, A10 JD ECS) | 中 | 接 chatanywhere m plan 兜底 |
| W9-10 | Phase 8 商业化完整 (billing + 微信/支付宝) | 中-大 | 真实支付 + 配额 guard |
| W10-11 | Phase 9 调优 + 生产化 (等保备案 + OpenTelemetry) | 中 | 监控 + 限流 + 告警 |
| W11-12 | 7.2/7.3 schema 校准 + 隐私分级 enforcement + Phase 7 cleanup | 小-中 | 1 line + PrivacyGuard |
| W12+ | Phase 5-2 (5 类训练) + Phase 5-3 (游戏化 4+4) | 大 | 长尾 |

### 19.3 V2.x 远期 (post MVP+)

- B 端服务体系 (机构/高校/协会)
- 多租户管理后台
- AI 教练角色 (虚拟督导)
- 全平台 native (iOS/Android/Web/小程序)

---

## 20. 风险登记 (V0.1 §22, V0.2 整合 + 更新)

| # | 风险 | 等级 | 缓解 | 状态 |
|---|------|------|------|------|
| R1 | LLM 响应慢/超时 | 中 | 限流 + 重试 + fallback 静态话术 | ✅ V0.x |
| R2 | TTS 成本高 | 中 | 端侧缓存 + 按需合成 | ⚠️ V1.x |
| R3 | 用户产生违规内容 | 高 | crisis_detector 3 级 + 人工审核 | ✅ V0.x |
| R4 | MiniMax 供应中断 | 中 | OpenAI compatible fallback | ✅ V0.x (chatanywhere) |
| R5 | 大模型伦理 | 高 | AIBoundaryNotice + crisis 路由 | ✅ V0.x |
| R6 | 数据库性能 | 中 | 索引 + 分区 + 软删 (V0.x) | ✅ V0.x |
| R7 | 训练数据隐私 | 高 | 端侧 mock + V1.x SQLCipher | ⚠️ V1.x |
| R8 | 法规变化 (等保) | 中 | Phase 9 备案 | ⚠️ V1.x |
| R9 | 心理产品 商业化边界 | 高 | A6 伦理 > 商业 + V0.5 不做硬推 | ✅ V0.x |
| R10 | 危机响应 0 摩擦 | 高 | emergency 红色 banner + 1-2-0 路径 | ✅ V0.x |
| R11 | 多角色权限串 | 中 | 4 role 切换 (V0.5 V0.x) | ✅ V0.x |
| R12 | 训练数据标注成本 | 中 | V0.5 mock + V1.x AI 辅助标注 | ✅ V0.x |

---

## 21. 待确认问题 (V0.1 §23, V0.2 整合 + 拍板)

| # | 问题 | 拍板 | 备注 |
|---|------|------|------|
| Q1 | 微信/支付宝 vs Apple Pay 优先级 | 微信 + 支付宝 (V0.x) + Apple Pay (V1.x) | ✅ |
| Q2 | L1/L2/L3 prompt 是手写还是 AI 优化 | V0.5 手写 + V1.x AI 优化 | ✅ |
| Q3 | barge-in 阈值 (静音多久) | 500ms (V0.x) + 动态调 (V1.x) | ✅ |
| Q4 | 训练数据保留期 | 90 天 (软删 + 物理擦除) | ✅ |
| Q5 | 督导报告是否给来访者看 | 否 (V0.x) + 脱敏后可能 (V1.x) | ✅ |
| Q6 | 评分模型是否可解释 | 是 (LIME, V1.x) | ✅ |
| Q7 | 隐私字段是否端到端加密 | V0.x 不, V1.x SQLCipher | ✅ |
| Q8 | 多语言 | 中文 (V0.x) + 英文 (V1.x) | ✅ |
| Q9 | SaaS vs 私有部署 | SaaS (V0.x) + 私有部署 (V1.x B 端) | ✅ |
| Q10 | 等保级别 | 等保二级 (V0.x) + 等保三级 (V1.x) | ✅ |
| **Q11 (V0.2 拍板)** | **V0.5 V0.x default `tenantId = uid` 隐式单租户, V1.x 接 B 端才多租户** | **✅** (A12) | **大炮 13:45 拍板** |
| **Q12 (V0.2 拍板)** | **京东云 ECS 确认有, V0.x 推 ECS, V1.x 部署走 ECS 同机 (0 边际)** | **✅** (A10) | **大炮 13:45 拍板** |
| **Q13 (V0.2 新)** | **V0.5 简化: KB / 题库 / 训练 走内存 mock, V1.x 接真数据库 (Qdrant + bge + TypeORM entities)** | **✅** (A11) | **本 spec 整合** |
| **Q14 (V0.2 新)** | **counselor 端 V0.x 5 Tab 走 Stage 1 placeholder 解锁 (8 个 locked cards 全 unlocked), V1.x 接 per-section 训练会话** | **✅** (P0-1..P0-5 拍板) | **本 spec 整合** |
| **Q15 (V0.2 新)** | **AI 引擎 4 件套 V0.x 全部 push (4 controller + LLM SSE), V1.x 接 ai-profile 持久化** | **✅** (Batch 4 拍板) | **本 spec 整合** |
| **Q16 (V0.2 新)** | **游戏化 V0.x 只做 4 件套基础 (inner_world badges/fragments controller push), 4 增强 (通关树/徽章墙等) V1.x** | **✅** (P3) | **本 spec 整合** |
| **Q17 (V0.2 新)** | **privacy 分级 V0.x 只在 PrivacyFailure class + crisis_detector 3 级, 完整 enforcement (PrivacyGuard 装饰器 + service 校验) V1.x** | **✅** (P2) | **本 spec 整合** |

---

## 22. Roadmap (V0.x / V1.x / V2.x, V0.2 新加)

### 22.1 V0.x (Week 1-8, 已 done, **88%**)

| 状态 | 范围 |
|------|------|
| ✅ 100% | 心塑 主 app 22 module + counselor 5 Tab P0 + AI 语音训练 v0.1 + KB CMS v0.1 + AI 引擎 4 件套 + life_map |
| ⚠️ 50% | 商业化 (server 雏形) / 安全合规 (consent + crisis_detector 基础) / 游戏化 (inner_world 基础) |
| ❌ 0% | 商业化完整 / 多租户 / RAG 真联调 / 隐私分级 enforcement / 5 类训练 V1.x / 游戏化 4 增强 / B 端 / Phase 9 调优 |

### 22.2 V1.x (Week 9-12, pending, **估 12%**)

| 状态 | 范围 |
|------|------|
| ⏳ Week 9 | Phase 6 RAG 真联调 (Qdrant + bge, JD ECS 部署) |
| ⏳ Week 9-10 | Phase 8 商业化完整 (billing + 微信/支付宝) |
| ⏳ Week 10-11 | Phase 9 调优 + 生产化 (等保备案 + OTel) |
| ⏳ Week 11-12 | 7.2/7.3 schema + 隐私 enforcement + cleanup |
| 📊 总估 | 12% (Phase 5/6/7/8 剩余 + Phase 9) |

### 22.3 V2.x (post MVP+, **远期**)

- B 端服务体系 (机构/高校/协会)
- 多租户管理后台
- AI 教练角色 (虚拟督导)
- 5 类循证训练全部接入 (倾听共情/提问/语音微/全流程/个案概念化/备考)
- 游戏化 4 增强 (通关树/徽章墙/错题闯关/晋级赛)
- 全平台 native (iOS/Android/Web/小程序)

---

## 23. Changelog (v0.1 → v0.2)

| 版本 | 日期 | 变更 |
|------|------|------|
| **v0.1** | 2026-10-08 | 初稿, 24 章覆盖 AI 语音训练系统, 1926 行, 文档 `specs/ai-voice-training-v0.1.md` |
| **v0.2** | 2026-10-13 | 整合 v0.1 + 新 spec (大炮 13:25 贴的 v0 文档), 反映 7.10 + P0-1..P0-6 实际 push 状态, 7 拍板 (Q11/Q12 + 5 V0.2 新增), 文档 `specs/ai-voice-training-v0.2.md` |

**v0.2 主要变更 vs v0.1**:
1. **新增** §1.2 / §22 Roadmap: V1.x 路线图 (12%)
2. **新增** A10/A11/A12: JD ECS / V0.5 mock / V0.x 单租户 (大炮 13:45 拍板)
3. **新增** Q11/Q12/Q13/Q14/Q15/Q16/Q17: 7 拍板 (Q11/Q12 大炮 + 5 V0.2 整合)
4. **新增** §7 counselor 5 Tab: 6 P0 done 实际状态 (V0.5 mock + V1.x 改造)
5. **新增** §8 AI 引擎 4 件套: 4 controller + LLM SSE (Batch 4 拍板)
6. **新增** §9/§10/§11: 游戏化 / 商业化 / 安全合规 partial 状态
7. **更新** §19 排期: V0.x 实际进度 (88%) + V1.x 12% pending
8. **更新** §13 数据模型: 加 AIProfileSnapshot / AIUnlockState / AIEffectRecord
9. **更新** §20 风险登记: 加 R12 (训练数据标注成本)
10. **整合** 新 spec §2-§10 内容到 V0.2 各对应章节

---

## 24. 文档索引 (本仓库)

| 路径 | 内容 | 用途 |
|------|------|------|
| `docs/specs/ai-voice-training-v0.1.md` | v0.1 spec 全文 (1926 行, 24 章) | v0.1 原始 spec 参考 |
| `docs/specs/ai-voice-training-v0.2.md` | **v0.2 spec (本文件, 24 章, 整合 + 拍板)** | **当前主 spec, 路线图** |
| `docs/progress/v0.1-progress-snapshot-2026-10-13.md` | 4 batch 扫描快照 (V0.1 spec V0.x 状态) | 快速 resume (状态) |

---

**END OF SPEC V0.2**
