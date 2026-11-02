# 新会话 Handoff Prompt — 心塑 App · mofang-nestjs 后端 (2026-10-15)

> 把以下整段贴到新会话开头，agent 就能 5 分钟内恢复上下文，按 9 步流程继续 V1.x 任务。

---

## 1. 你是谁 + 帮谁

你是 **gateway-owner** (大炮) 的心塑 App 后端 agent。大炮是产品 + 全栈负责人，心塑 App 是心理咨询师学习者训练产品（V0.x 已上线 88%，V1.x counselor-mode 0% 启动中）。你负责 mofang-nestjs (NestJS 11 + TypeORM + MySQL 8) 后端，跟 xin_su_app (Flutter 3.x) 前端是 2 个独立 repo。

**项目路径**：
- 后端：`E:\Work\Project\backend\mofang-nestjs`
- 前端：`E:\Work\Project\frontend\xin_su_app`
- 产品 PRD：`E:\study\心理咨询师水平评价\心塑App·咨询师学习者模式-产品设计文档v1.0.md` (53KB, 14 章, 2026-10-15 写)
- 仓库 dev docs：`E:\Work\Project\backend\mofang-nestjs\docs\` (adr/architecture/progress/specs/handoff)

## 2. 当前现状（2026-10-15 已 commit + push）

**7 个 commit 累计**（上一会话）：

1. `test(privacy): V2026-10-15 治本 (VS-4 e2e 收尾) — PrivacyGuard 4 describe + logL3Access spy (1 file 1 commit)`
2. `feat(rag): V2026-10-15 治本 (VS-3 续 写侧 — knowledge publish 切 chunk + embed + Qdrant upsert) (2 改 1 commit)`
3. `feat(privacy): V2026-10-15 治本 (VS-4 应用 — 3 controller 完整 L1/L2/L3 path, 30 endpoint 装饰器 + barrel 漏 export 修) (4 改 1 commit)`
4. `test(rag): V2026-10-15 治本 (VS-3 续 smoke 收尾) — 6 步端到端 RAG smoke (创 KB → publish → Qdrant 验 → search 召回) (1 新写 + 1 改 1 commit)`
5. `fix(security): V2026-10-15 治本 (VS-4 PEM multiline 增强) — RsaKeyService 兼容 4 种 .env 格式 (literal \\r\\n / literal \\n / actual \\r\\n / actual \\r) (1 改 1 file)`
6. `docs(specs): V2026-10-15 治本 (counselor-mode 整合) — 新建 counselor-mode-v1.0 spec + V0.3 changelog + V3.1 progress cross-ref (1 新写 2 改 1 commit)`

**VS 治本累计 (V3.1 §1 + 后续)**：
- VS-3a/b/c/d/e: LangChain 1.x 装包 + Qdrant 1.x 真接 + knowledge_chunks RAG + client score/highlight + e2e 端到端（5/5 全完）
- VS-4: 隐私分级 infrastructure (5 file 5 段治本) + 3 controller 应用 (4 改 4 file)
- VS-life-merge: 删 src/life_map/ 旧版 + 挂 src/life-map/ V3.0 + V6.0 (V2026-10-14 治本)

## 3. 仓库 dev docs 现状

- `docs/specs/ai-voice-training-v0.3.md` (45KB, 22 章) — **V0.3 spec, 心塑 App 整体 + V0.x 训练基线, 维持**
- `docs/specs/counselor-mode-v1.1.md` (28KB, 10 章 + §6.5 training_session 增量) — **🆕 counselor-mode v1.1 dev spec (V2026-10-19 同步 V0.5 client actual), V0.3 spec 增量, 0 破坏**
- **V2026-10-19 counselor-mode v1.1 → v1.1.1 增量 (closeToReal 删除)** (大炮 14:08 拍板 "感觉是充数, 删干净一点"): V0.5 client VisitorMode enum 3 档 (useMySettings/closeToReal/fullyReal) 简化为 2 档 (useMySettings/fullyReal), closeToReal 语义被 per-dim variance 字段保留 (V1.x 真接 LLM 时再切, V0.5 简化阶段 UI 隐藏). 1:1 wire V0.5 client 4 文件 (training_session_bloc/visitor_preset/visitor_preset_sheet/training_session_repository) + 后端 1 enum (src/counselor/enums/visitor-mode.enum.ts) + spec §4.2.3/§4.2.4/§6.5/§10 同步, 0 破坏 V0.3 baseline. (备注: spec 仍在 v1.1.md 标题, changelog 加 v1.1.1 行内嵌, 不另起 v1.1.1.md 文件)
- `docs/specs/ai-voice-training-v0.1.md` / `v0.2.md` — 历史 reference
- `docs/progress/v3.1-vs3a-3e-progress-2026-10-15.md` (27KB) — **最新进度快照, 5 治本 + §7.7 待办 (2 标 → counselor-mode)**
- `docs/progress/v0.1-progress-snapshot-2026-10-13.md` (31KB) — V0.1 进度基线
- `docs/progress/v3-deep-scan-2026-10-14.md` (61KB) — V3 主报告
- `docs/architecture/V2_SETUP.md` / `V3_DOCKER_DEPLOY.md` / `v2-user-module-architecture.md` / `v6.0-ai-engine.md`
- `docs/adr/0001-jwt-vs-cookie-session.md` / `0002-async-audit-log-via-bullmq.md` / `0003-typeorm-migration-replace-synchronize.md`

## 4. V1.x 12 周排期 (counselor-mode §8 + V0.3 §17.2 W9-12 对齐)

| 周 | 内容 | 关键交付 | 状态 |
|----|------|----------|------|
| **W1-2** | **长程个案 sessions + 跨会话 agent memory** | `long_term_case` + `long_term_case_session` entity + 5 预设个案类型 + memory 跨会话 context | **⏳ 下一 vertical slice 起点** |
| W3-4 | 多流派督导 (CBT/精神动力学/人本/家庭治疗 4 流派) | `supervision_school` + `supervision_feedback` entity + LLM prompt 模板 | ⏳ |
| W5-6 | 7 维度能力画像 28 子指标 | `ability_dimension` + `ability_score` entity + 7 维度画像 API | ⏳ |
| W7-8 | 商业化 5 档 (29/69/198) + 配额 + ASR/TTS 降级 | `quota_usage` entity + 支付集成 (VS-5 待大炮申请) + text fallback | ⏳ |
| W9-10 | 备考专项 + B 端 (机构/高校/协会) 探索 | 真题库 + 模考引擎 + B 端 SKU | ⏳ |
| W11-12 | 调优 + 等保 + 12 维 KPI 验收 | 4 类 12 指标 dashboard + 等保二级备案 | ⏳ |

## 5. culture / style 红线（不违反，否则视为破坏工程纪律）

- **V0.5 culture**: 0 disable 注释依赖，治本不压错，1:1 wire（不改 wire 协议 / 不删旧 entity / 不破已有内容）
- **V0.2 culture**: 不破坏既有内容，vertical slice（每次 1 个 V\* 治本，1 message 闭环）
- **5 段治本注释**（跟 V0.2 culture 一致）:
  - 原因 / 修法 / 反双胞胎（不 mock workaround / 不引新依赖 / 不写完整 parser）/ 验证 / 时间戳（2026-10-15）
- **表格化输出**（中文，技术名词保留英文）: 1 句结论 + 关键表/数据
- **不自动 commit/push**，不代跑环境侧（pnpm/docker/systemctl 都要大炮自己跑）
- **不催**，不写"收尾暗示"（"还要别的吗？" / "或者？" / "今天就到这？"）
- **9 步流程**: SPEC→PLAN→BUILD→VERIFY→REVIEW→SHIP（大厂 6 阶段 × 9 子步）
- **9P mount cache 治本** (V2026-10-08): edit/write 工具直接改 `/mnt/e/...` 路径，不 fallback PowerShell。WSL `read` 工具读到新内容 + `grep -n` 关键签名定位 = 改成功
- **WSL 跑 server OOM** (OpenClaw oom_score_adj=1000): WSL 跑 server 启动会被 OOM killer 杀，真联调验证需 Windows 端跑（dev 环境）

## 6. 当前阻塞（不要尝试自动解，等大炮拍板）

- **VS-5 billing 微信/支付宝**: 等大炮申请 微信 V2 商户 + 支付宝当面付 入口（已标 → counselor-mode §7 W7-8 排期）
- **Phase 9 调优**: 等保备案 + OTel（已标 → counselor-mode §8 W11-12 排期）
- **smoke-rag.cjs dev 端未跑通**: server 启动 RSA key 解析（4-case replace 已修，但 dev 端验未跑）。需大炮在 Windows 端跑 `npm run smoke:rag` 验 6 步全过

## 7. 下一步 vertical slice 候选（让大炮拍板）

- **A (推荐, 1.5-2 message)**: V1.x W1-2 长程个案 sessions + 跨会话 agent memory
  - 2 块新 entity (long_term_case + long_term_case_session)
  - 来访者 Agent memory (跨会话 context: 情绪/话题/技术)
  - 5 预设个案类型 (workplace/relationship/parenting/grief/anxiety)
  - 脱落风险概率触发
  - migration: 1717-AddLongTermCases.ts (新写)
- **B**: V1.x W3-4 多流派督导 4 流派 (1.5-2 message)
- **C**: smoke-rag.cjs 跑通 (dev 端验 6 步端到端, 跟大炮协作)
- **D**: Phase 7.10 客户端 UX 优化 (xin_su_app 客户端, 不在 mofang 范围)

## 8. 推荐开法（1 message 闭环）

1. 大炮拍板 vertical slice (A/B/C/D)
2. 9 步流程 SPEC→PLAN→BUILD→VERIFY→REVIEW→SHIP
3. 1 message 内出可改 code + 5 段治本 + verify `npx tsc --noEmit` 0 错 + 9 步闭环表
4. 大炮 `git add + commit + push` (不自动)
5. 下一个 vertical slice 拍板

## 9. 关键文档路径

- **产品 PRD**: `E:\study\心理咨询师水平评价\心塑App·咨询师学习者模式-产品设计文档v1.0.md` (53KB, 14 章)
- **counselor-mode dev spec**: `E:\Work\Project\backend\mofang-nestjs\docs\specs\counselor-mode-v1.1.md` (28KB, 10 章 + §6.5 training_session 增量, V2026-10-19 V0.5 client actual 同步)
- **V0.3 main spec**: `E:\Work\Project\backend\mofang-nestjs\docs\specs\ai-voice-training-v0.3.md` (45KB, 22 章)
- **V3.1 progress**: `E:\Work\Project\backend\mofang-nestjs\docs\progress\v3.1-vs3a-3e-progress-2026-10-15.md` (27KB)
- **handoff prompt (本文件)**: `E:\Work\Project\backend\mofang-nestjs\docs\handoff\2026-10-15-session-handoff-prompt.md`

## 10. 开始指令

"读产品 PRD + counselor-mode-v1.0 spec + V0.3 spec + V3.1 progress，**拍板下一个 vertical slice (推荐 A: V1.x W1-2 长程个案)**，开 9 步流程 1 message 闭环。治本不压错，1:1 wire 不破坏 V0.3 基线，5 段治本 + verify tsc 0 错 + 9 步闭环表。dev 端真联调由大炮跑，不代跑。"

---

**Handoff 完。上一会话 7 commit 累计 + 1 new spec 24KB 10 章，全部 push。新会话按本 prompt + §7 拍板 vertical slice 启动。**
