// V2026-10-13 治本 (Phase 7.10 P0-2 — counselor.module.ts):
//   心理咨询师学员端 server module. 7.10 P0-2 加 training controller (thin delegate).
//
//   跟 home/ 模块风格一致:
//     - 1 module 容纳 counselor 端 5 Tab 所有 endpoint (V1.x 加 exam/growth/profile)
//     - V0.5 简化: 仅 home + training controller (P0-1 + P0-2 范围), V0.x 阶段不接数据库
//     - V1.x 改造: 接 training-sessions + ai-profile + voice-sessions 表
//
//   反双胞胎:
//     - 不复用 home/ 模块 (业务正交, counselor 端独立)
//     - 不在本模块引 emotion/ai-engine/gamification 跨模块 (V0.5 内聚, V1.x 拆)
//
// V2026-10-15 治本 (V1.x counselor-mode W1-2 — long-term-case 接入 + TypeOrmModule.forFeature):
//   原因: counselor-mode-v1.0 §6.1 拍板 long_term_cases + long_term_case_sessions 2 张表, V0.5
//     counselor module 5 controller 内存 mock, V1.x 接入 long-term-case controller 走真库
//     (V0.5 culture "V1.x 改造" 注释已留口子: "V1.x: TypeOrmModule.forFeature([TrainingSessionEntity, ...])").
//   修法:
//     - 引入 @nestjs/typeorm + LongTermCase / LongTermCaseSession entity
//     - imports 加 TypeOrmModule.forFeature([LongTermCase, LongTermCaseSession])
//     - controllers +1 (CounselorLongTermCaseController)
//     - providers +1 (LongTermCaseService)
//     - exports +1 (LongTermCaseService, 供后续 supervision W3-4 / ability W5-6 复用)
//   反双胞胎:
//     - 不复用 V0.5 5 service (业务正交, 跟 V0.5 culture "1 module 5 service 独立" 一致)
//     - 不引 AnalyticsModule / LlmModule (V1.x 阶段 long-term case 暂不接跨模块依赖,
//       V3.x W3-4 多流派督导接 LLM 时再 import, 防循环 + KISS)
//     - 不改 V0.5 已有 controller / service (1:1 wire 0 破坏 V0.x baseline)
//   验证:
//     1. tsc 0 错 (新加 entity 走 @nestjs/typeorm 注册, 跟 knowledge-base.module 同 pattern)
//     2. pnpm migration:run + curl 验 3 endpoint 端到端
//   时间戳: 2026-10-15
//
// V2026-10-15 治本 (V1.x counselor-mode W3-4 — supervision 接入 + 4 流派 + polymorphic feedback):
//   原因: counselor-mode-v1.0 §6.2 拍板 supervision_schools (4 流派配置) +
//     supervision_feedback (polymorphic 反馈记录) 2 张表, V0.3 §13 baseline 0 督导
//     持久化, 1:1 wire 0 破坏. W1-2 LongTermCaseSession.supervisionFeedback json 字段
//     已留 nullable, W3-4 4 流派叠加走独立表, 不污染 W1-2.
//   修法:
//     - imports 加 SupervisionSchool / SupervisionFeedback entity
//     - TypeOrmModule.forFeature 累计 [LongTermCase, LongTermCaseSession, SupervisionSchool, SupervisionFeedback]
//     - controllers +1 (CounselorSupervisionController, 4 endpoint)
//     - providers +1 (SupervisionService, 5 method)
//     - exports +1 (SupervisionService)
//   反双胞胎:
//     - 不在 V0.x supervisionReport json 字段加流派维度: 破坏 1:1 wire
//     - 不在 W1-2 LongTermCaseSession.supervisionFeedback json 字段塞 4 流派: 走独立表
//     - 不接 LLM provider: V0.5 mock 阶段用静态 prompt 模板 + 简单规则, V1.x 真接 LLM 时改
//       provider 注入 (跟 W1-2 long-term-case-presets 静态 config 风格一致)
//     - 不引 vector store: V0.x 阶段不接 RAG, V2.x 升级再切
//   验证:
//     1. tsc 0 错 (4 entity + 7 controller + 6 service 累计, 跟 knowledge-base.module 同 pattern)
//     2. pnpm migration:run + curl 验 4 endpoint 端到端
//   时间戳: 2026-10-15
//
// V2026-10-15 治本 (V1.x counselor-mode W5-6 — ability 接入 + 7 维度 28 子指标):
//   原因: counselor-mode-v1.0 §6.3 拍板 ability_dimensions (28 子指标配置) +
//     ability_scores (user × dimension 聚合) 2 张表, V0.3 §13 baseline 0 子指标表
//     (V0.x AIProfileSnapshot 7 维度是 json 字段), 1:1 wire 0 破坏. W3-4 supervision_feedback
//     不动, V0.5 阶段 ability_score 走手动 upsert, V1.x 续做时 W3-4 generateFeedback
//     完成后回调 ability.service.upsertScore (V0.5 不蔓延 scope).
//   修法:
//     - imports 加 AbilityDimension / AbilityScore entity
//     - TypeOrmModule.forFeature 累计 6 entity: LongTermCase + LongTermCaseSession +
//       SupervisionSchool + SupervisionFeedback + AbilityDimension + AbilityScore
//     - controllers +1 (CounselorAbilityController, 3 endpoint)
//     - providers +1 (AbilityService, 4 method)
//     - exports +1 (AbilityService)
//   反双胞胎:
//     - 不复用 V0.x AIProfileSnapshot 7 维度 json 字段: 28 子指标粒度更细, 1:1 wire 增量
//     - V0.5 阶段不接 W3-4 supervision.service 自动累加: 避免 V0.5 scope 蔓延,
//       V1.x 续做时 W3-4 service.generateFeedback 完成后回调 ability.service.upsertScore
//     - 不引 vector store: V0.x 阶段不接 RAG, V2.x 升级再切
//   验证:
//     1. tsc 0 错 (6 entity + 8 controller + 7 service 累计, 跟 knowledge-base.module 同 pattern)
//     2. pnpm migration:run + curl 验 3 endpoint 端到端
//   时间戳: 2026-10-15
//
// V2026-10-15 治本 (V1.x counselor-mode W7-8 — billing 接入 + 5 档会员 + 配额 + 降级):
//   原因: counselor-mode-v1.0 §6.4 + §7.1 + §7.3 拍板 quota_usage 表 + 5 档会员 + 配额, V0.3
//     §13 baseline 0 quota_usage 表 (V0.x user_memberships 3 档 free/plus/pro 保留),
//     1:1 wire 0 破坏. V1.x W7-8 走 user_memberships 加 3 列 (tier_v2 / quota_period /
//     quota_text_fallback) + 新表 quota_usage 双轨. V0.5 阶段 mock 支付 inline (V1.x
//     续做抽 PaymentChannelService interface 接 WechatPay + Alipay).
//   修法:
//     - imports 加 QuotaUsage entity
//     - TypeOrmModule.forFeature 累计 7 entity: +QuotaUsage
//     - controllers +1 (CounselorBillingController, 4 endpoint)
//     - providers +1 (BillingService, 5 method + 配额扣减 + mock 支付 + text fallback inline)
//     - exports +1 (BillingService)
//   反双胞胎:
//     - 不复用 V0.x user_memberships.tier (3 档 free/plus/pro) 字段改写: 1:1 wire 0 破坏,
//       V0.x 客户端继续读 tier 字段, V1.x 客户端读 tier_v2 字段
//     - V0.5 阶段 payment channel mock 走 inline: 避免 V0.5 scope 蔓延, V1.x 续做抽
//       PaymentChannelService interface (wechat + alipay 真接)
//     - 不在 quota_usage 表存 polymorphic 配额源: V0.x 风格 enum 强类型, 防 drift
//     - 不引 vector store: V0.x 阶段不接 RAG, V2.x 升级再切
//   验证:
//     1. tsc 0 错 (7 entity + 9 controller + 8 service 累计, 跟 knowledge-base.module 同 pattern)
//     2. pnpm migration:run + curl 验 4 endpoint 端到端
//   时间戳: 2026-10-15

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// V2026-10-21 治本 (V1.2 VS-A — 引入 AgentModule 拿 LlmService):
//   原因: 本轮要把 counselor 的督导反馈从 mock 切真接 LLM. 项目里有**两个类名都叫 LlmModule**
//     的模块 —— src/agent/llm/llm.module.ts (MiniMax 流式, LlmService) 与
//     src/llm/llm.module.ts (多厂商路由, LlmRouterService). 本轮选前者:
//       - .env 已有 MINIMAX_API_KEY / MINIMAX_BASE_URL / MINIMAX_LLM_MODEL, 开箱可用
//       - src/agent/supervisor/supervisor.service.ts 已用它端到端跑通 "收流 → JSON.parse → 校验"
//       - 栈 B 需要 LLM_<PROVIDER>_API_KEY, .env 里一个都没有, 启动就是 (none)
//     AgentModule re-export 了 LlmModule (src/agent/agent.module.ts:23), 直接 import AgentModule
//     即可拿到 LlmService, 且不与 src/agent/ 产生循环依赖 (agent 侧 0 处 import counselor).
//   反双胞胎: 不直接 import '../agent/llm/llm.module' —— 跟 knowledge-base.module.ts:21 的先例一致,
//     统一用 AgentModule 这个公共出口, 换 LLM 实现时只改 1 处.
//   时间戳: 2026-10-21
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth';
import { UserModule } from '../user';

