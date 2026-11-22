// V2026-11-23 建立 (AF-333 · 真人度 12 轮长会话基线):
//   职责: 提供短/长两套合成咨询师轮次, 供离线真人度实验选择.
//   边界: 只读常量, 零 IO; 不参与生产 prompt 装配.

import { REALISM_AB_COUNSELOR_TURNS } from './realism-prompt-ab.js';

export const COUNSELOR_TURN_SETS = ['short', 'long'] as const;

export type CounselorTurnSet = (typeof COUNSELOR_TURN_SETS)[number];

/** 12 轮长会话: 前 6 轮与短会话逐字一致, 后 6 轮接续同一话题. */
export const LONG_COUNSELOR_TURNS: readonly string[] = [
  ...REALISM_AB_COUNSELOR_TURNS,
  '现在回头看，那段时间你觉得自己最需要的是什么？',
  '你刚才说到那里的时候，语气好像轻了一点，是我听错了吗？',
  '如果那个需要落成一件很小的事，会是什么？',
  '你愿意下周先试哪一件？',
  '试的时候，你觉得最可能卡住你的是什么？',
  '今天聊到这里，你最想带走的一句话是什么？',
];

/**
 * 按名称取轮次集合.
 *
 * @param name short / long
 * @returns 轮次数组
 */
export function getCounselorTurns(name: CounselorTurnSet): readonly string[] {
  if (name === 'short') return REALISM_AB_COUNSELOR_TURNS;
  if (name === 'long') return LONG_COUNSELOR_TURNS;
  throw new Error(`未知轮次集合 ${String(name)}; 可选 ${COUNSELOR_TURN_SETS.join(' / ')}`);
}

/**
 * 解析 CLI 的 --turn-set 参数.
 *
 * @param raw 原始值; null/空串返回 short
 * @returns 轮次集合名
 */
export function parseCounselorTurnSet(raw: string | null): CounselorTurnSet {
  if (raw === null || raw.trim().length === 0) return 'short';
  const value = raw.trim();
  if (!COUNSELOR_TURN_SETS.includes(value as CounselorTurnSet)) {
    throw new Error(`未知轮次集合 ${value}; 可选 ${COUNSELOR_TURN_SETS.join(' / ')}`);
  }
  return value as CounselorTurnSet;
}
