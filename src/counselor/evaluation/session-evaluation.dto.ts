// V2026-11-06 治本 (WP43 · 评估引擎基础版 · 查询入参):
//   职责: "我的评估列表"的分页入参.
//   边界: 只做入参校验 + 归一; 零业务逻辑.
//
//   为什么分页上限锁 100: 评估列表是给学员翻历史用的, 一次拉太多行
//   既慢又没有意义 (一屏本来就只看前几页).
//
//   验证: npx tsc -p tsconfig.build.json --noEmit 0 错
//
//   时间戳: 2026-11-06

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import type { BdiDeltaScores, EthicsScores, RawEvaluationStats, SessionSafetyLabel, TechnicalScores } from './evaluation-engine.js';

/**
 * 评估列表分页入参.
 */
export class SessionEvaluationListQueryDto {
  /**
   * 页码 (从 1 开始).
   */
  @ApiPropertyOptional({ description: '页码 (从 1 开始)', default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  /**
   * 每页条数.
   */
  @ApiPropertyOptional({ description: '每页条数', default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number = 20;
}
/**
 * 单场评估详情 (前端拿到的形状).
 */
export interface SessionEvaluationDetailDto {
  /** 训练会话 id. */
  readonly sessionId: string;
  /** 综合总分 (0-100). */
  readonly overallScore: number;
  /** 技术维度分 (9 维 + 平均). */
  readonly technical: TechnicalScores;
  /** BDI 变化维度分 (4 维 + 平均). */
  readonly bdiDelta: BdiDeltaScores;
  /** 伦理维度分. */
  readonly ethics: EthicsScores;
  /** 原始统计 (供调试与回溯). */
  readonly rawStats: RawEvaluationStats;
  /** 计算时刻 (ISO). */
  readonly createdAt: string;
}

/**
 * 评估列表项 (列表不返全量维度 —— 列表是给人扫一眼的).
 */
export interface SessionEvaluationListItemDto {
  /** 训练会话 id. */
  readonly sessionId: string;
  /** 综合总分 (0-100). */
  readonly overallScore: number;
  /** 安全评级 (safe / warning / danger). */
  readonly safetyLabel: SessionSafetyLabel;
  /** 危机触发次数. */
  readonly crisisCount: number;
  /** 计算时刻 (ISO). */
  readonly createdAt: string;
}

/**
 * 评估列表 (分页).
 */
export interface SessionEvaluationListResultDto {
  /** 当前页数据. */
  readonly items: readonly SessionEvaluationListItemDto[];
  /** 总条数. */
  readonly total: number;
  /** 当前页码. */
  readonly page: number;
  /** 每页条数. */
  readonly pageSize: number;
}
