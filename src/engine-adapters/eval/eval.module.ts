// V2026-11-09 治本 (Phase2.5 WP-E · 自动评测 · Nest 模块):
//   职责: 把评测入口装进 NestJS —— 实体注册 + 服务 + 仓储端口绑定.
//   边界: 只装配; 不含判定.
//
//   为什么单独成模块 (跟 turn-delta-audit.module.ts 同款理由):
//     ① 架构纪律: 引擎装配层 (wiring/ 顶层) 有一条硬约束 —— **不得直接依赖 ORM /
//        向量库 / 厂商 SDK** (WP8-A §8-9 单测按包名判定). 评测要连库落报告,
//        若把 TypeOrmModule.forFeature 写进上层模块, 装配层就得 import '@nestjs/typeorm' —— 护栏立刻红.
//        拆成独立模块后: 上层只 import 本模块 (相对路径), 零 SDK 包名.
//     ② 职责内聚: 评测流水线 + 报告落库自成一块, 与业务模块解耦.
//
//   反双胞胎:
//     - EVAL_REPORT_REPOSITORY 一个 token 只绑一个 provider (否则 Nest 报 ambiguous dependency).
//     - 纯函数层 (指标 / 报告装配 / 清洗) 不在本模块里注册 —— 它们不需要 DI.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp8-wiring.spec.ts §8-9 护栏仍绿 (装配层零 SDK 依赖)
//
//   时间戳: 2026-11-09

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EvalReportEntity } from './eval-report.entity.js';
import { TypeOrmEvalReportRepository } from './eval-report.repository.js';
import { EVAL_REPORT_REPOSITORY } from './eval.report.js';
import { EvalService } from './eval.service.js';

/**
 * 自动评测 + 参数调优模块.
 */
@Module({
  imports: [
    // eval_reports 实体注册 (ADR-0003: 不开 synchronize, schema 只走 migration).
    TypeOrmModule.forFeature([EvalReportEntity]),
  ],
  providers: [
    EvalService,
    // 窄端口绑定: 入口层注入的是**接口** token, 实现就在本模块.
    { provide: EVAL_REPORT_REPOSITORY, useClass: TypeOrmEvalReportRepository },
  ],
  exports: [EvalService, EVAL_REPORT_REPOSITORY],
})
export class EvalModule {}
