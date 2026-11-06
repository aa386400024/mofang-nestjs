// V2026-11-06 治本 (WP58 · B 层 · 事件 + delta 审计观测服务):
//   职责: 每轮 turn 结束后**自观测** —— 自己跑一遍内核分类器拿命中词, 聚合出原始
//         delta, fire-and-forget 落库; 并提供按会话读取的查询出口.
//   边界: 只做观测; 不改内核状态、不改内核出参、不参与任何决策.
//
//   为什么是"adapter 层自观测"而不是改内核输出:
//     · 内核出参 EngineTurnOutput.events 只有事件**种类**, 不带命中词明细
//       (那是内核内部产物) —— 观测要的恰恰是命中词;
//     · 内核出参没有 raw / modulated / capped 的中间 delta 向量;
//     · 改内核出参 = 改公开契约 = 影响面大; 自观测 = 零侵入、可开关、可回退.
//     代价: 本服务自己跑一遍分类器 —— 所以**必须**复用内核那一份 (RuleBasedClassifier),
//     绝不能另写一套 (另写一套 = 与内核真值漂移, 记下来的 delta 对不上实际).
//
//   为什么写库失败静默:
//     观测通道是**增强**, 不是主链路依赖 —— 写库失败不该让整轮 turn 失败.
//     与仓库里 notifyDeltaCap / DeltaCapLogger 同一纪律 ("观测通道失败不影响状态迁移").
//
//   隐私纪律 (本单硬要求):
//     · 不落咨询师原话 (只有命中词);
//     · 不落完整 BDI 快照 (只有 11 维 delta);
//     · 心理内容不进日志 —— 日志只出定位信息 (sessionId / turnIndex / 失败原因).
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp58-turn-delta-audit.spec.ts 覆盖开关 / 事件 / delta / 失败静默

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { resolveTurnDeltaAuditConfig } from './turn-delta-audit.config.js';
import { TurnDeltaAuditEntity } from './turn-delta-audit.entity.js';
import type { TurnDeltaAuditInput, TurnDeltaAuditPort, TurnDeltaAuditTurnView } from './turn-delta-audit.port.js';
import {
  RuleBasedClassifier,
  aggregateTurnDelta,
  type AllianceConfig,
  type CounselorEventKind,
  type SessionEvent,
} from '../../../engine-core/index.js';
import { resolveAllianceConfig } from '../alliance-config.js';

/**
 * 把错误压成一行可读文本 (日志用).
 *
 * @param error 未知错误
 * @returns 错误描述
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 把内核报告、但本地分类器看不到的事件补进来.
 *
 * 为什么需要补: 内核分类时带了**角色的敏感议题词表** (sensitiveTopics), 适配层
 * 观测时拿不到 (TurnSessionContext 里没有这个字段) —— 于是内核认得的
 * sensitive_touch 在本地分类里不会出现. 不补 = 记下来的 raw_delta 与内核实际
 * 施加的 delta 对不上 (少了一维的贡献), 观测就失去了"这一轮改了多少分"的意义.
 *
 * 怎么补: 按内核给的**类型**补一条 strength=1 的事件, matchedTerms 留空
 * (命中词拿不到 —— 本期 sensitive_touch 只记类型不记词).
 *
 * ⚠️ 只有 sensitive_touch 会这样: 静态词典事件本地分类与内核**逐字同源**
 *   (同一个分类器 + 同一段文本), 不会漂移.
 *
 * @param events 本地分类器给出的事件
 * @param kernelEventKinds 内核本轮判出的事件种类
 * @returns 合并后的事件 (供 delta 聚合)
 */
function mergeKernelOnlyEvents(events: readonly SessionEvent[], kernelEventKinds: readonly CounselorEventKind[]): readonly SessionEvent[] {
  const missing = kernelEventKinds.filter((kind) => kind !== 'neutral' && !events.some((event) => event.kind === kind));
  if (missing.length === 0) return events;
  return [...events, ...missing.map((kind) => ({ kind, matchedTerms: [], strength: 1 }))];
}

