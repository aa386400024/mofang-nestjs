// V2026-11-14 治本 (TD-16 · C1 试点域仓储端口化 · life-map 域 · P-DEBT-11 / L-1):
//   抽象: `LifeMapService` 不再注入 typeorm 的泛型仓储对象, 只依赖本端口
//     interface + `LIFE_STAGE_PROGRESS_REPOSITORY` DI token —— TypeORM 实现收进
//     `data/life-stage-progress.repository.typeorm.ts`, 查询口径 (userId 隔离 +
//     软删过滤 + 命中则更新未命中则插入) 全部封在实现里, service 只看到业务语义的方法.
//
//   模板先例: `src/analytics/domain/repositories/analytics-event.repository.ts`
//     (TD-13 首个业务域落地) + `src/agent/supervisor/domain/repositories/
//     supervision-report.repository.ts` (Row 形态), 本文件逐字对齐其结构与注释风格.
//
//   端口划分粒度 (TD-16 判定): **按实体分端口** —— V3.0 三张表各一个端口,
//     V6.0 漂流瓶独立一个端口 (本域共 4 个). 理由见交付记录 §二.
//
//   关键方法 (方法面只收 service 现有的 4 处调用, 不泛化成通用代理):
//     - listActiveByUser(userId): 该用户全部**未软删**的阶段完成度行 (loadAllStages 用)
//     - saveProgress(input): 阶段完成度写入 —— 命中 (userId + stage) 则更新,
//       未命中则插入 (saveStageProgress 用)
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 —— 那等于把 typeorm 的 API 面原样漏给业务层,
//       端口会退化成"换个名字的仓储代理"; 方法按业务面命名, 面窄才守得住
//     - 不暴露 typeorm 的管理句柄 / 查询选项 / 区间操作符 —— 这些是 typeorm 值符号,
//       只允许出现在 TypeORM 实现文件内
//     - 不写 SQL —— 端口只说"要什么", 怎么说由实现决定
//     - 不暴露 entity 类 —— 出参用 Row 领域类型, 业务层不碰实体
//     - 不给"命中则更新、未命中则插入"留 find + insert + save 三个口子 —— 那是
//       持久化语义 (有唯一索引兜底), 合成一个 upsert 方法, 面更窄
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service (test/life-map/td16-life-map-port-pilot.spec.ts),
//        不起真 TypeORM / 不连 DB / 不 vi.mock('typeorm')
//     2. grep 复核: 端口 / 两个 service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-14 GMT+8

import type { LifeStage } from '../../../shared/types/practice.types.js';

/**
 * 阶段完成度行 —— 端口出参 (窄领域类型, 不含 entity 类).
 *
 * 不含 `deletedAt`: 列表口径已过滤软删, 该字段对业务层无用, 不进 Row.
 */
export interface LifeStageProgressRow {
  id: string;
  userId: string;
  stage: LifeStage;
  /** 任务完成度 0-100, null 表示尚未填写. */
  completionPct: number | null;
  stuckPoints: string | null;
  gains: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 阶段完成度写入入参 (4 个业务字段).
 *
 * `stuckPoints` / `gains` 缺省 undefined = 命中已有行时**保留原值**
 * (与改前 `dto.stuckPoints ?? entity.stuckPoints ?? null` 的口径逐字一致).
 */
export interface SaveStageProgressInput {
  userId: string;
  stage: LifeStage;
  completionPct: number;
  stuckPoints?: string | null;
  gains?: string | null;
}

/** 仓储接口契约 —— life-map 域阶段完成度存储的唯一真相源. */
export interface LifeStageProgressRepository {
  /**
   * 该用户全部**未软删**的阶段完成度行.
   *
   * @param userId 用户隔离 (强隔离, 必填)
   * @returns 行数组 (无命中返空数组)
   */
  listActiveByUser(userId: string): Promise<LifeStageProgressRow[]>;

  /**
   * 写阶段完成度 —— 命中 (userId + stage) 则更新, 未命中则插入.
   *
   * @param input 4 个业务字段
   * @returns 落库后的行
   */
  saveProgress(input: SaveStageProgressInput): Promise<LifeStageProgressRow>;
}

/** DI token —— NestJS 注入用. */
export const LIFE_STAGE_PROGRESS_REPOSITORY = Symbol('LIFE_STAGE_PROGRESS_REPOSITORY');
