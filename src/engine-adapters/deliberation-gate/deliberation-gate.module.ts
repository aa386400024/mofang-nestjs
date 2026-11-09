// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · NestJS 模块):
//   职责: 注册闸门服务 (决策入口) —— 装配层唯一的接入点.
//   边界: 只做「读配置 → 造纯对象 → 注入」; 不写判定 (判定在 evaluator.ts).
//
//   为什么要独立成模块 (而不是塞进 engine.module.ts 的 providers):
//     ① **可拆分** (任务单 §三): 以后把闸门拆成独立微服务时, 整个目录搬出去就行 ——
//        这一层不认识 Nest 之外的任何东西 (Redis 走基础设施窄面, 不认识 ioredis);
//     ② **零 ORM / 零 SDK**: 装配层有一条硬护栏 (WP8-A §8-9) —— 闸门只依赖
//        ConfigService 与 RedisService 两个窄面, 不碰任何厂商 SDK;
//     ③ 装配非法要在**启动期**炸, 而不是运行时静默降级 —— useFactory 显式 new, 装配即校验.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/deliberation-gate/quotas.spec.ts 覆盖装配与降级

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveDeliberationGateConfig } from './deliberation-gate.config.js';
import { DeliberationGateQuotas } from './deliberation-gate.quotas.js';
import { DeliberationGateService } from './deliberation-gate.service.js';
import { DeliberationGateTrace } from './deliberation-gate.trace.js';
import { RedisService } from '../../shared/infra/redis/redis.service.js';

/**
 * 触发式审议闸门模块.
 */
@Module({
  providers: [
    {
      // 走 useFactory 而不是 useClass: 闸门服务的构造参数是聚合对象,
      // Nest 按 design:paramtypes 解析只会得到 "Object" —— 那是启动炸弹.
      provide: DeliberationGateService,
      useFactory: (config: ConfigService, redis: RedisService): DeliberationGateService =>
        new DeliberationGateService({
          config: resolveDeliberationGateConfig(config),
          quotas: new DeliberationGateQuotas(redis),
          trace: new DeliberationGateTrace(redis),
        }),
      inject: [ConfigService, RedisService],
    },
  ],
  exports: [DeliberationGateService],
})
export class DeliberationGateModule {}