// V2026-10-15 治本 (V1.x W5-6 — ability controller):
//   counselor 端第 8 个 controller (7 维度 28 子指标 + user 聚合, 跟 W1-2 + W3-4 数据正交,
//   单独 service + 真接 TypeOrm 库).
import { CounselorAbilityController } from './controllers/ability.controller';
// V2026-10-15 治本 (V1.x W7-8 — billing controller):
//   counselor 端第 9 个 controller (5 档会员 + 配额 + 降级, 跟 A + B + C 数据正交, 单独 service).
import { CounselorBillingController } from './controllers/billing.controller';
// V2026-10-13 治本 (Phase 7.10 P0-2 — 加 training controller):
//   counselor 端 5 Tab 第 2 个 endpoint (跟 home 共用 CounselorHomeService 数据).
// V2026-10-13 治本 (Phase 7.10 P0-3 — 加 exam controller):
//   counselor 端 5 Tab 第 3 个 endpoint (题库, 跟 home/training 数据正交, 单独 service).
import { CounselorCaseProfileEntryController } from './controllers/case-profile-entry.controller';
import { CounselorExamController } from './controllers/counselor-exam.controller';
// V2026-10-13 治本 (Phase 7.10 P0-4 — 加 growth controller):
//   counselor 端 5 Tab 第 4 个 endpoint (成长, 4 区块, 复用 home ability + weeklyProgress).
import { CounselorGrowthController } from './controllers/counselor-growth.controller';
import { CounselorHomeController } from './controllers/counselor-home.controller';
// V2026-10-15 治本 (V1.x W1-2 — long-term-case controller):
//   counselor 端第 6 个 controller (长程个案, 跟 home/training/exam/growth/profile 数据正交,
//   单独 service + 真接 TypeOrm 库).
// V2026-10-22 治本 (首页金句 · 每日一句 — controller):
//   5 端点: 今日金句 / 金句流 (游标分页) / 我的收藏 / 收藏 / 取消收藏.
//   跟 practice controller 语义正交 (零压情绪陪伴位 vs 技能训练).
import { CounselorProfileController } from './controllers/counselor-profile.controller';
import { CounselorTrainingController } from './controllers/counselor-training.controller';
import { CounselorUiPreferenceController } from './controllers/counselor-ui-preference.controller';
import { CounselorInformedConsentController } from './controllers/informed-consent.controller';
import { CounselorLiveHintController } from './controllers/live-hint.controller';
import { CounselorLongTermCaseController } from './controllers/long-term-case.controller';
// V2026-10-22 治本 (V1.3 §3 — 微技能自由练习 controller):
//   counselor 端第 19 个 controller (5 端点: 进度聚合 / 取场景 / 提交评判 /
//   随机抽练 / 真实场景生成), 跟 MCQ 训练题 controller 语义正交 (零压无分).
import { CounselorPracticeController } from './controllers/practice.controller';
import { CounselorQuoteController } from './controllers/quote.controller';
// V2026-10-13 治本 (Phase 7.10 P0-5 — 加 profile controller):
//   counselor 端 5 Tab 第 5 个 endpoint (我的, 训练偏好 + 会员状态).
// V2026-10-15 治本 (V1.x W3-4 — supervision controller):
//   counselor 端第 7 个 controller (4 流派督导, 跟 long-term-case 同 sessionId polymorphic 复用).
import { CounselorSupervisionController } from './controllers/supervision.controller';
import { CounselorTrainingExerciseController } from './controllers/training-exercise.controller';
// V2026-10-21 治本 (V1.2 VS-A — training session controller):
//   training_sessions 表 (V1.1 §6.5) 落地后一直 0 controller, v1.2 的 M2 知情同意 /
//   M3 轻提示 / M4 24h 间隔 / §10.1 初访分流 全挂在它身上. 本 controller 定死 6 个 endpoint 契约.
import { CounselorTrainingSessionController } from './controllers/training-session.controller';
// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 controller):
//   visitor-persona: 视图 A 表层配置 + 上帝视角全量 + 绑定长程
//   case-profile-entry: 视图 B 动态解锁档案
import { CounselorTranscriptBookmarkController } from './controllers/transcript-bookmark.controller';
import { CounselorTransferenceMarkController } from './controllers/transference-mark.controller';
import { CounselorVisitorPersonaController } from './controllers/visitor-persona.controller';
// V2026-10-23 治本 (AI 模拟来访池 — 2 controller):
//   visitor-pool: 公共人物图鉴 + 克隆实例化 + 收藏 (普通练习用户可用)
//   visitor-pool-admin: 公共模板库治理 (AI 生成 / 增删改 / 上下架 / 软删恢复), 内部角色专用
import { CounselorVisitorPoolAdminController } from './controllers/visitor-pool-admin.controller';
import { CounselorVisitorPoolController } from './controllers/visitor-pool.controller';
// V2026-10-26 治本 (官方音色目录 — 只读代理端点, spec §任务 2):
//   GET /counselor/voices?type=system — 音色选择器唯一的取数入口 (前端不直连 MiniMax).
import { CounselorVoicesController } from './controllers/voices.controller';
// V2026-10-21 治本 (V1.2 VS-C — M2/M3 会谈核心 4 controller):
//   informed-consent (4 要素判定 + 进度) / live-hint (轻提示 + SSE 流)
//   transcript-bookmark (逐字稿打点) / transference-mark (双向移情阻抗标记)
// V2026-10-15 治本 (V1.x W5-6 — ability entity 注册, 走 TypeOrmModule.forFeature):
//   7 维度 28 子指标 + user 聚合 2 entity, 跟 W1-2 long-term-case + W3-4 supervision 同段.
import { AbilityDimension } from './entities/ability-dimension.entity';
import { AbilityScore } from './entities/ability-score.entity';
// V2026-10-15 治本 (V1.x W1-2 — long-term-case entity 注册, 走 TypeOrmModule.forFeature):
//   跟 knowledge-base/knowledge-chunk.entity.ts V0.x 风格一致, 1:1 wire.
import { CaseProfileEntry } from './entities/case-profile-entry.entity';
import { CounselorUiPreference } from './entities/counselor-ui-preference.entity';
import { LiveSupervisionHint } from './entities/live-supervision-hint.entity';
import { LongTermCaseSession } from './entities/long-term-case-session.entity';
import { LongTermCase } from './entities/long-term-case.entity';
// V2026-10-22 治本 (V1.3 §2 — 微技能自由练习引擎 2 entity 注册, 走 TypeOrmModule.forFeature):
//   +PracticeScenario (场景变体库, 20 列 + 4 索引) +PracticeAttempt (自由作答记录,
//   12 列 + 3 索引), 跟 §2.1 / §2.2 拍板严格 1:1; 跟 V1.1 §5.2 MCQ 两表完全正交
//   (0 改动 training_exercises / training_exercise_attempts).
// V2026-10-22 治本 (V1.3 §7.5 — 用户私有场景表注册, 跟前序 practice_scenarios 同段):
//   +PracticeCustomScenario (私有场景 14 列 + 3 索引) —— 跟共享内容库物理隔离,
//   保证「公共题库里每一条都过审」这条不变式 (§7.3.1 脱敏 + §7.5 数据落点).
import { PracticeAttempt } from './entities/practice-attempt.entity';
import { PracticeCustomScenario } from './entities/practice-custom-scenario.entity';
import { PracticeScenario } from './entities/practice-scenario.entity';
// V2026-10-22 治本 (首页金句 · 每日一句 — 2 entity 注册, 跟前序 practice_custom_scenarios 同段):
//   +Quote (金句内容库 11 列 + 2 索引) +UserQuoteFavorite (收藏关系 5 列 + 3 索引).
//   零压红线: 两表都**没有**任何计数字段 (like_count / favorite_count / view_count).
// V2026-10-15 治本 (V1.x W7-8 — quota_usage entity 注册):
//   3 类配额月度聚合 1 entity, 跟 W1-2 + W3-4 + W5-6 同段.
import { QuotaUsage } from './entities/quota-usage.entity';
import { Quote } from './entities/quote.entity';
// V2026-10-15 治本 (V1.x W3-4 — supervision-schools + supervision-feedback entity 注册):
//   4 流派配置 + polymorphic 反馈记录 2 entity, 跟 W1-2 long-term-case 同 TypeOrmModule.forFeature 段.
import { SupervisionFeedback } from './entities/supervision-feedback.entity';
import { SupervisionSchool } from './entities/supervision-school.entity';
// V2026-10-15 治本 (V1.x W5-6 — ability service):
//   4 method 业务逻辑 (listDimensions / findDimensionByCode / getUserProfile / upsertScore),
//   V0.5 阶段手动 upsert, V1.x 续做时 W3-4 service.generateFeedback 完成后回调本 service.
import { TrainingExerciseAttempt } from './entities/training-exercise-attempt.entity';
import { TrainingExercise } from './entities/training-exercise.entity';
import { TrainingSession } from './entities/training-session.entity';
// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 entity 注册, 走 TypeOrmModule.forFeature):
//   +VisitorFullPersona (AI 底层全量人设, 7 大块 json + trust_level)
//   +CaseProfileEntry (动态解锁档案, self_disclosed / therapist_note 两层)
//   跟 V1.1 §5.2 training_exercises 同段.
import { TranscriptBookmark } from './entities/transcript-bookmark.entity';
import { TransferenceResistanceMark } from './entities/transference-resistance-mark.entity';
import { UserQuoteFavorite } from './entities/user-quote-favorite.entity';
import { VisitorFullPersona } from './entities/visitor-full-persona.entity';
// V2026-10-23 治本 (AI 模拟来访池 — 2 entity 注册, 走 TypeOrmModule.forFeature):
//   +VisitorPoolTemplate (公共只读模板: 表层卡片 + 7 大块剧本快照)
//   +VisitorPoolFavorite (收藏关系, 唯一键 (user_id, template_id))
//   跟 V2026-10-21 的 visitor_full_personas 同段 (副本表复用, 只多 1 列 source_template_id).
import { VisitorPoolFavorite } from './entities/visitor-pool-favorite.entity';
import { VisitorPoolTemplate } from './entities/visitor-pool-template.entity';
// V2026-10-21 治本 (V1.2 VS-C — M2/M3 会谈核心 3 entity 注册, 走 TypeOrmModule.forFeature):
//   +LiveSupervisionHint (实时督导轻提示) +TranscriptBookmark (逐字稿打点)
//   +TransferenceResistanceMark (双向移情/阻抗标记)
//   跟 V1.2 VS-B1 的 2 entity 同段.
// V2026-10-19 治本 (V1.1 §5.2 — training_exercises + training_exercise_attempts 接入):
//   跟 V0.5 training_session §6.5 1:1 wire 拍板风格 (V2026-10-19 治本续 V8.3 落地):
//   +TrainingExercise (V1.1 §5.2 拍板 10 训练项, 跟 xin_su_app V0.5 client
//   TrainingExercise entity 1:1 wire) + TrainingExerciseAttempt (V1.1 §5.2 拍板
//   答题记录, 5 状态机 1:1 wire). 大炮 16:10 "A, 要企业级的方案, 不要凑活"
//   1:1 反馈, V0.5 stage 简化 0 占位, V1.x W9-10 续做前先落 entity 层.
import { AdminRoleGuard } from './guards/admin-role.guard';
import { AbilityService } from './providers/ability.service';
// V2026-10-15 治本 (V1.x W7-8 — billing service):
//   5 method 业务逻辑 (getMembershipStatus / listSkus / createOrder / consumeQuota /
//   isVoiceAllowed), V0.5 阶段 mock 支付 inline + 配额表真接, V1.x 续做抽 PaymentChannelService
//   interface 接 WechatPay + Alipay 真接.
import { BillingService } from './providers/billing.service';

