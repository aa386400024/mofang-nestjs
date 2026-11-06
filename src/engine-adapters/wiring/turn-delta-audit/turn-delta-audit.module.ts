// V2026-11-06 治本 (WP58 · B 层 · 事件 + delta 审计观测模块):
//   职责: 把观测通道装进 NestJS —— 实体注册 + 服务 + 端口绑定.
//   边界: 只装配; 不含决策.
//
//   为什么单独成模块 (而不是把 provider 堆进 EngineWiringModule):
//     ① 架构纪律: 引擎装配层 (wiring/ 顶层) 有一条硬约束 —— **不得直接依赖 ORM /
//        向量库 / 厂商 SDK** (WP8-A §8-9 单测按包名判定: 扫 wiring/ 顶层的 .ts,
//        命中 typeorm / @nestjs/typeorm 即红). 审计表必须连库, 若把
//        TypeOrmModule.forFeature 直接写进 engine.module.ts, 装配层就得 import
//        '@nestjs/typeorm' —— 护栏立刻红.
//        拆成模块后: engine.module.ts 只 import 本模块 (相对路径), 零 SDK 包名;
//        换数据源只改本模块里那一处绑定.
//        (与 CharacterPoolModule 完全同款 —— 它当初也是为同一条护栏拆出来的.)
//     ② 职责内聚: 审计表 + 观测服务自成一块, 与引擎装配的其余部分解耦.
//
//   反双胞胎:
//     - 不把同一个 token 绑到两个 provider: 一个 token 只能有一个 provider,
//       否则 Nest 报 ambiguous dependency.
//     - 不在本模块里读引擎内核状态: 观测服务只看"文本 + 事件类型" ——
//       归属与轮次号由门面 (EngineTurnService) 传进来.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp8-wiring.spec.ts §8-9 护栏仍绿 (装配层零 SDK 依赖)
//     3. test/engine-adapters/wp58-turn-delta-audit.spec.ts 覆盖装配与端口贯通

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TurnDeltaAuditEntity } from './turn-delta-audit.entity.js';
import { TURN_DELTA_AUDIT } from './turn-delta-audit.port.js';
import { TurnDeltaAuditService } from './turn-delta-audit.service.js';

/**
 * 事件 + delta 审计观测模块.
 */
@Module({
  imports: [
    // turn_delta_audits 实体注册 (autoLoadEntities 已开; ADR-0003: 不开 synchronize,
    // schema 只走 migration).
    TypeOrmModule.forFeature([TurnDeltaAuditEntity]),
  ],
  providers: [
    TurnDeltaAuditService,
    // 窄端口绑定: 门面注入的是**接口** token, 实现就在本模块 (见 port 文件头的理由).
    { provide: TURN_DELTA_AUDIT, useExisting: TurnDeltaAuditService },
  ],
  exports: [TURN_DELTA_AUDIT, TurnDeltaAuditService],
})
export class TurnDeltaAuditModule {}
