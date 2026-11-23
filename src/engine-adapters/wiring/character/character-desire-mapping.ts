// AF-357 · 角色愿望键 → 内核四键的显式映射:
//   职责: 把 8 个真实角色与 2 个内置种子的角色级愿望键, 显式映射到内核意图规划器实际读取的
//         understood / accepted / avoid_pain / control 四键.
//   边界: 纯数据 + 纯函数, 零 IO / 零随机 / 零 env / 零 @nestjs.
//
//   为什么需要:
//     AF-354 审计证明 8 个角色里 7 个与内核四键完全无交集, 意图规划器对它们的
//     `underlyingDesires.find(key === 'understood' | ...)` 全部得到 undefined ?? 0,
//     于是 discussing_plans / 部分探索分支在真实角色上不可达.
//
//   映射纪律:
//     · 一个角色级愿望只映射到一个主内核键 —— 不把一个诉求拆成多份权重, 避免凭空抬高决策信号.
//     · 多个角色级愿望落到同一内核键时取**最大**基线权重, 不求和.
//     · 未登记的角色键**原样保留**, 不静默丢弃, 也不猜测一个内核键; 审计会把它标成 unmapped.
//     · 映射是幂等的: 已经是内核四键的条目原样直通.
//     · 只改键, 不改数值; 角色原始基线权重是唯一真相源.

import type { UnderlyingDesireSeed } from '../../../engine-core/index.js';

/** 内核意图规划器实际读取的四个底层愿望键. */
export const CORE_DESIRE_KEYS = ['understood', 'accepted', 'avoid_pain', 'control'] as const;

/** 内核四键. */
export type CoreDesireKey = (typeof CORE_DESIRE_KEYS)[number];

/**
 * 角色级愿望键 → 内核四键.
 *
 * ⚠️ 语义映射是**工程种子**, 不是临床标定:
 *   · 映射依据是愿望标签的临床语义 (被看见 / 被接纳 / 免于痛苦 / 自主掌控), 不是数值;
 *   · 真实咨询师逐轮标注后, 可能需要把某个角色级愿望改判到另一个内核键;
 *   · 这张表是唯一真相源 —— 角色种子、DB 解析、审计都读它, 不各自写一份.
 */
export const ROLE_DESIRE_TO_CORE: Readonly<Record<string, CoreDesireKey>> = {
  // 被理解 / 被看见
  recognition: 'understood',
  safe_grief: 'understood',
  being_understood: 'understood',
  understood: 'understood',
  // 被接纳 / 归属 / 真实自我被接受
  acceptance: 'accepted',
  authenticity: 'accepted',
  belonging: 'accepted',
  accepted: 'accepted',
  // 安全 / 稳定 / 免于痛苦 / 休息
  stability: 'avoid_pain',
  continuity: 'avoid_pain',
  rest: 'avoid_pain',
  safety: 'avoid_pain',
  security: 'avoid_pain',
  avoid_pain: 'avoid_pain',
  // 自主 / 胜任 / 自我信任 / 掌控
  self_reliability: 'control',
  competence: 'control',
  autonomy: 'control',
  control: 'control',
};

/** 单条映射结果 (审计 / 测试用). */
export interface RoleDesireMappingEntry {
  /** 角色种子里的原始键. */
  readonly originalKey: string;
  /** 映射后的内核键; null = 未登记, 原样保留. */
  readonly coreKey: CoreDesireKey | null;
  /** 原始基线权重. */
  readonly baselineWeight: number;
  /** 最终落在快照里的权重 (同一内核键取最大值). */
  readonly effectiveWeight: number;
}

/** 映射结果 (审计 / 测试用). */
export interface RoleDesireMappingResult {
  /** 映射后的愿望种子; 顺序按内核键首次出现的位置, 未映射键保持原顺序排在后面. */
  readonly desires: readonly UnderlyingDesireSeed[];
  /** 逐条映射明细. */
  readonly entries: readonly RoleDesireMappingEntry[];
  /** 未登记的角色键. */
  readonly unmapped: readonly string[];
}

/**
 * 把一个角色级愿望键解析成内核键.
 *
 * @param key 角色键
 * @returns 内核键; 未登记 → null (调用方原样保留, 不猜测)
 */
export function toCoreDesireKey(key: string): CoreDesireKey | null {
  const normalized = key.trim();
  if (normalized.length === 0) return null;
  return ROLE_DESIRE_TO_CORE[normalized] ?? null;
}

