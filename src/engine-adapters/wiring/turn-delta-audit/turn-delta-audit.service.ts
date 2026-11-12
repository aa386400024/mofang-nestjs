// V2026-11-06 治本 (WP58 · B 层 · 事件 + delta 审计观测服务):
//   职责: 每轮 turn 结束后**自观测** —— 消费内核本轮判出的事件, 聚合出原始
//         delta, fire-and-forget 落库; 并提供按会话读取的查询出口.
//   边界: 只做观测; 不改内核状态、不改内核出参、不参与任何决策.
//
//   V2026-11-12 治本 (D-1 第二段 · C3 · **审计停止自行分类**):
//     旧口径: 本服务自己跑一遍规则分类器, 再与内核事件取**并集**.
//     那条并集的前提是「本地规则轨与内核**逐字同源**」 —— 模型轨上线后这条前提
//     **直接失效** (本地 = 规则轨, 内核 = 模型轨) → 并集 = 两套标签的并集 →
//     记下来的 raw_delta 既不等于内核实际施加的 delta, 又比内核**多算一截**
//     (风险 N · 审计 delta 失真 —— 观测结论不可用).
//     新口径: **事件集合只认内核** —— 内核判了什么, 审计就记什么. 审计层不再持有
//     任何分类器 (少一份可能漂移的真相源).
//
//   ⚠️ **matchedTerms 归零的已知代价** (写进交付记录, 不静默):
//     内核出参 EngineTurnOutput.events 只带事件**种类**, 不带命中词明细
//     (那是内核内部产物). 审计要拿到命中词就得再跑一遍分类器 —— 那正是 C3 去掉的动作.
//     本单选「不造命中词」: 只记内核给出的事实, 不给模型轨判出的事件硬安词表证据.
//     要恢复命中词明细, 需扩内核出参 (第 3 个 core 文件) —— 属 D-2 或单开例外.
//
//   为什么写库失败静默:
//     观测通道是**增强**, 不是主链路依赖 —— 写库失败不该让整轮 turn 失败.
//     与仓库里 notifyDeltaCap / DeltaCapLogger 同一纪律 ("观测通道失败不影响状态迁移").
//
//   隐私纪律 (本单硬要求):
//     · **不落咨询师原话** (V2026-11-12 C3 起连原话都不再进这一层 —— 审计只吃内核事件);
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
  aggregateTurnDelta,
  type AllianceConfig,
  type CounselorEventKind,
  type DeltaTableConfig,
  type SessionEvent,
} from '../../../engine-core/index.js';
import { resolveAllianceConfig } from '../alliance-config.js';
import { resolveDeltaTableConfig } from '../delta-table.config.js';

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
 * 把内核判出的事件种类转成本次审计的事件明细.
 *
 * V2026-11-12 治本 (D-1 第二段 · C3): 旧口径是「本地再跑一遍规则分类器 → 与内核
 * 事件取并集」. 那条并集的前提是「本地规则轨与内核**逐字同源**」; 模型轨上线后
 * 这条前提**直接失效** (本地 = 规则轨, 内核 = 模型轨) → 并集 = 两套标签的并集 →
 * 记下来的 raw_delta 既不等于内核实际施加的 delta, 又比内核**多算一截** (风险 N).
 * 新口径: **事件集合只认内核** —— 内核判了什么, 审计就记什么.
 *
 * ⚠️ **matchedTerms 归零是已知代价** (交付记录已写明):
 *   内核出参只带事件**种类**, 不带命中词明细. 审计要拿到命中词就得再跑一遍分类器 ——
 *   那正是 C3 去掉的动作. 本单选「不造命中词」: 只记内核给出的事实.
 *
 * @param kernelEventKinds 内核本轮判出的事件种类
 * @returns 事件明细 (strength 恒 1 —— 规则轨与模型轨首版都是 1)
 */
function kernelEventsToSessionEvents(kernelEventKinds: readonly CounselorEventKind[]): readonly SessionEvent[] {
  if (kernelEventKinds.length === 0) return [];
  return kernelEventKinds.map((kind) => ({ kind, matchedTerms: [], strength: 1 }));
}

/**
 * 事件 + delta 审计观测服务.
 */
@Injectable()
export class TurnDeltaAuditService implements TurnDeltaAuditPort {
  private readonly logger = new Logger(TurnDeltaAuditService.name);
  /** 观测通道开关 (装配期解析一次 —— 开关是部署级配置, 不是每轮配置). */
  private readonly enabled: boolean;
  /** 同盟三维系数 (与内核会话同一份 env 口径 —— 聚合口径要和内核一致). */
  private readonly alliance: AllianceConfig;
  /**
   * delta 规则表系数 (WP60 · 与内核会话同一份 env 口径).
   *
   * ⚠️ 必须注入: 观测记的 raw_delta 若与内核实际施加的**对不上**, 那记的就是骗人的数
   *   (WP58 交付记录 D3 的同款纪律 —— 覆写改的是系数, 不是聚合逻辑).
   */
  private readonly deltaTable: DeltaTableConfig;

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
    this.deltaTable = resolveDeltaTableConfig(config);
  }

  /**
   * 记录一轮的事件 + delta (fire-and-forget).
   *
   * 开关关着时**立刻返回** —— 连仓储都不碰 (零开销).
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
    // C3: 事件集合**只认内核** —— 不再本地跑分类器, 不再与内核取并集.
    const merged = kernelEventsToSessionEvents(input.kernelEventKinds);
    const rawDelta = aggregateTurnDelta(merged, this.alliance, this.deltaTable);
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
