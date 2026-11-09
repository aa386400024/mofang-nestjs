// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · NestJS 模块):
//   职责: 注册闸门服务 (决策入口) —— 装配层唯一的接入点.
//   边界: 只做「读配置 → 造纯对象 → 注入」; 不写判定 (判定在 evaluator.ts).
//
//   为什么要独立成模块 (而不是塞进 engine.module.ts 的 providers):
//     ① **可拆分** (任务单 §三): 以后把闸门拆成独立微服务时, 整个目录搬出去就行 ——
//        这一层不认识 Nest 之外的任何东西 (Redis 走基础设施窄面, 不认识 ioredis);
//     ② **零厂商 SDK**: 闸门只依赖 ConfigService 与 RedisService 两个窄面,
//        不碰任何厂商 SDK (ORM 是仓库自有基础设施, 见下方 V2026-11-09 段落);
//     ③ 装配非法要在**启动期**炸, 而不是运行时静默降级 —— useFactory 显式 new, 装配即校验.
//
//   V2026-11-09 治本 (Phase2.5 · 闸门 trace 查询接口): 闸门决策**落 MySQL 真相源**
//     · 新增 `GateDecisionStore` (唯一写 `gate_decisions` 表的实现);
//     · 写侧: `DeliberationGateTrace` 多接一个持久化口 (Redis / MySQL / 写时计数 三写).
//
//   ⚠️ **为什么这个模块可以碰 ORM** (而 `engine-adapters/wiring/` 顶层不行):
//     装配层顶层有一条硬护栏 (WP8-A §8-9 单测按包名判定) —— 引擎装配层不许直接依赖
//     ORM / 向量库 / 厂商 SDK. 但**闸门模块不是装配层**, 它是 engine-adapters 下的
//     业务模块, 与 `eval/` (eval_reports 落库) 同款: ORM 依赖收在**子模块**里,
//     上层只 import 本模块 (相对路径, 不出现包名) —— 护栏仍然绿.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/deliberation-gate/quotas.spec.ts 覆盖装配与降级
//     3. test/engine-adapters/wp8-wiring.spec.ts §8-9 护栏仍绿

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { resolveDeliberationGateConfig } from './deliberation-gate.config.js';
import { DeliberationGateQuotas } from './deliberation-gate.quotas.js';
import { DeliberationGateService } from './deliberation-gate.service.js';
import { DeliberationGateTrace } from './deliberation-gate.trace.js';
import { GateDecisionEntity } from './gate-decision/gate-decision.entity.js';
import { GateDecisionStore } from './gate-decision/gate-decision.store.js';
import { RedisService } from '../../shared/infra/redis/redis.service.js';

/**
 * 触发式审议闸门模块.
 */
@Module({
  imports: [
    // gate_decisions 实体注册 (ADR-0003: 不开 synchronize, schema 只走 migration).
    TypeOrmModule.forFeature([GateDecisionEntity]),
  ],
  providers: [
    // 闸门决策落库 (MySQL 真相源) —— 写失败只打 warn, 不炸会话.
    GateDecisionStore,
    {
      // 走 useFactory 而不是 useClass: 闸门服务的构造参数是聚合对象,
      // Nest 按 design:paramtypes 解析只会得到 "Object" —— 那是启动炸弹.
      provide: DeliberationGateService,
      useFactory: (config: ConfigService, redis: RedisService, store: GateDecisionStore): DeliberationGateService =>
        new DeliberationGateService({
          config: resolveDeliberationGateConfig(config),
          quotas: new DeliberationGateQuotas(redis),
          trace: new DeliberationGateTrace(redis, store),
        }),
      inject: [ConfigService, RedisService, GateDecisionStore],
    },
  ],
  exports: [DeliberationGateService],
})
export class DeliberationGateModule {}
