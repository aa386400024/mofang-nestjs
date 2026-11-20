// V2026-11-21 建立 (AF-214 · R5 盲评包构造):
//   职责: 把已落库的对练会话转成**去身份、按场景分层、可稳定复算**的真人度盲评包。
//
//   边界:
//     · 纯函数，零 IO / 零 env / 零 LLM；
//     · packet 只保留 packetId / scene / 轮次文本，不保留 session id、角色 slug、咨询师档位；
//     · 含 R4 硬违约（prompt 回显、不可朗读文本）的会话整场剔除，不把脏台词送进评分；
//     · 场景标签是评分必需信息，必须保留；旧批次没有场景层时按项目默认面对面回落。

import { createHash } from 'node:crypto';

import { inferRealismSceneFromPrompt } from './visitor-realism-baseline.js';
import { deriveRealismPacketId, type RealismBlindPacket, type RealismPacketTurn } from './visitor-realism-rating.js';
import type { RealismScene } from '../../shared/realism/turn-shape-selector.js';
import { inspectVisitorRegister } from '../../shared/realism/visitor-register-audit.js';

/** 输入消息；role 必须已归一为 counselor / visitor。 */
export interface RealismSessionMessage {
  readonly role: 'counselor' | 'visitor';
  readonly text: string;
}

/** 输入会话；sessionId 只用于抽样与剔除，不进入 packet。 */
export interface RealismSessionInput {
  readonly sessionId: string;
  readonly scene?: RealismScene;
  readonly prompt?: string | null;
  readonly messages: readonly RealismSessionMessage[];
}

/** 剔除原因。 */
export type RealismPackExclusionReason = 'too_short' | 'hard_violation' | 'no_counselor' | 'empty';

/** 构造选项。 */
export interface BuildRealismBlindPackOptions {
  readonly maxPackets?: number;
  readonly minVisitorTurns?: number;
  readonly seed?: number;
  readonly maxMessages?: number;
}

/** 构造结果；剔除只给计数，不给原文。 */
export interface RealismBlindPackResult {
  readonly packets: readonly RealismBlindPacket[];
  readonly candidateSessions: number;
  readonly excluded: Readonly<Record<RealismPackExclusionReason, number>>;
  readonly eligibleByScene: Readonly<Record<RealismScene, number>>;
}

const SCENE_ORDER: readonly RealismScene[] = ['in_person', 'online_voice', 'online_text'];

function stableHash(sessionId: string, seed: number): string {
  return createHash('sha256').update(`${sessionId}:${seed}`).digest('hex');
}

function emptyExcluded(): Record<RealismPackExclusionReason, number> {
  return { too_short: 0, hard_violation: 0, no_counselor: 0, empty: 0 };
}

function emptyByScene(): Record<RealismScene, number> {
  return { in_person: 0, online_voice: 0, online_text: 0 };
}

/**
 * 构造盲评包。
 *
 * 抽样规则：
 *   1. 先按会话哈希排序，保证同输入同 seed 得到同 packet 顺序；
 *   2. 按场景分层轮转取包，避免某个场景被整体饿死；
 *   3. 包内轮次保持原始顺序，最多保留 maxMessages 轮。
 *
 * @param sessions 已归一化会话
 * @param options 抽样选项
 * @returns 盲评包与剔除计数
 */
export function buildRealismBlindPackets(
  sessions: readonly RealismSessionInput[],
  options: BuildRealismBlindPackOptions = {},
): RealismBlindPackResult {
  const maxPackets = Math.max(1, options.maxPackets ?? 8);
  const minVisitorTurns = Math.max(2, options.minVisitorTurns ?? 3);
  const seed = options.seed ?? 20_261_121;
  const maxMessages = Math.max(4, options.maxMessages ?? 40);
  const excluded = emptyExcluded();
  const eligibleByScene = emptyByScene();
  const eligibleBySceneList: Record<RealismScene, RealismSessionInput[]> = {
    in_person: [],
    online_voice: [],
    online_text: [],
  };

  for (const session of sessions) {
    const messages = session.messages.filter((message) => message.text.trim().length > 0);
    if (messages.length === 0) {
      excluded.empty += 1;
      continue;
    }
    const visitorTurns = messages.filter((message) => message.role === 'visitor');
    const counselorTurns = messages.filter((message) => message.role === 'counselor');
    if (visitorTurns.length < minVisitorTurns) {
      excluded.too_short += 1;
      continue;
    }
    if (counselorTurns.length === 0) {
      excluded.no_counselor += 1;
      continue;
    }
    const hasHardViolation = visitorTurns.some((turn) => {
      const report = inspectVisitorRegister(turn.text, { scene: session.scene ?? 'in_person' });
      return report.violations.length > 0;
    });
    if (hasHardViolation) {
      excluded.hard_violation += 1;
      continue;
    }
    const scene = session.scene ?? inferRealismSceneFromPrompt(session.prompt);
    eligibleByScene[scene] += 1;
    eligibleBySceneList[scene].push(session);
  }

  for (const scene of SCENE_ORDER) {
    eligibleBySceneList[scene].sort((left, right) => {
      const leftHash = stableHash(left.sessionId, seed);
      const rightHash = stableHash(right.sessionId, seed);
      return leftHash.localeCompare(rightHash);
    });
  }

  const selected: RealismSessionInput[] = [];
  const cursors: Record<RealismScene, number> = { in_person: 0, online_voice: 0, online_text: 0 };
  while (selected.length < maxPackets) {
    let addedInRound = false;
    for (const scene of SCENE_ORDER) {
      if (selected.length >= maxPackets) break;
      const next = eligibleBySceneList[scene].at(cursors[scene]);
      if (next === undefined) continue;
      cursors[scene] += 1;
      selected.push(next);
      addedInRound = true;
    }
    if (!addedInRound) break;
  }

  const packets = selected.map((session) => {
    const scene = session.scene ?? inferRealismSceneFromPrompt(session.prompt);
    const kept = session.messages.filter((message) => message.text.trim().length > 0).slice(0, maxMessages);
    const turns: RealismPacketTurn[] = kept.map((message, index) => ({
      turnIndex: index + 1,
      role: message.role,
      text: message.text.trim(),
    }));
    return {
      packetId: deriveRealismPacketId(session.sessionId, seed),
      scene,
      turns,
    } satisfies RealismBlindPacket;
  });

  return { packets, candidateSessions: sessions.length, excluded, eligibleByScene };
}
