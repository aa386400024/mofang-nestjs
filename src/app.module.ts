import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE, RouterModule } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import path from 'node:path';

import { AuthModule } from './auth';
import { BaseModule } from './base';
import { CommonModule } from './common';
import { BizExceptionFilter } from './common/filters/biz-exception.filter';
import { SentryService } from './shared/infra/observability';
import { configuration, loggerOptions } from './config';
import { SampleModule as DebugSampleModule } from './debug';
import { GqlModule } from './gql';
import { SampleModule } from './sample';
import { UserCronModule } from './user/cron/cron.module';
import { UserModule } from './user';
import { OAuthModule } from './user/oauth';
import {
  EmailModule,
  MetricsModule,
  ObservabilityModule,
  QueueModule,
  RedisModule,
  SmsModule,
} from './shared/infra';

@Module({
  imports: [
    // https://getpino.io
    // https://github.com/iamolegga/nestjs-pino
    LoggerModule.forRoot(loggerOptions),
    // Configuration
    // https://docs.nestjs.com/techniques/configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // Database
    // https://docs.nestjs.com/techniques/database
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        ...config.get<TypeOrmModuleOptions>('db'),
      }),
      inject: [ConfigService],
    }),
    // Schedule (Cron 任务, V2 新增)
    // https://docs.nestjs.com/techniques/task-scheduling
    ScheduleModule.forRoot(),
    // 共享基础设施层 (V2 新增)
    RedisModule, // JWT blacklist / 验证码 / 限流
    QueueModule, // BullMQ 异步队列 (审计日志)
    EmailModule, // SMTP 邮件
    SmsModule, // 短信
    MetricsModule, // Prometheus
    ObservabilityModule, // Sentry 异常上报
    // Static Folder
    // https://docs.nestjs.com/recipes/serve-static
    // https://docs.nestjs.com/techniques/mvc
    ServeStaticModule.forRoot({
      rootPath: path.join(__dirname, '..', 'public'),
      renderPath: '/',
    }),
    // Rate Limiting (大厂防爆破标配)
    // https://docs.nestjs.com/security/rate-limiting
    // 默认全局: 60 秒内最多 60 个请求
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000, // 60 秒 (毫秒)
          limit: 60, // 60 个请求
        },
      ],
    }),
    // Service Modules
    AuthModule, // 项目示例保留 (passport session 模式)
    CommonModule, // 项目示例保留 (middleware + public decorators)
    BaseModule, // 项目示例保留 (basic auth/jwt controllers)
    SampleModule, // 项目示例保留
    GqlModule, // 项目示例保留
    DebugSampleModule, // 项目示例保留
    UserModule, // 心塑 + 魔方共用账号模块 (大厂 monorepo 核心 V2)
    OAuthModule, // V2 新增: 微信/Google/Apple 第三方登录 (依赖 UserModule)
    UserCronModule, // V2 新增: 软删 cron + session cleanup
    // Module Router
    // https://docs.nestjs.com/recipes/router-module
    RouterModule.register([
      {
        path: 'test',
        module: SampleModule,
      },
      {
        path: 'test',
        module: DebugSampleModule,
      },
    ]),
  ],
  providers: [
    // Global Throttler Guard (rate limiting)
    // https://docs.nestjs.com/security/rate-limiting#configuration
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global Filter: 统一错误响应格式 { code, message, data }
    // useFactory + inject 才能拿到 SentryService (useClass 不会自动注入)
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