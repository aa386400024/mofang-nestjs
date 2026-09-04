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

import { AiConversationsModule } from './ai-companion/ai-conversations.module';
import { AIEngineModule } from './ai-engine/ai-engine.module';
import { AuthModule } from './auth';
import { BaseModule } from './base/base.module';
import { CommonModule } from './common';
import { BizExceptionFilter } from './common/filters/biz-exception.filter';
import { CompanionModule } from './companion/companion.module';
import { configuration, loggerOptions } from './config';
import { ConsentModule } from './consent';
import { DashboardModule } from './dashboard/dashboard.module';
import { AppNamingStrategy } from './database/naming-strategy';
import { EmbodiedModule } from './embodied/embodied.module';
import { EmergencyModule } from './emergency/emergency.module';
import { GenomeReshapeModule } from './genome-reshape/genome-reshape.module';
import { GuideModule } from './guide/guide.module';
import { HomeModule } from './home/home.module';
import { GameUnlockModule } from './inner_world/game-unlock.module';
import { InnerWorldModule } from './inner_world/inner_world.module';
import { LifeMapModule } from './life-map/life-map.module';
import { PracticeModule } from './practice/practice.module';
import { ProfileModule } from './profile';
import { EmailModule, MetricsModule, ObservabilityModule, QueueModule, RedisModule, SmsModule } from './shared/infra';
import { SentryService } from './shared/infra/observability';
import { UserModule } from './user';
import { UserCronModule } from './user/cron/cron.module';
import { OAuthModule } from './user/oauth';

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
    LifeMapModule, // /profile/life-map
    EmbodiedModule, // /profile/embodied-data/*
    // V2026-08-28: 隐私授权 + 数据导出走 ProfileModule 内的 controller (保持模块边界)
    // V2026-09-01 — 心塑成长端「练习」Tab (8 大分类 + 心理健身房 + 具身认知)
    PracticeModule, // /practice/*
    InnerWorldModule, // /inner-world/* (V4.0 §3 完整游戏化核心层)
    // V2026-09-01 — 心塑陪伴者端「陪伴」Tab (8 大分区 + 双人协同 + 关系管理)
    CompanionModule, // /companion/*
    // V2026-09-01 — 心塑成长端「评估」Tab 完整化 + 心理基因靶向重塑
    GenomeReshapeModule, // /reshape/*
    // V2026-09-01 — 心塑陪伴者端「指南」Tab
    GuideModule, // /guide/*
    // V2026-09-04 — 心塑 V6.0 §3 AI 引擎 5 仓库 + §3.5 LLM 流式编排 + §11.2 危机检测
    AIEngineModule, // /ai/* + /v1/chat/*
    // V2026-09-04 — 心塑 V6.0 §4.2 急救闭环 — 5 工具会话上报 + 跨设备同步
    EmergencyModule, // /emergency/*
    // V2026-09-04 — 心塑 V6.0 §6 Inner World 游戏化模块解锁进度 (game_unlock_progress V2 表)
    GameUnlockModule, // /inner-world/game-unlock/*
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
