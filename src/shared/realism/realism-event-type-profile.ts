// V2026-11-23 建立 (AF-338 · 真人度事件类型归因):
//   职责: 把六类文本不流畅事件的计数折算成每轮频次与类型占比, 用于回答"哪类事件在放大密度".
//   边界: 纯函数, 零 IO / 零随机 / 零文本; 不修改 humanization-v1 阈值, 不替代人工判读.

export const EVENT_TYPE_IDS = ['filler', 'pause', 'repetition', 'repair', 'trailoff', 'elongation'] as const;

export type EventTypeId = (typeof EVENT_TYPE_IDS)[number];

export type EventTypeCounts = Readonly<Record<EventTypeId, number>>;

export interface EventTypeSample {
  readonly persona: string;
  readonly arm: string;
  readonly turns: number;
  readonly counts: Partial<Record<EventTypeId, number>>;
}

export interface EventTypeShare {
  readonly count: number;
  readonly perTurn: number | null;
  readonly share: number | null;
}

export interface EventTypeProfile {
  readonly persona: string;
  readonly arm: string;
  readonly turns: number;
  readonly totalEvents: number;
  readonly eventsPerTurn: number | null;
  readonly byType: Readonly<Record<EventTypeId, EventTypeShare>>;
  readonly repairPerTurn: number | null;
}

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function finiteTurns(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function perTurnOf(count: number, turns: number): number | null {
  return turns > 0 ? count / turns : null;
}

/**
 * 汇总一组事件类型样本, 按 persona + arm 分组输出频次与占比.
 *
 * 规则:
 * - 缺失 / 非有限 / 负数计数按 0 处理;
 * - turns 非有限或 <=0 时, perTurn 与 share 均为 null, 但计数仍保留;
 * - share 的分母是组内六类事件总数, 不是密度; 总为 0 时 share 为 null;
 * - 输出按 persona、arm 字典序稳定排序; 不修改输入数组.
 *
 * @param samples 样本列表
 * @returns 每个 persona + arm 一条剖面; 空输入返回空数组
 */
export function aggregateEventTypeProfiles(samples: readonly EventTypeSample[]): EventTypeProfile[] {
  const groups = new Map<string, { persona: string; arm: string; turns: number; counts: Record<EventTypeId, number> }>();

  for (const sample of samples) {
    const persona = typeof sample.persona === 'string' && sample.persona.trim().length > 0 ? sample.persona.trim() : 'unknown';
    const arm = typeof sample.arm === 'string' && sample.arm.trim().length > 0 ? sample.arm.trim() : 'unknown';
    const key = `${persona}\u0000${arm}`;
    const group = groups.get(key) ?? {
      persona,
      arm,
      turns: 0,
      counts: Object.fromEntries(EVENT_TYPE_IDS.map((id) => [id, 0])) as Record<EventTypeId, number>,
    };
    group.turns += finiteTurns(sample.turns);
    for (const id of EVENT_TYPE_IDS) {
      group.counts[id] += finiteNonNegative(sample.counts[id]);
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .toSorted((left, right) => left.persona.localeCompare(right.persona) || left.arm.localeCompare(right.arm))
    .map((group) => {
      const totalEvents = EVENT_TYPE_IDS.reduce((sum, id) => sum + group.counts[id], 0);
      const byType = Object.fromEntries(
        EVENT_TYPE_IDS.map((id) => [
          id,
          {
            count: group.counts[id],
            perTurn: perTurnOf(group.counts[id], group.turns),
            share: totalEvents > 0 ? group.counts[id] / totalEvents : null,
          },
        ]),
      ) as Record<EventTypeId, EventTypeShare>;
      return {
        persona: group.persona,
        arm: group.arm,
        turns: group.turns,
        totalEvents,
        eventsPerTurn: perTurnOf(totalEvents, group.turns),
        byType,
        repairPerTurn: byType.repair.perTurn,
      };
    });
}

/**
 * 返回某组剖面里每轮频次最高的类型; 全部为 0 或轮次无效时返回 null.
 *
 * @param profile 单组剖面
 * @returns 最高频类型 id 与每轮频次
 */
export function dominantEventType(profile: EventTypeProfile): { id: EventTypeId; perTurn: number } | null {
  let winner: { id: EventTypeId; perTurn: number } | null = null;
  for (const id of EVENT_TYPE_IDS) {
    const perTurn = profile.byType[id].perTurn;
    if (perTurn === null || perTurn <= 0) continue;
    if (winner === null || perTurn > winner.perTurn) winner = { id, perTurn };
  }
  return winner;
}