/**
 * 角色愿望种子 → 内核愿望种子 (纯函数, 幂等).
 *
 * @param desires 角色级愿望种子
 * @returns 映射后的愿望种子; 不改数值, 不修改入参
 */
export function mapRoleDesiresToCore(desires: readonly UnderlyingDesireSeed[]): readonly UnderlyingDesireSeed[] {
  return mapRoleDesiresToCoreDetailed(desires).desires;
}

/**
 * 角色愿望种子 → 内核愿望种子 (带映射明细).
 *
 * 合并规则:
 *   · 同一内核键出现多次 → 取最大 baselineWeight, 标签跟着最大权重那条走;
 *     **不求和** —— 两个角色级诉求不会因为都落到 accepted 就把 accepted 抬到 1.0.
 *   · 未登记键 → 原样保留, 排在已映射键之后, 保持原始相对顺序.
 *   · 空 key → 原样保留并计入 unmapped (数据脏了要看得见, 不静默丢弃).
 *
 * @param desires 角色级愿望种子
 * @returns 映射结果
 */
export function mapRoleDesiresToCoreDetailed(desires: readonly UnderlyingDesireSeed[]): RoleDesireMappingResult {
  const merged = new Map<CoreDesireKey, UnderlyingDesireSeed>();
  const passthrough: UnderlyingDesireSeed[] = [];
  const unmapped: string[] = [];
  const candidates: { originalKey: string; coreKey: CoreDesireKey | null; baselineWeight: number }[] = [];

  for (const desire of desires) {
    const coreKey = toCoreDesireKey(desire.key);
    if (coreKey === null) {
      passthrough.push({ ...desire });
      unmapped.push(desire.key);
      candidates.push({ originalKey: desire.key, coreKey: null, baselineWeight: desire.baselineWeight });
      continue;
    }

    const current = merged.get(coreKey);
    if (current) {
      // 同一内核键出现多次: 权重取最大 (不求和), 但来源键与标签全部保留 ——
      //   合并是投影, 不是删除; 督导视图要能看到被合并掉的次级诉求.
      merged.set(coreKey, {
        ...current,
        ...(desire.baselineWeight > current.baselineWeight ? { label: desire.label, baselineWeight: desire.baselineWeight } : {}),
        sourceKeys: [...new Set([...(current.sourceKeys ?? [coreKey]), desire.key])],
        sourceLabels: [...new Set([...(current.sourceLabels ?? [current.label]), desire.label])],
      });
    } else {
      // AF-358 · P1-2: 只有"角色键 ≠ 内核键"时才需要来源字段 —— 直接命中的内核键
      //   本身就是唯一真相, 不额外制造可空字段. 已经带来源的映射结果再映射时必须原样保留 (幂等).
      merged.set(coreKey, {
        key: coreKey,
        label: desire.label,
        baselineWeight: desire.baselineWeight,
        ...provenanceFor(desire, coreKey),
      });
    }
    candidates.push({ originalKey: desire.key, coreKey, baselineWeight: desire.baselineWeight });
  }

  // 同一内核键的 effectiveWeight 统一为最终最大值 (entries 是明细, 需要一致).
  const effectiveByKey = new Map<CoreDesireKey, number>();
  for (const [key, desire] of merged) effectiveByKey.set(key, desire.baselineWeight);

  const entries: RoleDesireMappingEntry[] = candidates.map((candidate) => ({
    ...candidate,
    effectiveWeight:
      candidate.coreKey === null ? candidate.baselineWeight : (effectiveByKey.get(candidate.coreKey) ?? candidate.baselineWeight),
  }));

  return {
    desires: [...merged.values(), ...passthrough],
    entries,
    unmapped,
  };
}

/** 首次映射时的来源字段: 已带来源 → 原样继承 (幂等); 直接命中内核键 → 不造冗余字段. */
function provenanceFor(desire: UnderlyingDesireSeed, coreKey: CoreDesireKey): Pick<UnderlyingDesireSeed, 'sourceKeys' | 'sourceLabels'> {
  if (desire.sourceKeys) {
    return { sourceKeys: [...desire.sourceKeys], sourceLabels: [...(desire.sourceLabels ?? [desire.label])] };
  }
  if (desire.key === coreKey) return {};
  return { sourceKeys: [desire.key], sourceLabels: [desire.label] };
}
