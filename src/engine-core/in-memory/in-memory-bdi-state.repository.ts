// V2026-10-28 治本 (WP0 · 引擎内核 · BDI 状态内存仓储):
//   职责: BdiStateRepository 的进程内实现. 供内核单测 / 本地跑通 / 未来无 DB 场景使用.
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 不含任何 NestJS 装饰器.
//
//   与仓库既有内存仓储 (src/agent/persona/data/persona.repository.memory.ts) 的**不同**:
//     那些实现带 @Injectable() 以便被 Nest 注入; 本实现**刻意不带** —— 内核
//     不在 Nest 容器里, 带装饰器就等于把框架依赖引进内核. adapter 需要时自行 new 或包装.
//
//   反双胞胎:
//     - 不返回内部对象引用 —— 存取两侧都做防御性拷贝, 否则消费方就地改字段会
//       静默污染已存状态 (这类 bug 只在"存了 A、读出来被改成 B"时显形, 极难查).
//     - 不在 save 里静默覆盖旧 revision —— 违反乐观锁就抛 STATE_CONFLICT.
//       静默覆盖 = 并发写丢数据且无痕迹, 是最难事后追溯的一类故障.
//     - 不加 TTL —— 状态是会话级持久物, 生命周期由会话管理, 不是缓存; 缓存语义
//       属于记忆仓储 (那边有遗忘 / 衰减机制).
//     - 不提供 delete —— 端口没定义, 实现不擅自扩大契约.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/engine-core.spec.ts 覆盖: 存取往返 / 防御性拷贝 / revision 冲突 / 参数校验

import { cloneBdiSnapshot } from '../domain/bdi-snapshot';
import { EngineCoreError, EngineErrorCode } from '../domain/engine-errors';
import type { BdiStateRecord, BdiStateRepository } from '../domain/ports/bdi-state.repository';

/** 状态内存仓储. */
export class InMemoryBdiStateRepository implements BdiStateRepository {
  /** 复合键 (租户 + 会话) → 状态记录. */
  private readonly records = new Map<string, BdiStateRecord>();

  async load(tenantId: string, sessionId: string): Promise<BdiStateRecord | null> {
    const record = this.records.get(this.buildKey(tenantId, sessionId));
    return record ? this.toDetachedCopy(record) : null;
  }

  async save(record: BdiStateRecord): Promise<BdiStateRecord> {
    if (!record.tenantId) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryBdiStateRepository.save: tenantId 不能为空');
    }
    if (!record.sessionId) {
      throw new EngineCoreError(EngineErrorCode.INVALID_INPUT, 'InMemoryBdiStateRepository.save: sessionId 不能为空');
    }
    if (!Number.isInteger(record.revision) || record.revision < 1) {
      throw new EngineCoreError(
        EngineErrorCode.INVALID_INPUT,
        `InMemoryBdiStateRepository.save: revision 必须是 >= 1 的整数, 收到 ${record.revision}`,
        {
          tenantId: record.tenantId,
          sessionId: record.sessionId,
          revision: record.revision,
        },
      );
    }

    const key = this.buildKey(record.tenantId, record.sessionId);
    const existing = this.records.get(key);
    if (existing && record.revision <= existing.revision) {
      // 乐观锁冲突: 后写者不能静默覆盖先写者.
      throw new EngineCoreError(
        EngineErrorCode.STATE_CONFLICT,
        `InMemoryBdiStateRepository.save: revision 不单调递增 (incoming=${record.revision}, stored=${existing.revision})`,
        {
          tenantId: record.tenantId,
          sessionId: record.sessionId,
          incomingRevision: record.revision,
          storedRevision: existing.revision,
        },
      );
    }

    const stored = this.toDetachedCopy(record);
    this.records.set(key, stored);
    return this.toDetachedCopy(stored);
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 复合键: 租户 + 会话.
   *
   * 用 `::` 作分隔符并对 id 做长度前缀, 避免 (tenant="a::b", session="c") 与
   * (tenant="a", session="b::c") 撞键 —— 这类键拼接事故在多租户下是数据串号.
   */
  private buildKey(tenantId: string, sessionId: string): string {
    return `${tenantId.length}:${tenantId}::${sessionId.length}:${sessionId}`;
  }

  /**
   * 防御性拷贝 —— 内部存一份、对外给一份.
   * 快照走 cloneBdiSnapshot (数组浅拷贝), 保证数组引用不共享.
   */
  private toDetachedCopy(record: BdiStateRecord): BdiStateRecord {
    return {
      tenantId: record.tenantId,
      sessionId: record.sessionId,
      revision: record.revision,
      updatedAt: record.updatedAt,
      snapshot: cloneBdiSnapshot(record.snapshot),
    };
  }
}
