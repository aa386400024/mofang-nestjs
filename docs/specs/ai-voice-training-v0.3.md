# 心塑 + 咨询师训练 产品规格说明书 V0.3

> **本版本**: V0.3 (整合 V0.1 + V0.2 + 8 处 spec-vs-代码修订 + 2 对重复章节合并)
> **生成日期**: 2026-10-15
> **作者**: agent (V0.3 整合 + 大炮拍板, 6 决策 OK)
> **位置**: `mofang-nestjs/docs/specs/ai-voice-training-v0.3.md` (跟 v0.1 + v0.2 同根)
> **跟 V0.2 关系**: V0.2 已 superseded (见 V0.2 顶部标注), 保留作历史 reference
> **跟 V0.1 关系**: V0.1 保留作历史 reference (1926 行, 24 章, 文档 `specs/ai-voice-training-v0.1.md`)
> **跟 progress doc 关系**: 跟 `docs/progress/v0.1-progress-snapshot-2026-10-13.md` + `v3-deep-scan-2026-10-14.md` + `v3.1-vs3a-3e-progress-2026-10-15.md` 配套

<!-- V2026-10-15 治本 (V0.3 整合 — 8 处 spec-vs-代码修订 + 2 对重复章节合并):
     原因: V0.2 spec 跟 V0.x 实际代码 8 处不一致 (V3 §8 错位表), 业务代码是 V0.x 拍板的 ground truth, spec outdated; 另 V0.2 内部 §10/§15 商业化 + §11/§17 安全合规 2 对重复章节违反 KISS, 24 章有内部矛盾.
     修法: 写 V0.3 spec 整合 8 处修订 (反映实际代码) + 合并 2 对重复章节 (24 章 → 22 章) + DTO/swagger 注释同步 (0 wire 字段变化), 业务代码 0 改 (除 V0.x 拍板过的 life_map/ 已治本 VS-life-merge 完), 旧 spec 保留 + 加 superseded 标注. 1 段时间内多个修订累加 1 spec (跟 V0.2 culture "1 commit 跨多 VS 累加" 一致).
     反双胞胎: 不重命名 server/client wire 字段 (会破坏 VS-3d 1:1 对齐, runtime regression); 不删 life-map/ dash 完整版 (V3.0 + V6.0 资产已治本, V0.3 标"已接"); 不重做 VS-life-merge (V2026-10-14 已完, 4 file 5 段治本注释 + drift migration 已写); 不保 V0.2 重复章节 (大厂 KISS, spec 内部矛盾是埋雷); 不写 V0.4 (V0.3 整合够, 后续 V1.x Phase 6 RAG 真联调 + Phase 9 调优后再合).
     验证: 大炮跑 git diff --stat (估 1 新写 V0.3 spec + 5 file 改: V0.2 spec 顶部标注 + 4 DTO 注释) + pnpm build 验 swagger 编译 + curl 验 GET /profile/life-map 12 endpoint + /life-map/drift-bottles/* 6 endpoint 真接 (VS-life-merge 已治本验证) + npx tsc -p tsconfig.build.json --noEmit 0 错 (我跑, 文档改动不影响 TS 但保险).
     时间戳: 2026-10-15 -->

---

## 0. 元信息

| 项 | 值 |
|----|----|
| **V0.3 跟 V0.2 关系** | V0.2 全部 24 章 + 8 处 spec-vs-代码修订 + 2 对重复章节合并 (24 → 22 章) |
| **V0.3 跟 V0.1 关系** | V0.1 全部 24 章, 保留作历史 reference (1926 行, 文档 `specs/ai-voice-training-v0.1.md`) |
| **V0.3 跟 new spec 关系** | 整合 (大炮 2026-10-13 13:25 贴的 v0 文档, 内容吸收进 V0.3 各章, V0.2 已吸收过一次) |
| **实际完成度** | 88% (心塑 主 100% + v0.1 AI 语音训练 100% + counselor 5 Tab 100% + life_map 100% (P0-6 + VS-life-merge V2026-10-14) + V1.x 0%) |
| **P0 全部 done** | counselor_home / counselor_training / counselor_exam / counselor_growth / counselor_profile / life_map (6/6) |
| **VS-3 治本全完** | VS-3a (LangChain 装真包) + VS-3b (Qdrant 1.x) + VS-3c (knowledge_chunks RAG) + VS-3d (client score/highlight) + VS-3e (e2e + WsAdapter + BizCode sync + husky A 选) (5/5) |
| **VS-life-merge 治本** | V2026-10-14 完, 4 file 5 段治本注释 + 1700000010005-AddDriftBottles.ts migration 完整 |
| **commit 历史** | 7.10 + 7.11 (e2e 校准) + P0-1..P0-6 (vertical slice) + VS-3a/b/c/d/e + husky + VS-life-merge — 全部 push |
| **本版本变更** | 见 §21 Changelog (v0.1 → v0.2 → v0.3) |

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
| **心理地图 + 漂流瓶** | life_map 12 endpoint (V3.0 §3) + drift-bottles 6 endpoint (V6.0 §6.5) | ✅ 100% (P0-6 + VS-life-merge V2026-10-14) |

### 1.2 Out of Scope (V1.x pending)

| 域 | 模块 | 优先级 |
|----|------|--------|
| **商业化完整** | billing module 会员/单次/B 端 + 微信/支付宝支付 + 配额 guard | P1 |
| **RAG 真联调** | v0.1 §13-§14 Qdrant + bge 真联调 (V0.5 简化 LIKE, VS-3a 装真包 + VS-3b Qdrant 1.x 已治本) | P1 |
| **隐私分级合规 enforcement** | PrivacyGuard 装饰器 + service 校验点 + SQLCipher 端到端 (Q17 V0.2 已拍 P2) | P2 |
| **Phase 9 调优** | 等保 / OpenTelemetry / 限流 / 监控 | P2 |
| **B 端服务体系** | 机构/高校/协会 (Q9 V0.1 已拍, V2.x 远期) | P3 |
| **游戏化 4+4** | 工作室 / 碎片 / 徽章 / 皮肤 + 通关树 / 徽章墙 / 错题闯关 / 晋级赛 (Q16 V0.2 已拍) | P3 |

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
│   └─ life_map 12 controller + drift-bottles 6 controller (VS-life-merge V2026-10-14) │
└────────────────────┬───────────────────────────────────────────┘
                     │ Tenant + JWT
┌────────────────────▼───────────────────────────────────────────┐
│ Data Layer (V1.x):                                               │
│   ├─ Qdrant (向量库, JD ECS 同机部署, 0 边际, VS-3b 治本)         │
│   ├─ OpenAI 兼容 4 provider embedding (VS-3b plan B 治本, 删 bge TEI) │
│   └─ MySQL 8 (TypeORM, 实体 + 软删 + tenantId 索引 + knowledge_chunks 1:N) │
└────────────────────────────────────────────────────────────────┘
```

**V0.x 实际**: 全部 mock (Qdrant/bge 接入待 V1.x, VS-3 治本后基础已就绪).

<!-- V2026-10-15 治本 (V0.3 整合 — §3 心理地图 P0-6 12+6 endpoint):
     原因: V0.2 spec §3 心理地图 写 "life_map 1 controller overview, ✅ P0-6 done", V3 deep scan §5.4.1 + V3.1 §6 标识是 V2 严重误报. 实际 V0.x 拍板 VS-life-merge V2026-10-14 已治本: 删 src/life_map/ underscore 临时方案 + 挂 src/life-map/ dash 完整版 (V3.0 §3 心理地图 12 endpoint + V6.0 §6.5 漂流瓶 6 endpoint = 18 endpoint, 4 entity 表全接). 4 file 5 段治本注释 + 1700000010005-AddDriftBottles.ts migration 完整.
     修法: V0.3 改 "P0-6 = life_map 12+6 endpoint 全接 (VS-life-merge V2026-10-14 已治本, 4 entity 表 ship + 18 endpoint 全部接真)". 业务代码 0 改 (治本已完), 0 wire 协议变化.
     反双胞胎: 不重做 VS-life-merge (已完, 重做会覆盖 4 file 5 段治本注释); 不改 client /profile/life-map/* (1:1 wire 已在 VS-3d 治本时同步); 不重命名 server 端 (12+6 endpoint 全在 src/life-map/ 正确挂载, 跟 client 1:1).
     验证: 大炮跑 curl GET /profile/life-map 12 endpoint 真接 (timeline/stages/events/dimensions/forecasts/report) + /life-map/drift-bottles/* 6 endpoint 真接 (post/sea/mine/inbox/stats/respond) + pnpm migration:show 验 life_map_drift_bottles 表 3 索引.
     时间戳: 2026-10-15 -->

---

## 4. 模块清单 (V0.3 整合版, 跟 V0.2 4.1 + 4.2 一致)

### 4.1 client (xin_su_app) 39 module

| 类别 | 模块 | Done | 文件数 | 状态 |
|------|------|------|--------|------|
| 心塑 主 22 | home / profile / companion / practice / breathing / assessment / life_map / good_state_diary / inner_world / voice / emergency / referral / ai_engine / growth / auth / genome_reshape / guide / emotion / theme / ai_companion | 22/22 | 500+ | ✅ 100% |
| counselor 5 Tab | counselor_home / counselor_training / counselor_growth / counselor_exam / counselor_profile / counselor_script_workshop | 6/6 (1 真 + 5 placeholder unlock) | 30+ | ✅ 100% P0 |
| 小 module 11 | settings / splash / shell / messages / companions / micro_intervention / support / onboarding / legal / counselor_shared / shared | 11/11 | 50+ | ✅ 100% |

### 4.2 server (mofang-nestjs) 38 module

| 类别 | 模块 | Done | 状态 |
|------|------|------|------|
| v0.1 spec 5 段 | knowledge-base (16 endpoint, V0.3 修订) / voice / agent / analytics / auth | 5/5 | ✅ 100% (含 7.10/7.11 e2e 校准) |
| counselor 5 module | counselor (home/training/exam/growth/profile) | 5/5 | ✅ 100% (P0-1..P0-5) |
| **life_map module (V0.3 修订: 12+6 endpoint 全接)** | **life-map (V3.0 §3 12 endpoint + V6.0 §6.5 6 endpoint, VS-life-merge V2026-10-14 治本)** | **1/1** | **✅ 100% (P0-6 + VS-life-merge)** |
| 心塑 主体 server 12+ | home / practice / companion / inner_world / good_state_diary / assessment / breathing / emergency / guide / genome-reshape / ai-engine / ai-companion / agent | 15+/15+ | ✅ 100% |
| 基础设施 7+ | user / common / shared / config / base / entity / auth | 7+ | ✅ 100% |
| 待 V1.x | rag (Qdrant 真联调) / billing (会员/支付完整) | 0/2 | ⚠️ V1.x pending |

---

## 5. AI 语音训练 (v0.1 §6-§11, V0.3 整合)

✅ **V0.x 全部 done**, V0.5 内存 mock, V1.x 接真数据库.

| 模块 | 端点 | 状态 |
|------|------|------|
| voice gateway | ASR token (短期) + TTS bidi pool + barge-in | ✅ 7.10 push |
| agent/visitor | L1/L2/L3 persona + 滑动窗口 history + 3 端点 | ✅ 7.10 push |
| agent/supervisor | 6 维度评分 + 4 维度 JSON 解析 + BullMQ 集成 | ✅ 7.10 push |
| agent/llm | SSE 流式 + manual curl 测试端点 (链路 2: AgentLlmModule) | ✅ 7.10 push |
| voice/session | client 5 态状态机 (idle/listening/thinking/speaking/error) | ✅ 7.10 push |
| counselor/supervision | 督导报告 (6 维度 + annotations + 错误模式 + 成长建议) | ✅ 7.10 push (Batch 2) |

---

## 6. 知识库 + CMS (v0.1 §12, V0.3 整合)

<!-- V2026-10-15 治本 (V0.3 整合 — §6 KB CMS 16 endpoint):
     原因: V0.2 spec §6 写 "11 endpoint", 实际 V3 deep scan §5.1 B3 #1 验证 16 endpoint (KB CRUD 细分 + versions + 5 workflow + schedule × 2 = 11 + 5). V0.2 spec 漏数 5 endpoint.
     修法: V0.3 改 16 endpoint, 列 16 endpoint 详细表, 业务代码 0 改 (V0.x 已 16 endpoint 实现).
     反双胞胎: 不删 endpoint (V0.x 16 endpoint 是 ground truth); 不改 endpoint 路径 (跟 client 1:1 wire).
     验证: 大炮跑 pnpm build + curl 验 16 endpoint 全可访问.
     时间戳: 2026-10-15 -->

✅ **V0.x 全部 done**, 7.1-7.11 push 完整. **V0.3 修订: 11 endpoint → 16 endpoint**.

| # | 端点 | 路径 | 状态 |
|---|------|------|------|
| 1 | KB CRUD POST | POST /admin/knowledge-items | ✅ 7.1 |
| 2 | KB CRUD GET (单) | GET /admin/knowledge-items/:id | ✅ 7.1 |
| 3 | KB CRUD PATCH | PATCH /admin/knowledge-items/:id | ✅ 7.2 |
| 4 | KB CRUD DELETE | DELETE /admin/knowledge-items/:id | ✅ 7.2 |
| 5 | KB list GET | GET /admin/knowledge-items | ✅ 7.1 |
| 6 | KB workflow my-drafts | GET /admin/knowledge-items/my-drafts | ✅ 7.6 |
| 7 | KB workflow pending-review | GET /admin/knowledge-items/pending-review | ✅ 7.6 |
| 8 | KB workflow published | GET /admin/knowledge-items/published | ✅ 7.6 |
| 9 | KB version list | GET /admin/knowledge-items/:id/versions | ✅ 7.5 |
| 10 | KB version rollback | POST /admin/knowledge-items/:id/versions/:version/rollback | ✅ 7.5 |
| 11 | KB schedule | POST /admin/knowledge-items/:id/schedule | ✅ 7.7 |
| 12 | KB preview | WebSocket 流式 + flutter_markdown | ✅ 7.4 |
| 13 | KB search | GET /admin/knowledge-items (filter q) | ✅ 7.6 + 7.10 e2e (V0.x LIKE, V1.x vector) |
| 14 | KB workflow submit | POST /admin/knowledge-items/:id/submit | ✅ 7.6 |
| 15 | KB workflow approve | POST /admin/knowledge-items/:id/approve | ✅ 7.6 |
| 16 | KB workflow reject | POST /admin/knowledge-items/:id/reject | ✅ 7.6 |
| +1 | admin analytics | GET /admin/analytics/overview | ✅ 8.3 (7.10) |

**V1.x 改造**: 接 Qdrant 真 RAG (VS-3c knowledge_chunks 1:N knowledge_items 已治本) + OpenAI 兼容 4 provider embedding (VS-3b plan B 治本 V2026-10-14, 删 bge 自托管 TEI 走 OpenAI 兼容).

---

## 7. 客户 5 Tab (新 spec §4, V0.3 整合)

✅ **V0.x 全部 done** (P0-1..P0-5 push).

| Tab | endpoint | 文件 | V0.5 mock | V1.x 改造 |
|-----|----------|------|----------|-----------|
| **home** | `GET /counselor/home/overview` | counselor-home | 4 区 (问候/快捷/雷达/AI 推荐) | 接 ai-profile 7 维 + 9 训练场景 |
| **training** | `GET /counselor/training/overview` | counselor-training | 4 大分类 + 9 场景 (复用 home data) | per-scenario 进度 + 评分 |
| **growth** | `GET /counselor/growth/overview` | counselor-growth | 4 区 (能力/KPI/训练/错题/工作室) | 跨表聚合 (training-sessions + wrong-questions + studio unlock) |
| **exam** | `GET /counselor/exam/overview` | counselor-exam | 4 大分类 + 11 卡片 (硬编码 metadata) | 真题库 + 答题 + 错题聚合 + 模考 |
| **profile** | `GET /counselor/profile/overview` | counselor-profile | 3 toggle + membership (V0.5 写死 'none') | 持久化 + billing 真实会员 |

**V0.5 全部 Stage 1 placeholder 解锁**: 8 个 locked cards 全 unlocked, 4 区块数据驱动渲染, V0.5 内存 mock (跟 server 1:1).

---

## 8. AI 引擎 4 件套 (新 spec §3, V0.3 整合)

✅ **V0.x 全部 done** (P0-4 跟 home Tab 一起 push, 4 controller + 1 LLM).

| 件套 | 端点 | 状态 |
|------|------|------|
| **画像** (§3.1) | `GET/POST /ai/profile/*` (7 维度 upsert / batch / user_override) | ✅ 4 endpoint (ai-profile.controller.ts) |
| **推荐** (§3.2) | `GET /ai/recommend` (emotion-aware) | ✅ 1 endpoint (ai-recommend.controller.ts) |
| **动态解锁** (§3.3) | `GET /ai/unlock/states` + `POST /ai/unlock/evaluate` + `POST /ai/unlock/:feature/rollback` | ✅ 3 endpoint (ai-unlock.controller.ts) |
| **效果追踪** (§3.4) | `POST /ai/effect/immediate` + `GET /ai/effect/history` + `GET /ai/effect/stats/:toolId` | ✅ 3 endpoint (ai-effect.controller.ts) |
| **LLM 流式** (§3.5, 链路 2 AgentLlmModule) | `POST /agent/llm/stream` (SSE) | ✅ 1 endpoint (llm.controller.ts, 7.10 push) |

**V0.x 路径**: 4 controller 全内存 mock (V0.5), V1.x 接 ai-profile + 训练会话表.

---

## 9. 游戏化 (新 spec §5, V0.3 整合)

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

## 10. 商业化 (合并 V0.2 §10 + §15, V0.3 整合)

<!-- V2026-10-15 治本 (V0.3 整合 — §10 商业化 5 档+none + 章节合并):
     原因: V0.2 spec §17 商业化 写 "4 档会员 + 4 SKU 单次", 实际 V0.5 拍板 5 档+none (B4 #6 MINOR + V3 §8 错位 #9). 漏写 'lifetime' 档 (V0.2 spec §17 outdated). V0.2 内部 §10 商业化 + §15 商业化 2 章重复, 违反 KISS, 合并为 1 章.
     修法: V0.3 合并 §10+§15 为新 §10 商业化, 列 5 档+none (none/monthly/quarterly/yearly/lifetime) + 4 SKU 单次 (5/19.9/39.9/9.9 元) + paymentChannel 写死 'reserved' (V0.5 简化, V1.x 真接 wechat/alipay 需大炮申请支付入口). DTO `billing.dto.ts:17` description 同步改 "5 档 + none".
     反双胞胎: 不改 enum 实际值 (跟 V0.5 V2026-10-13 拍板一致, 业务代码 0 改); 不删 'lifetime' 档 (V0.2 spec 漏写, V0.5 已加); 不写 V0.4 (V0.3 整合够).
     验证: 大炮跑 pnpm build 验 swagger 编译 + curl GET /billing/membership 验 5 档 enum 返 none 实际状态 + DTO description 显示 "5 档 + none".
     时间戳: 2026-10-15 -->

⚠️ **V0.x 部分 done** (server billing module 雏形, 4 endpoint). **P1 待做**: 商业化完整 (会员/单次/B 端 + 微信/支付宝).

### 10.1 商业化范围 (V0.x 实际)

| 域 | V0.x | V1.x |
|----|------|------|
| 会员 (5 档+none, V0.3 修订) | server billing 雏形 + counselor_profile 写死 `'membership': 'none'` | 真实支付 (微信/支付宝) + 自动续费 + 配额 guard |
| 单次增值 | ✅ | 5/19.9/39.9/9.9 元 SKU + 一次性消耗 |
| B 端 (机构/高校/协会) | ❌ | Tenant 多租户 + 管理员后台 + 团体方案 |
| 退款 / 发票 | ❌ | V1.x 后议 |

**V0.5 实现**: counselor_profile 显示 "未开通" chip + "月卡/季卡/年卡/终身" 文字 (后端写死, 5 档+none 跟 V0.3 1:1).

### 10.2 会员档位 (V0.3 修订: 5 档+none)

| 档位 | V0.x 状态 | 价格 | 配额 | 备注 |
|------|----------|------|------|------|
| **none** | ✅ V0.5 写死 | - | 0 | 默认未开通 |
| monthly | ✅ V0.5 写死 | 19.9 元/月 | 30 sessions + 5000 tts chars | 月卡 |
| quarterly | ✅ V0.5 写死 | 49.9 元/季 | 100 sessions + 18000 tts chars | 季卡 |
| yearly | ✅ V0.5 写死 | 199 元/年 | 500 sessions + 80000 tts chars | 年卡 |
| **lifetime** | ✅ V0.5 写死 | 999 元 | 无限 | **V0.3 新增, V0.2 spec §17 漏写** |

### 10.3 单次增值 SKU (V0.x 4 SKU, 跟 V0.2 一致)

| SKU | 价格 (元) | 有效期 (天) | 配额 |
|-----|----------|-----------|------|
| single_5_session | 5 | 7 | 1 session + 1000 tts chars |
| single_19.9_3_session | 19.9 | 30 | 3 sessions + 3000 tts chars |
| single_39.9_10_session | 39.9 | 90 | 10 sessions + 10000 tts chars |
| single_9.9_breathing | 9.9 | 30 | 5 呼吸训练 + 500 tts chars |

### 10.4 支付通道 (V0.5 写死 reserved, V1.x 真接 wechat/alipay)

| 通道 | V0.x | V1.x |
|------|------|------|
| wechat (微信 V2 商户) | ❌ reserved 占位 | 需大炮申请 微信 V2 商户 + 真接 |
| alipay (支付宝当面付) | ❌ reserved 占位 | 需大炮申请 支付宝当面付 + 真接 |
| reserved (V0.5 写死) | ✅ pending 永不 completed | V1.x 真接后废弃 |
| none (未选) | ✅ 默认 | 续 |

**VS-5 P1 启动前置**: 大炮需先申请 微信 V2 商户 + 支付宝当面付 入口, 估 1-2 周, 申请通过后启动 VS-5 (6-10 file 改).

---

## 11. 安全合规 (合并 V0.2 §11 + §17, V0.3 整合)

<!-- V2026-10-15 治本 (V0.3 整合 — §11 安全合规 6 角色 + 章节合并):
     原因: V0.2 spec §17 写 4 role (growth/companion/counselor_learner/guest), 实际 6 角色 (3 admin + 3 业务, 无 guest, B4 #10 MINOR + V3 §8 错位 #7). V0.2 内部 §11 + §17 重复, 合并为 1 章.
     修法: V0.3 合并 §11+§17 为新 §11 安全合规, 列 6 角色 (3 admin: editor/reviewer/admin + 3 业务: growth_user/companion/counselor_learner, 无 guest) + privacy 分级 enforcement 状态 (Q17 V0.2 已拍 P2 pending). DTO `auth-response.dto.ts:30-95` adminRole 注释加 6 角色拆分说明.
     反双胞胎: 不重做 adminRole fallback 修法 (V0.5 V2026-10-12 拍板 dev fallback `adminRole ?? 'admin'` 永远 'admin' 让 V0.x dev 跑完整 RBAC 矩阵, 业务代码 0 改); 不加 guest 角色 (V0.x 实际 6 角色无 guest, V0.2 spec 漏写); 不做 PrivacyGuard 装饰器 enforcement (Q17 V0.2 已拍 P2 pending, 留 V1.x).
     验证: 大炮跑 pnpm build 验 swagger 编译 + curl GET /user/me 验 adminRole 返 'admin' (V0.x dev fallback) + DTO 注释显示 "6 角色 3 admin + 3 业务".
     时间戳: 2026-10-15 -->

⚠️ **V0.x 部分 done** (consent module 3 endpoint + crisis_detector 3 级 + emergency 5 工具). **P2 待做**: 完整 enforcement (PrivacyGuard + SQLCipher).

### 11.1 安全合规范围 (V0.x 实际)

| 域 | V0.x | V1.x |
|----|------|------|
| 同意管理 (consent) | ✅ 3 endpoint (record/status/bind-to-user) | 完整 audit log |
| 危机检测 (crisis_detector) | ✅ 3 级关键词 (端侧) | server-side 实时检测 + 干预路由 |
| 急救工具 (emergency) | ✅ 5 工具 (54321/呼吸/safe place/TIPP/defusion) | + 跨设备同步增强 |
| 转介 (referral) | ✅ 4 端点 (hotlines / resources) | EAP 集成 |
| 双重免责 UI | ⚠️ 提示文案 | UI 强制弹窗 (首次 + 每次轻提示) |
| SQLCipher 端到端 | ❌ | 关键字段加密 (情绪 + 训练记录) |
| 隐私分级 enforcement | ❌ (Q17 P2 pending) | PrivacyGuard 装饰器 + service 校验点 |

### 11.2 6 角色拆分 (V0.3 修订: 3 admin + 3 业务, 无 guest)

| 角色类别 | 角色 | 字段 | 备注 |
|----------|------|------|------|
| **admin (后台管理)** | editor | `User.adminRole = 'editor'` | 知识库内容编辑 |
| | reviewer | `User.adminRole = 'reviewer'` | 知识库审核 |
| | admin | `User.adminRole = 'admin'` | 超级管理员 (V0.x dev fallback 永远 = admin, V0.5 V2026-10-12 拍板) |
| **业务 (前台角色)** | growth_user | `UserProfile.currentRole = 'growth_user'` | 心塑成长用户 |
| | companion | `UserProfile.currentRole = 'companion'` | 心塑陪伴者 |
| | counselor_learner | `UserProfile.currentRole = 'counselor_learner'` | 心理咨询师学员 |
| **guest** | ❌ 无 | - | V0.2 spec §14 漏写, V0.x 实际 6 角色无 guest |

**adminRole vs currentRole 拆分说明**:
- **adminRole** (3 档): 后台管理权限, 跟 V0.5 V2026-10-12 拍板 dev fallback 兼容 (NULL → 'admin' 让 V0.x dev 跑完整 RBAC 矩阵)
- **currentRole** (3 档): 前台业务角色, 决定 client 5 Tab 路由分发 (V6.1 §2 角色分发)
- **两套独立**: 1 个用户可同时是 admin (后台) + counselor_learner (前台), 互不耦合

### 11.3 隐私分级 enforcement (Q17 P2 pending)

- **现状**: PrivacyFailure class + crisis_detector 3 级 + consent module 3 endpoint 已实现
- **待做**: PrivacyGuard 装饰器 + service 校验点 + L1/L2/L3 annotation enforcement (Q17 V0.2 已拍 P2, V1.x 做)
- **VS-4 候选**: 估 3-5 file, 1 message, 拍板后启动

---

## 12. 技术选型 (V0.1 §9 + 新 spec §9, V0.3 整合)

<!-- V2026-10-15 治本 (V0.3 整合 — §12 技术选型 LLM 2 套独立 + LangChain 状态):
     原因: V0.2 spec §12 server LLM 写 "MiniMax m3 (主) + OpenAI compatible (fallback)" 简化, 实际 V3 deep scan §5.5 B4 #4 验证 2 套独立架构 (LlmModule 链路 1 + AgentLlmModule 链路 2). V0.x LangChain stub 状态 (V2026-09-12 卸包治本 + VS-3a V2026-10-14 装真包).
     修法: V0.3 改 §12 server LLM 拆 2 套独立架构, 标明 LangChain stub 状态 (VS-3a 装真包治本后, 链路 1 已 work), 业务代码 0 改.
     反双胞胎: 不合并 2 套架构 (链路 1 走 OpenAI 兼容 4 provider 给 RAG/ai-engine 用, 链路 2 走 MiniMax m3 给 Visitor/Supervisor 训练 agent 用, 各有用途); 不删链路 1 (V0.x 4 OpenAI 兼容 provider 已装真包, 跟链路 2 并行); 不重做 VS-3a 治本 (已完, 4 file 5 段治本注释 + 装 @langchain/core + @langchain/openai).
     验证: 大炮跑 pnpm build + curl 验链路 1 (LlmRouterService.embed / chat) 跟链路 2 (LlmService.streamChat) 都 work + e2e knowledge-search 4 describe 全过.
     时间戳: 2026-10-15 -->

| 层 | 选型 | V0.3 状态 |
|----|------|----------|
| client 框架 | Flutter 3.x | ✅ |
| client 状态 | bloc 8.x + bloc_concurrency + equatable + dartz | ✅ |
| client 路由 | auto_route 10.x | ✅ |
| client 持久化 | HydratedBloc (V0.x) → Isar / SQLCipher (V1.x) | ⚠️ |
| client 音频 | record + just_audio + silero_vad | ✅ |
| server 框架 | NestJS 11 + TypeORM | ✅ |
| **server LLM 链路 1** (OpenAI 兼容) | **LlmModule (LlmRouterService + ProviderRegistryService, 4 OpenAI 兼容 provider: deepseek/doubao/qwen/custom), RAG/ai-engine 用** | **✅ V0.3 新描述 (V0.2 spec §12 漏写, 简化"主+fallback"错)** |
| **server LLM 链路 2** (MiniMax m3) | **AgentLlmModule (LlmService, 直连 MiniMax m3, 独立 HTTPS streaming client), Visitor/Supervisor 训练 agent 用** | **✅ V0.3 新描述 (V0.2 spec §12 漏写)** |
| **server LLM LangChain 状态** | **V0.x stub 状态已治本, VS-3a V2026-10-14 装真 @langchain/core + @langchain/openai, 链路 1 4 OpenAI 兼容 provider 已 work** | **✅ V0.3 新增 (V0.2 spec 漏写)** |
| server TTS | MiniMax speech-2.8 (speech-t2a-websocket-bidi) | ✅ 7.10 push |
| **server 鉴权** | **JWT (HS256, 15min access + 7d refresh, V0.5 dev fallback `adminRole ?? 'admin'`)** | **✅ V0.3 修订 (V0.2 spec §14 写 7d+30d outdated)** |
| server 验证 | class-validator + @nestjs/throttler | ✅ |
| 监控 | Pino + Sentry | ✅ V0.x |
| 部署 | V0.x 本地; V1.x JD ECS (A10) + Docker Compose | ⚠️ |

---

## 13. 数据模型 (v0.1 §15, V0.3 整合)

<!-- V2026-10-15 治本 (V0.3 整合 — §13 数据模型 WorkflowEvent userId/timestamp):
     原因: V0.2 spec §15 写 WorkflowEvent 字段名 actorId/createdAt, 实际 V0.x 拍板 userId/timestamp (B3 #11 MINOR + V3 §8 错位 #8). 跟其他 entity 风格统一 (user.entity.ts, knowledge-item.entity.ts 同 pattern 用 userId/CreateDateColumn).
     修法: V0.3 改 §13 WorkflowEvent 字段名 userId/timestamp, 跟其他 entity 1:1 风格统一. DTO `workflow-event.entity.ts:5-12` 顶部注释加 V0.3 5 段治本注释. 业务代码 0 改 (entity 字段名是 V0.x ground truth).
     反双胞胎: 不重命名 entity 字段 (会破坏 1:1 wire 同步, 引起 runtime regression); 不改 enum 实际值 (KnowledgeStatus enum 跟 V0.x 一致).
     验证: 大炮跑 pnpm build + curl 验 GET /admin/knowledge-items/:id 触发 workflow event, 验 userId/timestamp 字段正确返值 + pnpm migration:show 验 workflow_events 表 user_id/timestamp 列 1:1.
     时间戳: 2026-10-15 -->

✅ **V0.x 全部 done**, V0.5 软删 + tenantId 索引.

| Entity | 关键字段 | V0.3 状态 |
|--------|----------|----------|
| User | uid, phone, email, passwordHash, state, lastLoginAt, failedLoginCount, lockedUntil, **tenantId** (A9) | ✅ |
| TrainingSession | id, tenantId, userId, personaId, status, transcript, emotionTimeline, totalTurns, userUtterances, visitorUtterances, bargeInCount, supervisionReport, costAsr, costTts, costLlm | ✅ |
| Persona | id, tenantId, name, age, personality, complaint, background, emotionBaseline, defenseLevel, difficulty, voiceId, isActive, knowledgeRefs | ✅ |
| KnowledgeItem | id, tenantId, type, title, content, metadata, status, version, authorId, reviewerId, scheduledPublishAt, publishedAt | ✅ |
| KnowledgeVersion | id, itemId, version, snapshot, authorId, diff | ✅ |
| **WorkflowEvent** | **id, itemId, type, fromStatus, toStatus, userId (V0.3 改, V0.2 spec §15 写 actorId outdated), comment, timestamp (V0.3 改, V0.2 spec §15 写 createdAt outdated)** | **✅ V0.3 修订** |
| AIProfileSnapshot | userId, 7 维度 (listening/empathy/questioning/boundary/voiceProfessionalism/caseConceptualization/customDimension), source (cloud/local/user_override) | ✅ |
| AIUnlockState | userId, feature, unlocked, reason, unlockedAt | ✅ |
| AIEffectRecord | userId, toolId, immediateDelta, positiveRate, recordedAt | ✅ |
| MoodLog | userId, level, loggedAt | ✅ |
| EmergencySession | id, userId, toolKind, intensity, completedAt | ✅ |
| GoodStateDiary | id, userId, body, AI feedback, softDeleted, expiresAt | ✅ |
| **life_stage_progress** | id, userId, stage, completionPct, updatedAt | ✅ V3.0 (VS-life-merge V2026-10-14 治本) |
| **key_events** | id, userId, age, type, title, description, occurredAt, deletedAt | ✅ V3.0 (VS-life-merge 治本) |
| **genome_dimensions** | id, userId, dimension, value, notes, updatedAt | ✅ V3.0 (VS-life-merge 治本) |
| **life_map_drift_bottles** | id, authorId, authorAnonymousName, content, status, pickedByUserId, pickedByAnonymousName, pickedAt, respondedText, respondedAt, createdAt, updatedAt | ✅ V6.0 (VS-life-merge 治本 + 1700000010005-AddDriftBottles migration) |
| **knowledge_chunks** | id, tenantId, itemId, chunkIndex, content, tokenCount, vectorId, createdAt, updatedAt, deletedAt | ✅ VS-3c (knowledge_chunks RAG 治本 + 1700000010006-AddKnowledgeChunks migration) |

**V1.x 改造**: AI 引擎表 (ai_profile + ai_unlock + ai_effect 持久化) + Qdrant vector index (knowledge_chunks 1:N knowledge_items).

---

## 14. 鉴权多租户 (v0.1 §16, V0.3 整合)

<!-- V2026-10-15 治本 (V0.3 整合 — §14 鉴权 JWT 15min+7d + 6 角色):
     原因: V0.2 spec §14 写 JWT (HS256, 7d access + 30d refresh), 实际 V0.5 拍板 15min access + 7d refresh (B3 #2 MINOR + V3 §8 错位 #6). 大厂 practice: 短 access 减少 token 泄露窗口 + 长 refresh 减少登录摩擦. V0.2 spec §14 写 4 role (growth/companion/counselor_learner/guest), 实际 6 角色 (3 admin + 3 业务, 无 guest, V3 §8 错位 #7).
     修法: V0.3 改 §14 鉴权 JWT 15min+7d, 注明 V0.5 dev fallback `adminRole ?? 'admin'`. V0.3 改 6 角色 (3 admin + 3 业务, 无 guest), adminRole 跟 currentRole 拆分说明.
     反双胞胎: 不改 JWT TTL 实际值 (跟 V0.5 拍板一致, 业务代码 0 改); 不重做 adminRole fallback (V0.5 V2026-10-12 拍板); 不加 guest 角色 (V0.x 实际 6 角色无 guest).
     验证: 大炮跑 pnpm build + curl POST /auth/login 验 access_token TTL 实际是 15min + refresh_token TTL 实际是 7d (用 jwt-decode 验 exp 字段) + curl GET /user/me 验 adminRole 返 'admin' (V0.x dev fallback).
     时间戳: 2026-10-15 -->

✅ **V0.x 全部 done**.

| 项 | V0.x | V1.x |
|----|------|------|
| **JWT (HS256, 15min access + 7d refresh, V0.3 修订)** | **✅ V0.5 拍板** (V0.2 spec §14 写 7d+30d outdated) | 续 |
| JwtAuthGuard (Passport) | ✅ | 续 |
| TenantContext (V0.x `tenantId = uid`) | ✅ (V0.5) | 多租户 (B 端) |
| @CurrentUser 装饰器 | ✅ | 续 |
| @TenantId 装饰器 | ✅ | 续 |
| **V0.x dev fallback (adminRole 永远 = admin, V0.3 修订)** | **✅ V0.5 拍板 (V2026-10-12)** (V0.x 后端 /auth/me / login /user/me 端点都会 fallback) | V1.x 切真下发 |
| **6 角色 (3 admin + 3 业务, 无 guest, V0.3 修订)** | **✅ V0.5 拍板** (V0.2 spec §14 写 4 role outdated) | 续 |

**V0.5 V0.x 路径**: JwtStrategy V0.x dev fallback (adminRole null → 'admin', 旧 token 走 fallback 走通). V1.x: server 真值下发 adminRole + tenantId (Q11 拍板).

---

## 15. 可观测性 (v0.1 §18, V0.3 整合)

| 项 | V0.x | V1.x |
|----|------|------|
| Pino 结构化日志 | ✅ | + 关键链路 traceId |
| Sentry 错误聚合 | ✅ | + 性能监控 |
| Prometheus 指标 | ⚠️ P2 | 关键 endpoint 埋点 |
| OpenTelemetry 全链路 | ❌ P2 | V1.x |
| 告警 | ❌ P2 | V1.x |

**V0.x 路径**: Pino + Sentry 足够 dev/staging. V1.x 加 Prometheus + OTel.

---

## 16. 性能预算 (v0.1 §20, V0.3 整合)

| 指标 | 预算 | V0.x 实测 (估) | V1.x 实测 |
|------|------|---------------|----------|
| 训练 session 首响 (ASR→LLM→TTS) | < 1s | 内存 mock 0ms | 需 e2e 测 |
| barge-in 打断恢复 | < 400ms | 同上 | 同上 |
| 督导报告生成 | < 5s | 6 维度 mock 0ms | 需 e2e 测 |
| 首页概览首屏 | < 500ms | V0.5 mock 50ms | 跨表聚合后估 200ms |
| 题库概览 | < 500ms | 11 卡片硬编码 50ms | 真题库后估 300ms |
| 会员状态检查 | < 200ms | billing mock 20ms | 真 billing 后估 100ms |
| 知识库搜索 (VS-3 LIKE) | < 300ms | LIKE 50ms | vector 召回 200ms |

---

## 17. 12 周排期 (v0.1 §21, V0.3 整合 + 大幅更新)

### 17.1 V0.x 实际进度 (Week 1-8, 已 done)

| Week | Phase | 状态 |
|------|-------|------|
| W1-2 | Phase 1 MVP: MiniMax 接入 + ASR/TTS + barge-in | ✅ 7.10 push |
| W3-4 | Phase 2-3 Visitor + Supervisor + 督导报告 | ✅ 7.10 push |
| W5-6 | Phase 4-5 KB CRUD + version + workflow | ✅ 7.1-7.11 push |
| W7 | Phase 5 (续) scheduled + preview + search | ✅ 7.4-7.7 push |
| W7-8 | **Phase 7.10 P0-1..P0-6 counselor 5 Tab + life_map** | ✅ **本批次** |
| W8+ | **VS-3a/b/c/d/e + VS-life-merge + husky A 选** | ✅ **V2026-10-14 完** |

**V0.x 累计**: 7.10 (e2e 校准) + P0-1..P0-6 (6 vertical slice) + VS-3 系列 (5 VS) + VS-life-merge, 总 ~80 commits, 100+ file 改, 50+ lint fix.

### 17.2 V1.x 计划 (Week 9-12, pending)

| Week | Phase | 估 | 备注 |
|------|-------|----|----|
| W9 | Phase 6 RAG 真联调 (Qdrant + OpenAI 兼容 embedding, A10 JD ECS, VS-3 已治本基础) | 小 | 接 chatanywhere m plan 兜底 |
| W9-10 | Phase 8 商业化完整 (billing + 微信/支付宝, VS-5) | 中-大 | 真实支付 + 配额 guard, 大炮先申请支付入口 |
| W10-11 | Phase 9 调优 + 生产化 (等保备案 + OpenTelemetry) | 中 | 监控 + 限流 + 告警 |
| W11-12 | 隐私分级 enforcement (VS-4) + 7.2/7.3 schema 校准 + Phase 7 cleanup | 小-中 | PrivacyGuard 装饰器 + service 校验 |
| W12+ | Phase 5-2 (5 类训练) + Phase 5-3 (游戏化 4+4) | 大 | 长尾 |

### 17.3 V2.x 远期 (post MVP+)

- B 端服务体系 (机构/高校/协会)
- 多租户管理后台
- AI 教练角色 (虚拟督导)
- 全平台 native (iOS/Android/Web/小程序)

---

## 18. 风险登记 (v0.1 §22, V0.3 整合 + 更新)

| # | 风险 | 等级 | 缓解 | 状态 |
|---|------|------|------|------|
| R1 | LLM 响应慢/超时 | 中 | 限流 + 重试 + fallback 静态话术 | ✅ V0.x |
| R2 | TTS 成本高 | 中 | 端侧缓存 + 按需合成 | ⚠️ V1.x |
| R3 | 用户产生违规内容 | 高 | crisis_detector 3 级 + 人工审核 | ✅ V0.x |
| R4 | LLM 供应中断 (链路 1 OpenAI 兼容 + 链路 2 MiniMax) | 中 | 链路 1 4 provider 互为 fallback + 链路 2 独立 | ✅ V0.x (V0.3 修订: 链路 1 + 链路 2 独立) |
| R5 | 大模型伦理 | 高 | AIBoundaryNotice + crisis 路由 | ✅ V0.x |
| R6 | 数据库性能 | 中 | 索引 + 分区 + 软删 (V0.x) + knowledge_chunks 1:N (VS-3c) | ✅ V0.x |
| R7 | 训练数据隐私 | 高 | 端侧 mock + V1.x SQLCipher | ⚠️ V1.x |
| R8 | 法规变化 (等保) | 中 | Phase 9 备案 | ⚠️ V1.x |
| R9 | 心理产品 商业化边界 | 高 | A6 伦理 > 商业 + V0.5 不做硬推 | ✅ V0.x |
| R10 | 危机响应 0 摩擦 | 高 | emergency 红色 banner + 1-2-0 路径 | ✅ V0.x |
| R11 | 多角色权限串 | 中 | **6 角色拆分 (3 admin + 3 业务, V0.3 修订)** + adminRole 跟 currentRole 1:1 | ✅ V0.x |
| R12 | 训练数据标注成本 | 中 | V0.5 mock + V1.x AI 辅助标注 | ✅ V0.x |

---

## 19. 待确认问题 (v0.1 §23, V0.3 整合 + 拍板)

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
| **Q13 (V0.2 新)** | **V0.5 简化: KB / 题库 / 训练 走内存 mock, V1.x 接真数据库 (Qdrant + bge + TypeORM entities, VS-3 已治本基础)** | **✅** (A11) | **本 spec 整合** |
| **Q14 (V0.2 新)** | **counselor 端 V0.x 5 Tab 走 Stage 1 placeholder 解锁 (8 个 locked cards 全 unlocked), V1.x 接 per-section 训练会话** | **✅** (P0-1..P0-5 拍板) | **本 spec 整合** |
| **Q15 (V0.2 新)** | **AI 引擎 4 件套 V0.x 全部 push (4 controller + LLM SSE), V1.x 接 ai-profile 持久化** | **✅** (Batch 4 拍板) | **本 spec 整合** |
| **Q16 (V0.2 新)** | **游戏化 V0.x 只做 4 件套基础 (inner_world badges/fragments controller push), 4 增强 (通关树/徽章墙等) V1.x** | **✅** (P3) | **本 spec 整合** |
| **Q17 (V0.2 新)** | **privacy 分级 V0.x 只在 PrivacyFailure class + crisis_detector 3 级, 完整 enforcement (PrivacyGuard 装饰器 + service 校验) V1.x** | **✅** (P2) | **本 spec 整合** |

---

## 20. Roadmap (V0.x / V1.x / V2.x, V0.3 整合)

### 20.1 V0.x (Week 1-8, 已 done, **88%**)

| 状态 | 范围 |
|------|------|
| ✅ 100% | 心塑 主 app 22 module + counselor 5 Tab P0 + AI 语音训练 v0.1 + KB CMS v0.1 (16 endpoint, V0.3 修订) + AI 引擎 4 件套 + life_map (12+6 endpoint, V0.3 修订 VS-life-merge 治本) |
| ⚠️ 50% | 商业化 (server 雏形, V0.3 修订 5 档+none) / 安全合规 (consent + crisis_detector 基础, V0.3 修订 6 角色) / 游戏化 (inner_world 基础) |
| ❌ 0% | 商业化完整 / 多租户 / RAG 真联调 (基础已就绪) / 隐私分级 enforcement (Q17 P2) / 5 类训练 V1.x / 游戏化 4 增强 / B 端 / Phase 9 调优 |

### 20.2 V1.x (Week 9-12, pending, **估 12%**)

| 状态 | 范围 |
|------|------|
| ⏳ Week 9 | Phase 6 RAG 真联调 (Qdrant + OpenAI 兼容 embedding, JD ECS 部署, VS-3 已治本基础) |
| ⏳ Week 9-10 | Phase 8 商业化完整 (billing + 微信/支付宝, VS-5, 大炮先申请支付入口) |
| ⏳ Week 10-11 | Phase 9 调优 + 生产化 (等保备案 + OTel) |
| ⏳ Week 11-12 | 隐私分级 enforcement (VS-4) + 7.2/7.3 schema + cleanup |
| 📊 总估 | 12% (Phase 5/6/7/8 剩余 + Phase 9) |

### 20.3 V2.x (post MVP+, **远期**)

- B 端服务体系 (机构/高校/协会)
- 多租户管理后台
- AI 教练角色 (虚拟督导)
- 5 类循证训练全部接入 (倾听共情/提问/语音微/全流程/个案概念化/备考)
- 游戏化 4 增强 (通关树/徽章墙/错题闯关/晋级赛)
- 全平台 native (iOS/Android/Web/小程序)

---

## 21. Changelog (v0.1 → v0.2 → v0.3)

| 版本 | 日期 | 变更 |
|------|------|------|
| **v0.1** | 2026-10-08 | 初稿, 24 章覆盖 AI 语音训练系统, 1926 行, 文档 `specs/ai-voice-training-v0.1.md` |
| **v0.2** | 2026-10-13 | 整合 v0.1 + 新 spec (大炮 13:25 贴的 v0 文档), 反映 7.10 + P0-1..P0-6 实际 push 状态, 7 拍板 (Q11/Q12 + 5 V0.2 新增), 文档 `specs/ai-voice-training-v0.2.md`. **V0.3 已 superseded V0.2** |
| **v0.3** | 2026-10-15 | 整合 v0.1 + v0.2 + 8 处 spec-vs-代码修订 + 2 对重复章节合并 (24 → 22 章), 文档 `specs/ai-voice-training-v0.3.md` |
| **v0.3.1** | 2026-10-15 | 整合产品设计文档 v1.0 (心塑 App · 咨询师学习者模式, 53KB 14 章) → 新建独立 spec **`docs/specs/counselor-mode-v1.0.md`** (24KB, 10 章), 覆盖长程个案 4-12 次 (§4.3) + 多流派督导 4 流派 (§4.6) + 7 维度 28 子指标 (§5.1) + 双 Agent 对话体系 (§5.2) + 4 块新 entity (§6 long_term_case/supervision/ability/quota) + 商业化 5 档 29/69/198 元配额 (§7) + V1.x 12 周排期 (§8) + 2 待写 ADR (0004/0005). **V0.3 spec 维持「心塑 App 整体 + V0.x 训练」基线, 本 spec 增量, 0 破坏性改动**. |

**v0.3 主要变更 vs v0.2** (8 处 spec-vs-代码修订 + 2 对重复章节合并):

1. **§3 心理地图架构**: P0-6 = 12+6 endpoint 全接 (VS-life-merge V2026-10-14 已治本, V0.2 spec 写 "1 endpoint done" 是 V2 严重误报)
2. **§6 KB CMS**: 11 → **16 endpoint** (V0.2 spec 漏数 5: KB CRUD 细分 + versions + 5 workflow + schedule × 2)
3. **§10 商业化** (合并原 §10+§15, 章节合并): 4 档 → **5 档+none** (漏写 'lifetime' 档, V0.5 拍板补)
4. **§11 安全合规** (合并原 §11+§17, 章节合并): 4 role → **6 角色 (3 admin + 3 业务, 无 guest)** (adminRole 跟 currentRole 拆分, V0.5 拍板)
5. **§12 技术选型**: server LLM 拆 **2 套独立架构** (LlmModule 链路 1 + AgentLlmModule 链路 2, V0.2 spec 简化 "主+fallback" 错)
6. **§12 技术选型**: LLM **LangChain stub 状态 → 装真包治本** (VS-3a V2026-10-14, 链路 1 4 OpenAI 兼容 provider 已 work)
7. **§13 数据模型**: WorkflowEvent **userId/timestamp** (V0.2 spec §15 写 actorId/createdAt outdated, 跟其他 entity 风格统一)
8. **§14 鉴权**: JWT **15min access + 7d refresh** (V0.2 spec §14 写 7d+30d outdated, V0.5 拍板短 access 大厂 practice)
9. **§14 6 角色**: 6 角色 3 admin + 3 业务, 无 guest (V0.2 spec §14 写 4 role outdated, V0.5 拍板拆分 adminRole 跟 currentRole)
10. **§10 §11 章节合并**: 原 V0.2 §10/§15 商业化 2 章重复 → 合并 1 章; 原 V0.2 §11/§17 安全合规 2 章重复 → 合并 1 章 (大厂 KISS, 24 → 22 章)

---

## 22. 文档索引 (本仓库)

| 路径 | 内容 | 用途 |
|------|------|------|
| `docs/specs/ai-voice-training-v0.1.md` | v0.1 spec 全文 (1926 行, 24 章) | v0.1 原始 spec 参考 (历史) |
| `docs/specs/ai-voice-training-v0.2.md` | v0.2 spec (24 章, 整合 + 拍板) | **V0.3 已 superseded, 保留作历史 reference** |
| **`docs/specs/ai-voice-training-v0.3.md`** | **v0.3 spec (本文件, 22 章, 整合 + 8 处修订 + 2 对重复合并)** | **当前主 spec, 路线图** |
| **`docs/specs/counselor-mode-v1.0.md`** | **counselor-mode v1.0 spec (24KB, 10 章, 2026-10-15)** | **心塑 App · 咨询师学习者模式 独立 dev spec, V0.3 spec 增量 (长程个案 + 多流派督导 + 7 维度子指标 + 商业化配额 + V1.x 12 周排期), V0.3 不破坏** |
| `docs/progress/v0.1-progress-snapshot-2026-10-13.md` | 4 batch 扫描快照 (V0.1 spec V0.x 状态) | 快速 resume (状态) |
| `docs/progress/v3-deep-scan-2026-10-14.md` | 4 subagent 深度扫描 (297 file, 5 需修异常 + 24 MINOR) | V3 实际状态 (含 VS-life-merge 治本) |
| `docs/progress/v3.1-vs3a-3e-progress-2026-10-15.md` | VS-3a/b/c/d/e 治本 (5/5 全完) + husky A 选 | V3.1 实际状态 |

---

**END OF SPEC V0.3**
