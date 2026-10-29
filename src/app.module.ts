import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
// node:fs / node:path 没 default export, unicorn/import-style 误报 — 忽略.

import { existsSync, mkdirSync } from 'node:fs';
// eslint-disable-next-line unicorn/import-style
import { resolve } from 'node:path';

import { AgentModule } from './agent/agent.module';
import { AiConversationsModule } from './ai-companion/ai-conversations.module';
import { AIEngineModule } from './ai-engine/ai-engine.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth';
import { BaseModule } from './base/base.module';
import { BillingModule } from './billing/billing.module';
import { CommonModule } from './common';
import { BizExceptionFilter } from './common/filters/biz-exception.filter';
import { CompanionModule } from './companion/companion.module';
import { configuration, loggerOptions } from './config';
import { ConsentModule } from './consent';
// V2026-10-13 治本 (Phase 7.10 — counselor 端 server module 注册):
//   心理咨询师学员端「首页」Tab server 端, 跟 xin_su_app counselor_home
//   1:1 对应. V0.5 简化: 仅 home overview 1 endpoint, 内存 mock.
//   V1.x 改造: 加 training/exam/growth/profile 4 子 controller, 接数据库.
// V2026-10-13 治本 (V0.2 — billing.module import 漏修):
//   上一轮 app.module.ts imports 数组加 `BillingModule, // /billing/*` 成功, 但顶部 import
//   漏写 `import { BillingModule } from './billing/billing.module';`, pnpm build 报
//   TS2304 'Cannot find name BillingModule'. 治本: 补 import 跟 counselor 风格一致
//   (字母序 B < C, 在 CounselorModule 之前).
import { CounselorModule } from './counselor/counselor.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AppNamingStrategy } from './database/naming-strategy';
import { EmbodiedModule } from './embodied/embodied.module';
import { EmergencyModule } from './emergency/emergency.module';
// V2026-10-28 治本 (WP8-A — 引擎装配层接入 DI):
//   把 WP0–WP7 的引擎纯单元 (内核会话 / 渲染适配器 / 装配门面) 装进依赖注入,
//   并注册聚合调试端点 /engine/debug/{open,turn,close} (JWT 保护, 仅联调).
//   本期**不接**语音链路 / 不做流式 / 不替换旧 agent/visitor 直出 (归 WP8-B).
//   反双胞胎: 与既有 AIEngineModule / VoiceModule / CounselorModule **并存**,
//   新引擎自成一家, 谁也不替换谁 —— 灰度切换是 WP8-B 的事.
import { EngineWiringModule } from './engine-adapters/wiring/engine.module';
import { GenomeReshapeModule } from './genome-reshape/genome-reshape.module';
import { GoodStateDiaryModule } from './good_state_diary/good_state_diary.module';
import { GuideModule } from './guide/guide.module';
import { HomeModule } from './home/home.module';
import { GameUnlockModule } from './inner_world/game-unlock.module';
// V2026-10-12 治本 (pre-existing inner-world 文件名 vs import path 错位):
//   实际文件 src/inner_world/inner_world.module.ts (下划线), 但 import 写
//   './inner_world/inner-world.module' (dash), Node 解析失败, build 断. 这是
//   pre-existing bug (跟 8.x 无关), 治本: 改 import 路径对齐文件名.
import { InnerWorldModule } from './inner_world/inner_world.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
// V2026-10-14 治本 (VS-life-merge P0-治本 — life_map 0% 真接 + drift migration 缺失):
//   原因: V0.5 P0-6 治本时只把 app.module.ts import 改路径 (从 life-map/ 改到 life_map/),
//     但没合并两个目录内容. life_map/ (下划线) 1 endpoint overview 是中间态,
//     0 client 调用 (grep 0 命中). life-map/ (中划线) V3.0 + V6.0 完整版 12+6 endpoint
//     全部埋盘未注册, 4 entity 表 ship 到 db 但 service 接不上. snapshot V2 §6.2 表第 18 行
//     标 "✅ P0-6 done" 是严重误报 (V3 深度扫描 4 subagent 实读 297 file 验证).
//   修法: 删 src/life_map/ 整目录 4 file + 改 app.module.ts 2 处 (本 import + L216 entry) +
//     新写 1700000010005-AddDriftBottles.ts migration (life_map_drift_bottles 表缺失) +
//     bin/ormconfig.ts + src/migration/index.ts 同步注册.
//   反双胞胎: 不复用 life_map/ underscore 1 endpoint (跟 dash 版 12 endpoint 是子集,
//     删除不会丢功能). 1 endpoint 是 V0.5 P0-6 过渡态, 18 endpoint 是 V3.0 完整版终态.
//   验证: 跑 pnpm build 验 TS 编译过 + grep 'life_map/' src/ 0 命中 +
//     grep 'from .\./life-map' src/app.module.ts 1 命中 (新 import) +
//     grep '1700000010005' bin/ormconfig.ts 1 命中 (新 entry) +
//     跑 pnpm migration:run 创 life_map_drift_bottles 表.
//   时间戳: 2026-10-14 09:45 GMT+8 (V3 深度扫描发现 → 今日 VS-life-merge 治本).
import { LifeMapModule } from './life-map/life-map.module';
import { PracticeModule } from './practice/practice.module';
import { ProfileModule } from './profile';
import { EmailModule, MetricsModule, ObservabilityModule, QueueModule, RedisModule, SmsModule } from './shared/infra';
import { SentryService } from './shared/infra/observability';
import { UserModule } from './user';
import { UserCronModule } from './user/cron/cron.module';
import { OAuthModule } from './user/oauth';
import { VoiceModule } from './voice/voice.module';

