import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import path from 'node:path';

import { CommonModule } from './common';
import { BizExceptionFilter } from './common/filters/biz-exception.filter';
import { configuration, loggerOptions } from './config';
import { ConsentModule } from './consent';
import { EmailModule, MetricsModule, ObservabilityModule, QueueModule, RedisModule, SmsModule } from './shared/infra';
import { SentryService } from './shared/infra/observability';
import { UserModule } from './user';
import { UserCronModule } from './user/cron/cron.module';
import { OAuthModule } from './user/oauth';

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
      }),
      inject: [ConfigService],
    }),
    // Schedule (Cron 任务)
    ScheduleModule.forRoot(),
    // 共享基础设施层 (V2)
    RedisModule,
    QueueModule,
    EmailModule,
    SmsModule,
    MetricsModule,
    ObservabilityModule,
    // Static Folder
    ServeStaticModule.forRoot({
      rootPath: path.join(__dirname, '..', 'public'),
      renderPath: '/',
    }),
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
    OAuthModule,
    UserCronModule,
    // V3 合规模块 (心塑 + 魔方共用同意记录)
    ConsentModule,
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
