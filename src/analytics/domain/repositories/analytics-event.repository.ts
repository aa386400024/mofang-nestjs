// V2026-11-14 治本 (TD-13 · L-1b 仓储端口抽象试点 · analytics 域):
//   抽象: analytics 两个 service 只依赖 `AnalyticsEventRepository` 接口 +
//     `ANALYTICS_EVENT_REPOSITORY` DI token, 不再直接注入 typeorm 的
//     泛型仓储对象 —— TypeORM 实现收进
//     `data/analytics-event.repository.typeorm.ts`, 查询口径 (tenantId 隔离 +
//     eventType 过滤 + 时间窗) 全部封在实现里, service 只看到业务语义的方法.
//   模板先例: `src/agent/supervisor/domain/repositories/supervision-report.repository.ts`
//     (interface + Symbol token), 本文件逐字对齐其结构与注释风格.
//
//   关键方法 (方法面只收现有两个 service 实际用到的三条调用, 不泛化成通用代理):
//     - record(input): 写一行事件 (tracker 用)
//     - countByType(tenantId, eventType, start, end): KPI 计数 (KPI 1 分子 / KPI 2 分母共用)
//     - findCreatedAtBetween(tenantId, eventType, start, end): trend 分桶用的 createdAt 序列
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 —— 那等于把 typeorm 的 API 面原样漏给业务层,
//       端口会退化成"换个名字的仓储代理"; 方法按业务面命名, 面窄才守得住
//     - 不暴露 typeorm 的管理句柄 / 查询选项 / 区间操作符 —— 这些是 typeorm 值符号,
//       只允许出现在 TypeORM 实现文件内
//     - 不写 SQL —— 端口只说"要什么", 怎么说由实现决定
//     - 不暴露 entity 类 —— 出参用领域类型 (createdAt 用 Date), 业务层不碰实体
//
//   如何验证:
//     1. 单元测试用端口替身驱动两个 service (test/analytics/td13-analytics-repository-port.spec.ts),
//        不起真 TypeORM / 不连 DB / 不 vi.mock('typeorm')
//     2. grep 复核: 端口 / 两个 service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-14 GMT+8

import type { AnalyticsEventType } from '../../entities/analytics-event.entity.js';

/**
 * 写一行业务事件的入参 —— 5 个业务字段.
 *
 * 不含 `id` / `createdAt`: 前者由 DB 生成, 后者是 `CreateDateColumn`, 插入时由
 * TypeORM 填. 业务层只负责"发生了这件事 + 上下文", 不负责落库细节.
 */
export interface AnalyticsEventRecordInput {
  /** 租户 id (强隔离, 必填). */
  tenantId: string;
  /** 事件类型 (KPI 1-4 的计数口径). */
  eventType: AnalyticsEventType;
  /** 关联业务 item id (可为 null: 系统级事件). */
  itemId: string | null;
  /** 触发者 user id (可为 null: 定时任务触发). */
  userId: string | null;
  /** 上下文透传 (可为 null). */
  metadata: Record<string, unknown> | null;
}

/** 仓储接口契约 —— analytics 域事件存储的唯一真相源. */
export interface AnalyticsEventRepository {
  /**
   * 写一行业务事件.
   *
   * 失败语义由**调用方**决定 (tracker 静默 catch + warn, 不 throw) —— 端口不吞异常,
   * 也不自己 log, 避免"仓储失败"与"业务失败"两件事混在一处.
   *
   * @param input 5 个业务字段
   */
  record(input: AnalyticsEventRecordInput): Promise<void>;

  /**
   * 按租户 + 事件类型 + 时间窗计数 (KPI 1 分子 / KPI 2 分母共用).
   *
   * @param tenantId 租户隔离
   * @param eventType 事件类型
   * @param start 时间窗起点 (含)
   * @param end 时间窗终点 (含)
   * @returns 命中条数 (无命中返 0)
   */
  countByType(tenantId: string, eventType: AnalyticsEventType, start: Date, end: Date): Promise<number>;

  /**
   * 取时间窗内该租户该类型事件的 `createdAt` 序列 (trend 分桶的数据源).
   *
   * 只出 `createdAt` 一个字段 —— 分桶只需要时间戳, 别的字段 (metadata 等) 不该进内存.
   *
   * @param tenantId 租户隔离
   * @param eventType 事件类型
   * @param start 时间窗起点 (含)
   * @param end 时间窗终点 (含)
   * @returns createdAt 序列 (无命中返空数组)
   */
  findCreatedAtBetween(tenantId: string, eventType: AnalyticsEventType, start: Date, end: Date): Promise<readonly Date[]>;
}

/** DI token —— NestJS 注入用. */
export const ANALYTICS_EVENT_REPOSITORY = Symbol('ANALYTICS_EVENT_REPOSITORY');