// V2026-10-19 治本 (V1.1 §6.5 — training-session 接入 + 9 场景单次 session 持久化):
//   原因: counselor-mode-v1.1 §6.5 拍板 training_sessions 表 (跟 xin_su_app V0.5 client
//     TrainingSession entity 1:1 wire, 6 enum + 25 字段), V0.5 client 用
//     MockTrainingSessionRepository 内存 mock, V1.x server 端落库. 跟 V0.3 §13
//     baseline 0 破坏 (V0.3 TrainingSession 4 态保留), 跟 W1-2 long_term_case_session
//     1:1 wire (transcript shape 复用), 跟 V0.5 stage 简化清单 11 项中的 #2/#3/#4/#5/#11
//     解锁 server 端持久化基础.
//
//   修法:
//     - imports 加 TrainingSession entity (跟 W1-2 long-term-case-session V1.1 同 pattern)
//     - TypeOrmModule.forFeature 累计 8 entity (W1-2/W3-4/W5-6/W7-8 + V1.1 training_session)
//     - 0 controller / 0 service (V1.1 阶段仅落 entity + migration, V1.x W7-8 续做
//       TrainingSessionService + Controller 时再加, V0.5 client 仍走 mock pool,
//       防 V1.1 scope 蔓延, 跟 V0.5 culture "V0.x 阶段不接数据库" 注释一致)
//
//   反双胞胎:
//     - 不加 controller / service: V0.5 client 仍走 MockTrainingSessionRepository 内存池,
//       V1.x server 端 API (POST /training/sessions) 等 W7-8 续做时再加
//     - 不复用 V0.3 §13 TrainingSession entity: V0.3 4 态 baseline 保留, V1.1 新建
//       training_sessions 表 (V0.5 stage 5 状态机是新概念, 跟 V0.3 baseline 正交)
//     - 不引 AnalyticsModule / LlmModule: V0.5 stage 简化 (跟 W1-2 long-term-case 风格一致)
//
//   验证:
//     1. tsc 0 错 (新加 entity 走 @nestjs/typeorm 注册, 跟 knowledge-base.module 同 pattern)
//     2. pnpm migration:run + SHOW TABLES LIKE 'training_sessions'; 1 张表
//
//   时间戳: 2026-10-19
// V2026-10-13 治本 (Phase 7.10 P0-3 — exam service):
//   跟 home/training 数据正交, 单独 service (4 大分类 + 11 卡片 + 3 KPI).
import { CaseProfileEntryService } from './providers/case-profile-entry.service';
import { CounselorExamService } from './providers/counselor-exam.service';
// V2026-10-13 治本 (Phase 7.10 P0-4 — growth service):
//   复用 home service ability + weeklyProgress, 加 training records + wrong questions (V0.5 空数组).
import { CounselorGrowthService } from './providers/counselor-growth.service';
import { CounselorHomeService } from './providers/counselor-home.service';
// V2026-10-15 治本 (V1.x W1-2 — long-term-case service):
//   5 method 业务逻辑 (list / createFromPreset / findDetail / appendSession / listTemplates),
//   走真 TypeORM Repository, 跟 V0.5 5 service 内存 mock 区分.
// V2026-10-22 治本 (首页金句 · 每日一句 — service):
//   QuoteService: 今日金句轮换 + 金句流 keyset 游标分页 + 收藏开关 (零压, 无计数).
import { CounselorProfileService } from './providers/counselor-profile.service';
import { CounselorSupervisionProcessor } from './providers/counselor-supervision.processor';
import { CounselorUiPreferenceService } from './providers/counselor-ui-preference.service';
import { CounselorVisitorContextContributor } from './providers/counselor-visitor-context.contributor';
// V2026-10-23 治本 (v2.0 语音对语音 — 公共人物模板解析器):
//   实现 voice 侧的 VoiceTemplateResolver 插槽 (依赖倒置): WS 握手要校验
//   `templateId` 是否指向已上架公共人物, 但这张表属 counselor 业务域, 而网关在 voice
//   (agent) 侧 —— 直接 import 会形成 agent → business 反向依赖.
//   该解析器只对外暴露**表层摘要**, 7 大块剧本永不跨模块 (零压红线的结构性保证).
import { CounselorVisitorPoolTemplateResolver } from './providers/counselor-visitor-pool-template.resolver';
import { InformedConsentService } from './providers/informed-consent.service';
import { LiveSupervisionHintService } from './providers/live-hint.service';
import { CounselorLlmJsonClient } from './providers/llm-json.client';
import { LongTermCaseService } from './providers/long-term-case.service';
// V2026-10-22 治本 (V1.3 §3 — 微技能自由练习 3 service):
//   - PracticeScenarioService: 读侧 (进度聚合 / 取场景 / 随机抽练) + 唯一可见性谓词
//   - PracticeEvaluatorService: 评判引擎 (LLM 主路径 + 确定性关键词降级 + 零压红线守门)
//   - PracticeAttemptService: 写侧编排 (落库 / attemptOrdinal / 语速折算 / 私有场景生成)
// V2026-10-22 治本 (V1.3 §7.2 — 新增 3 service):
//   - PracticeCustomScenarioService: 用户私有场景的生成与列表 (§7.2 两个端点)
//   - PracticeQuotaService: 练习域日粒度配额 (复用 quota_usage 表, spec §7.4)
//   - PracticeAbilitySyncService: 练习信号回写五维画像 (spec §7.6 P3-c)
import { PracticeAbilitySyncService } from './providers/practice-ability-sync.service';
// V2026-10-23 治本 (语音微训练 STT 代理 — 4 provider 注册):
//   PracticeAsrService: 业务编排 (预检 + 错误归一 + 记账)
//   PracticeAsrClient:  MiniMax STT 上游协议层 (multipart 转发 / 超时 / 错误归一化)
//   PracticeAsrThrottlerGuard: userId 级限流 (排在 JwtAuthGuard 之后才能拿到 request.user)
//   PracticeAsrUploadFilter: 路由级异常 filter (413/400 → ASR 专用业务码)
import { PracticeAsrUploadFilter } from './providers/practice-asr-upload.filter';
import { PracticeAsrClient } from './providers/practice-asr.client';
import { PracticeAsrService } from './providers/practice-asr.service';
import { PracticeAsrThrottlerGuard } from './providers/practice-asr.throttler';
import { PracticeAttemptService } from './providers/practice-attempt.service';
import { PracticeCustomScenarioService } from './providers/practice-custom-scenario.service';
import { PracticeEvaluatorService } from './providers/practice-evaluator.service';
import { PracticeQuotaService } from './providers/practice-quota.service';
import { PracticeScenarioService } from './providers/practice-scenario.service';
// V2026-10-13 治本 (Phase 7.10 P0-5 — profile service):
//   训练偏好 (3 toggle + defaultDifficulty) + 会员状态 (V0.5 写死 none, V1.x 接 billing).
// V2026-10-15 治本 (V1.x W3-4 — supervision service):
//   5 method 业务逻辑 (listSchools / findSchoolByCode / generateFeedback / compareFeedback /
//   listFeedbackForSession), V0.5 mock 阶段用静态 prompt 模板, V1.x 真接 LLM 改 provider 注入.
import { ProfileExtractionService } from './providers/profile-extraction.service';
import { QuoteService } from './providers/quote.service';
import { SessionContextBuilder } from './providers/session-context.builder';
// V2026-10-21 治本 (V1.2 VS-A — VS-A 新增 4 个 provider):
//   - CounselorLlmJsonClient: counselor 端唯一的结构化输出出口 (收流 → 剥 think → JSON.parse → 校验)
//   - SessionContextBuilder: 会话上下文的唯一取数入口 (polymorphic, 统一 transcript 口径)
//   - CounselorSupervisionProcessor: 督导异步生成 worker (BullMQ, 真接 LLM 后不能同步阻塞 HTTP)
//   - TrainingSessionService: 会话生命周期 (建 / 查 / 状态机 / 逐字稿 / 结束)
// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 service):
//   VisitorPersonaService (视图 A + 上帝视角 + LLM 生成全量剧本) /
//   CaseProfileEntryService (视图 B 动态解锁档案, 两层分区)
// V2026-10-21 治本 (V1.2 VS-C — M2/M3 会谈核心 7 provider):
//   SessionCoreEventsService     SSE 事件总线 (counselor 端第一个实时通道)
//   LiveSupervisionHintService   轻提示 (5 分钟防抖 + SSE 推送)
//   InformedConsentService        知情同意 4 要素 LLM 判定
//   TranscriptBookmarkService     逐字稿打点
//   TransferenceMarkService      双向移情/阻抗标记
//   TurnAnalysisService          每轮分析器 (一次 LLM → 提示 + 标记)
//   TurnAnalysisProcessor        每轮分析 BullMQ worker
import { SessionCoreEventsService } from './providers/session-core-events.service';
import { SupervisionService } from './providers/supervision.service';
import { TrainingExerciseService } from './providers/training-exercise.service';
import { TrainingSessionService } from './providers/training-session.service';
import { TranscriptBookmarkService } from './providers/transcript-bookmark.service';
import { TransferenceMarkService } from './providers/transference-mark.service';
import { TurnAnalysisProcessor } from './providers/turn-analysis.processor';
import { TurnAnalysisService } from './providers/turn-analysis.service';
import { VisitorPersonaService } from './providers/visitor-persona.service';
// V2026-10-23 治本 (AI 模拟来访池 — 2 service + 1 guard):
//   VisitorPoolService: 公共图鉴读 + 克隆实例化 + 收藏
//   VisitorPoolAdminService: 内部 AI 生成 + 模板治理 (管理面与公共面分文件, 防权限外溢)
//   AdminRoleGuard: 读 users.admin_role 判定内部角色 (普通用户 → 403)
import { VisitorPoolAdminService } from './providers/visitor-pool-admin.service';
import { VisitorPoolService } from './providers/visitor-pool.service';
// V2026-10-26 治本 (官方音色目录代理 — 2 provider, spec §任务 2):
//   VoicesClient:  MiniMax `get_voice` 上游协议层 (路径 / 请求体 / 响应体 / 状态码)
//   VoicesService: 缓存 + 并发去重 + 错误归一 + DTO 整形, 并实现 voice 侧音色目录插槽
import { VoicesClient } from './providers/voices.client';
import { VoicesService } from './providers/voices.service';
// V2026-10-23 治本 (AI 模拟来访池 — 内部角色守卫):
//   直读 users.admin_role (3 档 editor/reviewer/admin), 不复用 common/guards/roles.guard.ts
//   (后者依赖 request.user.adminRole / user.roles, 而本仓当前注入 request.user 的
//    JwtAuthGuard 并不注入 adminRole, 且 users 表没有 roles 列 → 恒不放行).
// V2026-10-21 治本 (V1.2 VS-B2 — 人设接线 2 provider):
//   CounselorVisitorContextContributor 实现 agent 侧的上下文贡献者插槽 (依赖倒置);
//   ProfileExtractionService 负责披露落库 + 信任度推进.