// ⚠️ AuthModule + BaseModule 必装: V2-temp 误删后, 心塑前端 /auth/* 路由全 404.
// - AuthModule: 提供 AuthService / LoginCodeService / JwtModule / Guards
// - BaseModule: 注册 AuthController (/auth/send-code /auth/verify-code /auth/login ...)
//               + HealthController (/health)

/**
 * V2 AppModule — 大厂生产级.
 *
 * V2-temp: 暂时移除了 demo 模块 (AuthModule / GqlModule / SampleModule / DebugSampleModule).
 * 这些代码还在 src/{auth,gql,sample,debug} 目录里, V3 清理 demo 代码时直接删除整个目录即可.
 *
 * 业务模块:
 *   - UserModule: 心塑 + 魔方共用账号
 *   - OAuthModule: 微信/Google/Apple 第三方登录
 *   - UserCronModule: 软删 cron + session cleanup
 */
@Module({
  imports: [
    // https://getpino.io
    // https://github.com/iamolegga/nestjs-pino
    LoggerModule.forRoot(loggerOptions),
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // Database
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        ...config.get<TypeOrmModuleOptions>('db'),
        namingStrategy: new AppNamingStrategy(),
      }),
      inject: [ConfigService],
    }),
    // Schedule (Cron 任务)
    ScheduleModule.forRoot(),
    // V2026-08-27 治本: 头像本地磁盘存储 serve.
    //   - serveRoot: '/uploads' — 缩小到子路径, 不拦截 API 路由
    //     (之前用 SPA renderPath='/' 坑过 /profile/me, 这里走 serveRoot 不踩)
    //   - 路径从 env UPLOAD_STORAGE_DIR 读, dev 用 ./uploads, prod 用 /var/www/...
    //   - ServeStaticModule 是 asyncFactory, env 没配置时跳过注册 (而不是 crash)
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const storageDir = (config.get<string>('UPLOAD_STORAGE_DIR') ?? './uploads').replaceAll(/^["']|["']$/g, '').trim();
        const fullPath = resolve(process.cwd(), storageDir);
        // 启动时确保 uploads 目录存在 (dev 首次启动).
        // express.static 容忍目录不存在 (请求时 404), 但提前 mkdir 更友好.
        if (!existsSync(fullPath)) {
          try {
            mkdirSync(fullPath, { recursive: true });
          } catch {
            // mkdir 失败不影响 serve-static 注册 (请求时才报错)
          }
        }
        return [
          {
            rootPath: fullPath,
            // 缩小到子路径 '/uploads', 不拦截 API 路由
            // (之前用 SPA renderPath='/' 坑过 /profile/me, 这里走 serveRoot 不踩)
            serveRoot: '/uploads',
            // V2026-08-27: 头像图片跨域 (Flutter Web localhost:9090 → 后端 localhost:3000).
            //   <img> 默认不受 CORS 限制, 但加上 setHeader 更稳, 防 future-proof 用 canvas
            //   drawImage / OffscreenCanvas 读取图片像素的场景.
            //   dev: * 允许任意 origin (本地开发), prod 应限定前端域名.
            serveStaticOptions: {
              // V2026-08-27: 头像图片跨域 (Flutter Web localhost:9090 → 后端 localhost:3000).
              //   <img> 默认不受 CORS 限制, 但加上 setHeader 更稳, 防 future-proof 用 canvas
              //   drawImage / OffscreenCanvas 读取图片像素的场景.
              //   dev: * 允许任意 origin (本地开发), prod 应限定前端域名.
              // setHeaders callback 签名是 (res: any, path, stat) => void, @types/express-serve-static-core
              // 本身没完整定义 res 类型, 所以 @typescript-eslint/no-unsafe-call 会报.
              // 治本: 类型注解 res 为 express Response 显式类型, 避开 any 推断.
              setHeaders: ((res: import('express').Response, _path: string, _stat: import('node:fs').Stats) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
              }) as unknown as (res: unknown, path: string, stat: unknown) => void,
            },
          },
        ];
      },
    }),
    // 共享基础设施层 (V2)
    RedisModule,
    QueueModule,
    EmailModule,
    SmsModule,
    MetricsModule,
    ObservabilityModule,
    // Rate Limiting (大厂防爆破标配)
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: 60,
        },
      ],
    }),
    // 公共模块 (CommonModule 用 loggerContext middleware)
    CommonModule,
    // V2 业务模块
    UserModule,
    // AuthModule 必须先于 BaseModule, 因为 BaseModule 的 AuthController 依赖 AuthService / LoginCodeService.
    AuthModule,
    BaseModule,
    OAuthModule,
    UserCronModule,
    // V3 合规模块 (心塑 + 魔方共用同意记录)
    ConsentModule,
    // V2026-08-31 — 心塑「首页」Tab V2.0 模块 (成长用户 + 陪伴者双端首页)
    HomeModule,
    // V3 — 心塑「我的」Tab 二级页 (Profile 模块, V2.0 全部 13 页对应接口)
    ProfileModule,
    // V2026-08-28 — 「我的」Tab V2.0 4 个新页面专用模块
    AiConversationsModule, // /profile/ai-conversations
    DashboardModule, // /profile/dashboard/*
    // V2026-10-13 治本 (Phase 7.10 P0-6 — 删老占位 LifeMapModule entry):
    //   老的 L172 `LifeMapModule, // /profile/life-map` 跟新模块 (L208) 同类同名
    //   重复注册, NestJS 启动会抛 AlreadyRegistered. 删老占位, 留 P0-6 新模块 (心理地图 Tab).
    EmbodiedModule, // /profile/embodied-data/*
    // V2026-08-28: 隐私授权 + 数据导出走 ProfileModule 内的 controller (保持模块边界)
    // V2026-09-01 — 心塑成长端「练习」Tab (8 大分类 + 心理健身房 + 具身认知)
    PracticeModule, // /practice/*
    // V2026-10-12 — Phase 8.1+8.3 admin KB + analytics, spec §8.1 / §12.1+§12.5
    //   KnowledgeBaseModule: KB CRUD + workflow + version + schedule + preview + search
    //   AnalyticsModule: 4 KPI + 4 trend 实时聚合 (走 analytics_events 事件表)
    //   V1.x 接入 RAG / Qdrant 时, 加新 module (RagModule) 走 V2 KB 拆 knowledge_chunks 表.
    KnowledgeBaseModule, // /admin/knowledge-items/* + /admin/knowledge-items/:id/preview
    AnalyticsModule, // /admin/analytics/overview
    InnerWorldModule, // /inner-world/* (V4.0 §3 完整游戏化核心层)
    // V2026-09-01 — 心塑陪伴者端「陪伴」Tab (8 大分区 + 双人协同 + 关系管理)
    CompanionModule, // /companion/*
    // V2026-09-01 — 心塑成长端「评估」Tab 完整化 + 心理基因靶向重塑
    GenomeReshapeModule, // /reshape/*
    // V2026-09-01 — 心塑陪伴者端「指南」Tab
    GuideModule, // /guide/*
    // V2026-09-04 — 心塑 V6.0 §3 AI 引擎 5 仓库 + §3.5 LLM 流式编排 + §11.2 危机检测
    AIEngineModule, // /ai/* + /v1/chat/*
    // V2026-10-08 — AI 语音训练系统 (SPEC v0.1, Phase 1.1 LLM streaming)
    AgentModule, // /agent/llm/stream
    // V2026-10-08 — AI 语音训练系统 (SPEC v0.1, Phase 1.2 TTS bidi 客户端 + 连接池)
    VoiceModule, // TtsService + TtsBidiPoolService (无 HTTP 端点, 仅内部 VoiceGateway 使用)
    // V2026-10-28 — WP8-A 引擎装配层: 聚合调试端点 /engine/debug/* (JWT, 仅联调)
    //   与既有 AIEngineModule / VoiceModule 并存, 本期不替换旧 visitor 直出链路 (归 WP8-B).
    EngineWiringModule, // /engine/debug/*
    // V2026-09-04 — 心塑 V6.0 §4.2 急救闭环 — 5 工具会话上报 + 跨设备同步
    EmergencyModule, // /emergency/*
    // V2026-10-13 — 心理咨询师学员端 server module (Phase 7.10 启动 P0-1)
    //   V0.5: counselor/home/overview 1 endpoint, V1.x 加 training/exam/growth/profile
    CounselorModule, // /counselor/home/overview
    // V2026-09-04 — 心塑 V6.0 §6 Inner World 游戏化模块解锁进度 (game_unlock_progress V2 表)
    GameUnlockModule, // /inner-world/game-unlock/*
    // V2026-09-11 — 心塑「好状态日记」模块 (V4.0 §6 觉察日记云端契约, 9 + 1 端点)
    GoodStateDiaryModule, // /diary/entries/* + /ai/diary-feedback
    // V2026-10-14 治本 (VS-life-merge P0-治本 — 改挂 life-map/ dash V3.0 + V6.0 完整版):
    //   取代 V0.5 P0-6 旧 1 endpoint overview 中间态 (已删 src/life_map/), 现挂
    //   life-map/ dash 版 18 endpoint 完整 (V3.0 心理地图 12 + V6.0 §6.5 漂流瓶 6),
    //   4 entity 表 (life_stage_progress + key_events + genome_dimensions + life_map_drift_bottles)
    //   全部接真. client lib/features/life_map/ 已在用 /profile/life-map/*, server 切换
    //   后立即真接 V3.0 + V6.0, 0 客户端改动.
    //   V1.x: 推演 + 报告 unlock 阈值 (阶段全填 + 事件 ≥3 + 维度 5 全填) 走真数据库.
    LifeMapModule, // /profile/life-map/* (V3.0 12) + /life-map/drift-bottles/* (V6.0 6)
    // V2026-10-13 — 心塑「商业化」模块 (V0.2 启动 Phase 8, 4 档会员 + 4 SKU 单次)
    //   V0.5: 4 endpoint (membership/products/orders POST/orders GET), 内存 mock, 微信/支付宝
    //   真接未申请 → paymentChannel 写死 'reserved', 客户端 UI 显 "支付通道预留中".
    //   V1.x: TypeORM billing entities + 真接微信 V2 / 支付宝 + 配额 guard cron.
    BillingModule, // /billing/*
  ],
  providers: [
    // Global Throttler Guard
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global Filter: 统一错误响应格式 { code, message, data }
    {
      provide: APP_FILTER,
      useFactory: (sentry: SentryService) => new BizExceptionFilter(sentry),
      inject: [SentryService],
    },
    // Global Pipe: 校验 DTO
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    },
  ],
})
export class AppModule {}
