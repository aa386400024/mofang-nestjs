// V2026-11-15 治本 (TD-20 · C2 第四批仓储端口化 · home 域 · P-DEBT-11 / L-1):
//   抽象: `HomeMoodLogService` 不再注入 typeorm 的泛型仓储对象, 只依赖本端口
//     interface + `MOOD_LOG_REPOSITORY` DI token —— TypeORM 实现收进
//     `data/mood-log.repository.typeorm.ts`, 实体工厂 / 保存 / 两个时间窗查询 /
//     物理删除的口径全封在实现里, service 只看到业务语义的方法.
//
//   模板先例: `src/emergency/domain/repositories/emergency-session.repository.ts`
//     (TD-19 · 单端口 + Row 出参) + `src/life-map/domain/repositories/`
//     (TD-16 · 同域多端口按实体划分) + `src/consent/domain/repositories/consent.repository.ts`
//     (TD-17 · 最小单端口, 工厂在实现层) +
//     `src/good_state_diary/domain/repositories/diary-entry.repository.ts` (TD-18) +
//     `src/analytics/domain/repositories/` (TD-13).
//
//   端口划分粒度 (TD-20 判定): **按实体分端口** —— 打卡表与消息表口径完全不同
//     (写入 + 两个时间窗查询 + 物理删除 vs 计数 + 标记), 合一会让两套口径互相污染.
//
//   关键方法 (方法面只收 service 现有的 5 处调用, 不泛化成通用代理):
//     - create(input): 写入一条打卡 (实体工厂 + 保存下沉实现层)
//     - findLatestSince(uid, since): 窗口内最新一条 (created_at 倒序取一条)
//     - findRecentSince(uid, since): 窗口内全部 (created_at 正序)
//     - deleteByUser(uid): 按用户物理删除, 返回删除条数
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 —— 那等于把 typeorm 的 API 面原样漏给业务层
//     - 不暴露 typeorm 的管理句柄 / 查询选项 / 操作符 —— 只允许出现在实现文件内
//     - 不暴露 entity 类 —— 出参用 Row 领域类型, 业务层不碰实体
//     - **真删无软删**: 打卡表物理删除, Row 不含任何软删列 (对齐 life-map / emergency 口径)
//
//   **日期口径留 service**: 「今天 0 点」与「近 N 天起点」是业务日期口径 (本地时区),
//     留在 service 计算; 端口只收一个 `since` 下界 —— 避免把时区规则漏进仓储层.
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service
//        (test/home/td20-home-messages-moodlog-port-c2-batch4.spec.ts),
//        不起真 TypeORM / 不连 DB / 不 vi.mock('typeorm')
//     2. grep 复核: 端口 / service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-15 GMT+8

import type { HomeEmotionLevel } from '../../home.constants.js';

/**
 * 情绪打卡行 —— 端口出参 (窄领域类型, 不含 entity 类).
 *
 * V2026-11-15 治本 (TD-20): **不含任何软删列** —— 打卡表真删 (用户主动删除不保留),
 *   没有软删 / 恢复 / 擦除路径 (对齐 life-map / emergency 口径, 区别于 TD-18 diary).
 */
export interface MoodLogRow {
  id: string;
  uid: string;
  /** 4 档情绪档位 —— 纯类型 (constants 的 as const 派生 type), 非 typeorm 值符号. */
  level: HomeEmotionLevel;
  note: string | null;
  triggeredMicroInterventionId: string | null;
  createdAt: Date;
}

/**
 * 打卡写入入参 —— 行由 service 以纯对象构造 (不依赖仓储工厂方法).
 */
export interface NewMoodLogInput {
  uid: string;
  level: HomeEmotionLevel;
  note: string | null;
  triggeredMicroInterventionId: string | null;
}

/**
 * 情绪打卡仓储契约 —— home 域打卡存储的唯一真相源.
 *
 * 唯一调用方: `HomeMoodLogService` (providers/home-mood-log.service.ts).
 */
export interface MoodLogRepository {
  /**
   * 写入一条打卡.
   *
   * @param input 写入入参 (纯对象)
   * @returns 落库后的行
   */
  create(input: NewMoodLogInput): Promise<MoodLogRow>;

  /**
   * 取窗口内最新一条 (created_at 倒序).
   *
   * @param uid 用户 id
   * @param since 窗口起点 (created_at 下界) —— 起点计算留 service
   * @returns 行 (未命中返 null)
   */
  findLatestSince(uid: string, since: Date): Promise<MoodLogRow | null>;

  /**
   * 取窗口内全部 (created_at 正序).
   *
   * @param uid 用户 id
   * @param since 窗口起点 (created_at 下界) —— 起点计算留 service
   * @returns 行列表
   */
  findRecentSince(uid: string, since: Date): Promise<MoodLogRow[]>;

  /**
   * 按用户物理删除全部打卡.
   *
   * @param uid 用户 id
   * @returns 删除条数
   */
  deleteByUser(uid: string): Promise<number>;
}

/** DI token —— NestJS 注入用. */
export const MOOD_LOG_REPOSITORY = Symbol('MOOD_LOG_REPOSITORY');