/**
 * 事件 + delta 审计观测服务.
 */
@Injectable()
export class TurnDeltaAuditService implements TurnDeltaAuditPort {
  private readonly logger = new Logger(TurnDeltaAuditService.name);
  /** 内核那份规则分类器 (纯函数, 无状态 —— 复用即可, 不自己实现一套). */
  private readonly classifier = new RuleBasedClassifier();
  /** 观测通道开关 (装配期解析一次 —— 开关是部署级配置, 不是每轮配置). */
  private readonly enabled: boolean;
  /** 同盟三维系数 (与内核会话同一份 env 口径 —— 聚合口径要和内核一致). */
  private readonly alliance: AllianceConfig;

  /**
   * @param repo 审计表仓储
   * @param config 配置服务 (读 env 开关 + 同盟系数)
   */
  constructor(
    @InjectRepository(TurnDeltaAuditEntity)
    private readonly repo: Repository<TurnDeltaAuditEntity>,
    config: ConfigService,
  ) {
    this.enabled = resolveTurnDeltaAuditConfig(config).enabled;
    this.alliance = resolveAllianceConfig(config);
  }

  /**
   * 记录一轮的事件 + delta (fire-and-forget).
   *
   * 开关关着时**立刻返回** —— 连分类器都不跑 (零开销).
   * 写库失败只打一条 debug 日志, 不抛错、不重试、不告警.
   *
   * @param input 本轮观测输入
   */
  record(input: TurnDeltaAuditInput): void {
    if (!this.enabled) return;
    void this.persist(input).catch((error: unknown) => {
      this.logger.debug('[WP58] delta 审计落库失败 session=' + input.sessionId + ' turn=' + input.turnIndex + ': ' + describeError(error));
    });
  }

  /**
   * 按会话读出每一轮的审计 (admin 读端点).
   *
   * @param sessionId 业务会话 id
   * @returns 按轮次升序的审计视图 (无数据 = 空数组)
   */
  async listTurns(sessionId: string): Promise<TurnDeltaAuditTurnView[]> {
    const rows = await this.repo.find({ where: { sessionId }, order: { turnIndex: 'ASC' } });
    return rows.map((row) => ({
      turnIndex: row.turnIndex,
      eventKinds: [...(row.eventKinds ?? [])],
      eventDetails: (row.eventDetails ?? []).map((detail) => ({
        kind: detail.kind,
        matchedTerms: [...(detail.matchedTerms ?? [])],
        strength: detail.strength,
      })),
      rawDelta: { ...row.rawDelta },
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * 落库一行 (幂等: 同 (租户, 会话, 轮次) 覆盖同一行).
   *
   * 为什么用"查 → 改/建 → save"而不是 upsert:
   *     typeorm 1.x 的 repo.upsert / insert 在 **json 列**上会丢字段
   *     (extractUpsertSet 严格按 metadata, json/enum 取不到值 → 报
   *     ER_NO_DEFAULT_FOR_FIELD). 本表三列都是 json, 所以走
   *     create + save 这条仓库既有路径 (与督导报告仓储同款).
   *
   * @param input 本轮观测输入
   */
  private async persist(input: TurnDeltaAuditInput): Promise<void> {
    const events = this.classifier.classify(input.userText);
    const merged = mergeKernelOnlyEvents(events, input.kernelEventKinds);
    const rawDelta = aggregateTurnDelta(merged, this.alliance);
    const existing = await this.repo.findOne({
      where: { tenantId: input.tenantId, sessionId: input.sessionId, turnIndex: input.turnIndex },
    });
    const entity = existing ?? this.repo.create({ tenantId: input.tenantId, sessionId: input.sessionId, turnIndex: input.turnIndex });
    entity.eventKinds = [...new Set(merged.map((event) => event.kind))];
    entity.eventDetails = merged.map((event) => ({
      kind: event.kind,
      matchedTerms: [...event.matchedTerms],
      strength: event.strength,
    }));
    entity.rawDelta = { ...rawDelta };
    await this.repo.save(entity);
  }
}