/**
 * V2026-10-15 (V1.x counselor-mode W7-8 — CounselorModule):
 *   心理咨询师学员端 server module (跟 client counselor_* 5 Tab 1:1 对应).
 *
 *   跟 main_shell_page.dart V6.1 §2 counselorLearner 5 Tab (home/training/growth/exam/profile) 配套.
 *
 *   V0.5 P0-1: home overview 1 endpoint
 *   V0.5 P0-2: + training overview 1 endpoint (thin delegate)
 *   V0.5 P0-3/P0-4/P0-5: + exam / growth / profile 3 controller
 *   V1.x W1-2: + long-term-case controller (真接 TypeOrm, V0.5 5 controller 内存 mock 仍保留)
 *   V1.x W3-4: + supervision controller (4 流派 + polymorphic feedback)
 *   V1.x W5-6: + ability controller (7 维度 28 子指标 + user 聚合)
 *   V1.x W7-8: + billing controller (5 档会员 + 配额 + 降级 + mock 支付 inline)
 *   V1.x W9-10: + 备考 + B 端 controller (待)
 *   V1.x W11-12: + 调优 + 验收 (待)
 */
@Module({
  imports: [
    UserModule,
    AuthModule,
    // V2026-10-21 治本 (V1.2 VS-A — 引入 AgentModule 拿 LlmService):
    //   督导反馈真接 LLM 需要 LlmService. AgentModule re-export 了 LlmModule
    //   (src/agent/agent.module.ts:23), 且 agent 侧 0 处 import counselor → 无循环依赖.
    AgentModule,
    // V0.5: 不接 TypeOrm (内存 mock)
    // V2026-10-15 治本 (V1.x W1-2 + W3-4 + W5-6 + W7-8 — long-term-case + supervision + ability + billing TypeOrmModule.forFeature):
    //   累计 7 entity: LongTermCase + LongTermCaseSession (W1-2) + SupervisionSchool +
    //   SupervisionFeedback (W3-4) + AbilityDimension + AbilityScore (W5-6) + QuotaUsage (W7-8).
    //   跟 knowledge-base.module.ts V0.x 风格一致, 1:1 wire 注册供对应 service 注入 Repository.
    // V2026-10-19 治本 (V1.1 §6.5 — training_session 接入, 累计 8 entity):
    //   +TrainingSession (V1.1 §6.5, 9 场景单次训练 session 持久化, 跟 V0.5 client
    //   TrainingSession 1:1 wire), 跟前序 W7-8 billing 7 entity 同段.
    TypeOrmModule.forFeature([
      LongTermCase,
      LongTermCaseSession,
      SupervisionSchool,
      SupervisionFeedback,
      AbilityDimension,
      AbilityScore,
      QuotaUsage,
      TrainingSession,
      // V2026-10-19 治本 (V1.1 §5.2 — training_exercises + training_exercise_attempts
      //   接入, 累计 10 entity, 跟 §6.5 training_session 1:1 wire 拍板风格):
      TrainingExercise,
      TrainingExerciseAttempt,
      CounselorUiPreference, // V2026-10-20 治本: 专项技能 Hero 显示偏好
      // V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 entity, 累计 13 entity,
      //   跟前序 counselor_ui_preferences 同段):
      VisitorFullPersona,
      CaseProfileEntry,
      // V2026-10-21 治本 (V1.2 VS-C — M2/M3 会谈核心 3 entity, 累计 16 entity,
      //   跟前序 visitor_full_personas 同段):
      LiveSupervisionHint,
      TranscriptBookmark,
      TransferenceResistanceMark,
      // V2026-10-22 治本 (V1.3 §2 — 微技能自由练习引擎 2 entity, 累计 18 entity,
      //   跟前序 transference_resistance_marks 同段):
      PracticeScenario,
      PracticeAttempt,
      // V2026-10-22 治本 (V1.3 §7.5 — 用户私有场景表, 累计 19 entity,
      //   跟前序 practice_attempts 同段):
      PracticeCustomScenario,
      // V2026-10-22 治本 (首页金句 · 每日一句 — 2 entity, 累计 21 entity,
      //   跟前序 practice_custom_scenarios 同段):
      Quote,
      UserQuoteFavorite,
      // V2026-10-23 治本 (AI 模拟来访池 — 2 entity, 累计 23 entity,
      //   跟前序 user_quote_favorites 同段):
      //   +VisitorPoolTemplate (公共只读模板) +VisitorPoolFavorite (收藏关系)
      VisitorPoolTemplate,
      VisitorPoolFavorite,
    ]),
  ],
  controllers: [
    CounselorHomeController,
    CounselorTrainingController, // V2026-10-13 治本: P0-2 加 training controller
    CounselorExamController, // V2026-10-13 治本: P0-3 加 exam controller
    CounselorGrowthController, // V2026-10-13 治本: P0-4 加 growth controller
    CounselorProfileController, // V2026-10-13 治本: P0-5 加 profile controller
    CounselorLongTermCaseController, // V2026-10-15 治本: V1.x W1-2 加 long-term-case controller
    CounselorSupervisionController, // V2026-10-15 治本: V1.x W3-4 加 supervision controller
    CounselorAbilityController, // V2026-10-15 治本: V1.x W5-6 加 ability controller
    CounselorBillingController, // V2026-10-15 治本: V1.x W7-8 加 billing controller
    CounselorTrainingExerciseController, // V2026-10-20 治本: 专项技能训练题 + 进度聚合
    CounselorUiPreferenceController, // V2026-10-20 治本: 界面偏好 (Hero 开关)
    // V2026-10-21 治本 (V1.2 VS-A — training session controller):
    //   6 endpoint: 建会话 / 列表 / 详情 / 状态机 / 逐字稿 / 结束+派发督导.
    CounselorTrainingSessionController,
    // V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 controller):
    //   visitor-personas: 生成 / 列表 / 表层 / 上帝视角全量 / 改表层 / 绑定长程
    //   case-profile-entries: 动态解锁档案 (长程卷宗子资源)
    CounselorVisitorPersonaController,
    CounselorCaseProfileEntryController,
    // V2026-10-21 治本 (V1.2 VS-C — M2/M3 会谈核心 4 controller):
    //   informed-consent (4 要素判定 + 进度) / live-hint (轻提示 + SSE 实时流)
    //   transcript-bookmark (逐字稿打点) / transference-mark (双向移情阻抗标记)
    CounselorInformedConsentController,
    CounselorLiveHintController,
    CounselorTranscriptBookmarkController,
    CounselorTransferenceMarkController,
    // V2026-10-22 治本 (V1.3 §3 — 微技能自由练习 controller, 5 端点):
    //   progress / scenarios/:id / scenarios/:id/evaluate / random / custom-scenarios
    CounselorPracticeController,
    // V2026-10-22 治本 (首页金句 · 每日一句 controller, 5 端点):
    //   today / list (游标分页) / favorites / favorite / unfavorite
    CounselorQuoteController,
    // V2026-10-23 治本 (AI 模拟来访池 — 2 controller, 6+6 端点):
    //   visitor-pool: 公共图鉴 / 模板详情 / 克隆实例化 / 收藏开关 / 我的收藏
    //   visitor-pool-admin: AI 生成 / 管理列表 / 管理详情 / 编辑 / 软删 / 恢复 (内部角色)
    CounselorVisitorPoolController,
    CounselorVisitorPoolAdminController,
    // V2026-10-26 治本 (官方音色目录 — 1 端点):
    //   GET /counselor/voices?type=system (账号可用的官方系统音色列表)
    CounselorVoicesController,
  ],
  providers: [
    CounselorHomeService,
    CounselorExamService, // V2026-10-13 治本: P0-3 exam service
    CounselorGrowthService, // V2026-10-13 治本: P0-4 growth service
    CounselorProfileService, // V2026-10-13 治本: P0-5 profile service
    LongTermCaseService, // V2026-10-15 治本: V1.x W1-2 long-term-case service
    SupervisionService, // V2026-10-15 治本: V1.x W3-4 supervision service
    AbilityService, // V2026-10-15 治本: V1.x W5-6 ability service
    BillingService, // V2026-10-15 治本: V1.x W7-8 billing service
    TrainingExerciseService, // V2026-10-20 治本: 训练题 seed + 聚合进度 + 确定性评分
    CounselorUiPreferenceService, // V2026-10-20 治本: 界面偏好读写
    // V2026-10-21 治本 (V1.2 VS-A — 4 个新 provider):
    //   - CounselorLlmJsonClient: 结构化输出唯一出口 (收流 → 剥 think → JSON.parse → 校验)
    //   - SessionContextBuilder: 会话上下文唯一取数入口 (polymorphic)
    //   - CounselorSupervisionProcessor: 督导异步 worker (BullMQ, 依赖 RedisModule @Global)
    //   - TrainingSessionService: 会话生命周期 (状态机守卫走 domain/session-status.guard.ts)
    CounselorLlmJsonClient,
    SessionContextBuilder,
    CounselorSupervisionProcessor,
    TrainingSessionService,
    // V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 2 service):
    //   VisitorPersonaService: 视图 A 表层读写 + 上帝视角全量 + LLM 生成全量剧本
    //   CaseProfileEntryService: 视图 B 动态解锁档案 (两层分区)
    VisitorPersonaService,
    CaseProfileEntryService,
    // V2026-10-21 治本 (V1.2 VS-C — M2/M3 会谈核心 7 provider):
    //   SessionCoreEventsService:    SSE 事件总线 (counselor 端第一个实时通道)
    //   LiveSupervisionHintService:  轻提示 (5 分钟防抖 + SSE 推送)
    //   InformedConsentService:       知情同意 4 要素 LLM 判定
    //   TranscriptBookmarkService:    逐字稿打点
    //   TransferenceMarkService:      双向移情/阻抗标记
    //   TurnAnalysisService:          每轮分析器 (一次 LLM → 提示 + 标记)
    //   TurnAnalysisProcessor:        每轮分析 BullMQ worker (依赖 RedisModule @Global)
    SessionCoreEventsService,
    LiveSupervisionHintService,
    InformedConsentService,
    TranscriptBookmarkService,
    TransferenceMarkService,
    TurnAnalysisService,
    TurnAnalysisProcessor,
    // V2026-10-21 治本 (V1.2 VS-B2 — 人设接线 2 provider):
    //   ProfileExtractionService: 披露落库 + 信任度推进 + profile_entry SSE 推送
    //   CounselorVisitorContextContributor: 把全量人设/信任度/已解锁档案注入 AI 来访者 prompt
    //     (实现 agent 侧的 VisitorContextContributor 插槽, 启动时注册进 @Global 注册表;
    //      agent 侧 0 处 import counselor —— 依赖倒置, 打破循环依赖)
    ProfileExtractionService,
    CounselorVisitorContextContributor,
    // V2026-10-23 治本 (v2.0 语音对语音 — 公共人物模板解析器):
    //   注册进 voice 侧的 @Global 模板解析注册表, 供 WS 握手校验 templateId
    CounselorVisitorPoolTemplateResolver,
    // V2026-10-22 治本 (V1.3 §3 — 微技能自由练习 3 service):
    //   PracticeScenarioService (读侧 + 可见性) / PracticeEvaluatorService (评判引擎)
    //   PracticeAttemptService (写侧编排 + 私有场景生成)
    // V2026-10-22 治本 (V1.3 §7.2 — 新增 3 service):
    //   PracticeCustomScenarioService (私有场景生成/列表) / PracticeQuotaService (日配额)
    //   PracticeAbilitySyncService (五维画像回写)
    PracticeScenarioService,
    PracticeEvaluatorService,
    PracticeAttemptService,
    PracticeCustomScenarioService,
    PracticeQuotaService,
    PracticeAbilitySyncService,
    // V2026-10-23 治本 (语音微训练 STT 代理 — 4 provider):
    //   客户端/编排/限流/上传 filter 一起注册, 缺一个都会在启动或运行时报
    //   UndefinedDependencyException (filter 缺了不会报错, 但异常会走全局 filter,
    //   业务码退化成 UnknownError —— 这种"静默降级"最难查, 所以 4 个一次注册齐).
    PracticeAsrClient,
    PracticeAsrService,
    PracticeAsrThrottlerGuard,
    PracticeAsrUploadFilter,
    // V2026-10-22 治本 (首页金句 · 每日一句 service):
    //   QuoteService (今日轮换 / 游标分页 / 收藏)
    QuoteService,
    // V2026-10-23 治本 (AI 模拟来访池 — 2 service + 1 guard):
    //   VisitorPoolService (公共图鉴 / 克隆实例化 / 收藏)
    //   VisitorPoolAdminService (内部 AI 生成 + 模板治理)
    //   AdminRoleGuard (内部角色判定, 供 visitor-pool-admin controller 使用)
    VisitorPoolService,
    VisitorPoolAdminService,
    AdminRoleGuard,
    // V2026-10-26 治本 (官方音色目录代理 — 2 provider):
    //   VoicesClient (上游协议层) + VoicesService (缓存 / 去重 / 错误归一 / 插槽实现).
    //   两个一次注册齐 —— 少了 client 会 UndefinedDependencyException, 少了 service
    //   则端点 404 且 WS 网关拿不到音色目录判定.
    VoicesClient,
    VoicesService,
  ],
  exports: [
    CounselorHomeService,
    CounselorExamService,
    CounselorGrowthService,
    CounselorProfileService,
    LongTermCaseService, // V2026-10-15 治本: V1.x W1-2 导出
    SupervisionService, // V2026-10-15 治本: V1.x W3-4 导出
    AbilityService, // V2026-10-15 治本: V1.x W5-6 导出
    BillingService, // V2026-10-15 治本: V1.x W7-8 导出
    TrainingExerciseService, // V2026-10-20 治本: 导出供 progress 聚合复用
    CounselorUiPreferenceService, // V2026-10-20 治本: 导出
    // V2026-10-21 治本 (V1.2 VS-A — 导出供后续 VS-B/C/D/E 消费):
    //   VS-B (分层人设) 要用 SessionContextBuilder + CounselorLlmJsonClient;
    //   VS-C (知情同意/轻提示) 要用 TrainingSessionService + SessionContextBuilder;
    //   提前导出, 避免下一个切片再改 module 装配 (反复动装配是 DI 漏注册的根源).
    TrainingSessionService,
    SessionContextBuilder,
    CounselorLlmJsonClient,
    // V2026-10-21 治本 (V1.2 VS-B1 — 导出供 VS-B2 接 visitor prompt 时复用):
    VisitorPersonaService,
    CaseProfileEntryService,
    // V2026-10-21 治本 (V1.2 VS-C — 导出供 VS-D (长程卷宗) / VS-E (督导闭环) 复用):
    //   SessionContextBuilder 已经装好信任度 + 已解锁档案, VS-D 的长程 Tab 直接用
    //   LiveSupervisionHintService / TransferenceMarkService: VS-E 的督导报告要锚定
    //   bookmark + 汇总移情阻抗趋势
    LiveSupervisionHintService,
    TranscriptBookmarkService,
    TransferenceMarkService,
    InformedConsentService,
    // V2026-10-21 治本 (V1.2 VS-B2 — 导出供 VS-D 长程卷宗 / VS-E 督导闭环 复用):
    //   信任度推进 + 档案条目落库都在这, 长程趋势图与督导报告要引用
    ProfileExtractionService,
    // V2026-10-22 治本 (V1.3 §3 — 导出供后续 V2 能力复用):
    //   练习引擎的可见性谓词在 PracticeScenarioService 里 (唯一一处), 后续做
    //   "练习记录回灌五维画像"(spec §5 P3) 时要读同一份场景与作答数据, 避免
    //   另起一套可见性判断.
    PracticeScenarioService,
    PracticeAttemptService,
  ],
})
export class CounselorModule {}
