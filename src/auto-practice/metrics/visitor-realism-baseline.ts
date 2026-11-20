// V2026-11-21 建立 (AF-211 · R4 批次基线):
//   职责: 对一批**已落库的来访者台词**做只读聚合，给出可复算的真人度基线。
//
//   边界:
//     · 纯函数，零 IO / 零 env / 零 LLM；
//     · 只输出数字与分类计数，不输出任何台词、不保存原文；
//     · 阈值与运行时审计共用 `measureVisitorTurnLength`，避免两套口径分叉；
//     · 不评“像不像真人”的主观分，那是 R5 双盲评分的事。

import type { RealismScene } from '../../shared/realism/turn-shape-selector.js';
import { countRealismEvents, measureVisitorTurnLength } from '../../shared/realism/visitor-realism-audit.js';
import { inspectVisitorRegister, type RegisterSignal, type RegisterViolation } from '../../shared/realism/visitor-register-audit.js';
import { inspectGeneratedOutput } from '../../shared/text/output-integrity.js';

export interface BaselineSession {
  /** 仅用于统计，不进入任何日志或报告正文。 */
  readonly sessionId: string;
  readonly scene: RealismScene;
  readonly visitorTurns: readonly string[];
}

export interface SceneBaseline {
  readonly sessions: number;
  readonly turns: number;
  readonly hardViolations: number;
  readonly hardRatePer100Turns: number;
  readonly tooLongTurns: number;
  readonly tooLongRatePer100Turns: number;
  readonly totalEvents: number;
  readonly eventsPerTurn: number;
}

export interface VisitorRealismBaseline {
  readonly sessions: number;
  readonly turns: number;
  /** 口径 = 剥掉已闭合推理块后的“可朗读文本”；推理块里的设定复述不计入台词违约。 */
  readonly hardViolations: number;
  readonly hardRatePer100Turns: number;
  readonly byViolation: Readonly<Record<RegisterViolation, number>>;
  /** 原始文本口径（R3 审计口径），用于说明推理块会抬高计数，不作为台词质量结论。 */
  readonly rawAudit: {
    readonly hardViolations: number;
    readonly hardRatePer100Turns: number;
    readonly byViolation: Readonly<Record<RegisterViolation, number>>;
  };
  readonly softSignals: number;
  readonly bySignal: Readonly<Record<RegisterSignal, number>>;
  /** 常开输出完整性闸门的命中情况；用于对比 R3 审计口径与 always-on 口径。 */
  readonly outputIntegrity: {
    readonly invalidTurns: number;
    readonly invalidRatePer100Turns: number;
    readonly byReason: Readonly<Record<string, number>>;
  };
  readonly tooLongTurns: number;
  readonly tooLongRatePer100Turns: number;
  readonly events: Readonly<Record<string, number>>;
  readonly totalEvents: number;
  readonly eventsPerTurn: number;
  readonly scenes: Readonly<Record<RealismScene, SceneBaseline>>;
}

const REGISTER_VIOLATIONS: readonly RegisterViolation[] = ['prompt_echo', 'non_spoken_text'];
const REGISTER_SIGNALS: readonly RegisterSignal[] = ['clinical_jargon', 'bookish_connective', 'assistant_tone', 'meta_speech'];

function ratePer100(value: number, turns: number): number {
  if (turns === 0) return 0;
  return Math.round((value / turns) * 10_000) / 100;
}

function ratio(value: number, turns: number): number {
  if (turns === 0) return 0;
  return Math.round((value / turns) * 100) / 100;
}

function emptyScene(): {
  sessions: number;
  turns: number;
  hardViolations: number;
  tooLongTurns: number;
  totalEvents: number;
} {
  return { sessions: 0, turns: 0, hardViolations: 0, tooLongTurns: 0, totalEvents: 0 };
}

interface SceneCounts {
  sessions: number;
  turns: number;
  hardViolations: number;
  tooLongTurns: number;
  totalEvents: number;
}

interface BaselineAccumulator {
  readonly byViolation: Record<RegisterViolation, number>;
  readonly rawByViolation: Record<RegisterViolation, number>;
  readonly bySignal: Record<RegisterSignal, number>;
  readonly events: Record<string, number>;
  readonly scenes: Record<RealismScene, SceneCounts>;
  readonly outputReasons: Record<string, number>;
  turns: number;
  hardViolations: number;
  rawHardViolations: number;
  softSignals: number;
  tooLongTurns: number;
  totalEvents: number;
  invalidOutputTurns: number;
}

function createAccumulator(): BaselineAccumulator {
  return {
    byViolation: { prompt_echo: 0, non_spoken_text: 0 },
    rawByViolation: { prompt_echo: 0, non_spoken_text: 0 },
    bySignal: { clinical_jargon: 0, bookish_connective: 0, assistant_tone: 0, meta_speech: 0 },
    events: {},
    scenes: {
      in_person: emptyScene(),
      online_voice: emptyScene(),
      online_text: emptyScene(),
    },
    outputReasons: {},
    turns: 0,
    hardViolations: 0,
    rawHardViolations: 0,
    softSignals: 0,
    tooLongTurns: 0,
    totalEvents: 0,
    invalidOutputTurns: 0,
  };
}

function increase(target: Record<string, number>, key: string, delta = 1): void {
  target[key] = (target[key] ?? 0) + delta;
}

function countViolations(violations: readonly RegisterViolation[], target: Record<RegisterViolation, number>): void {
  for (const violation of violations) increase(target, violation);
}

function accumulateRawTurn(accumulator: BaselineAccumulator, scene: RealismScene, text: string): string {
  const rawRegister = inspectVisitorRegister(text, { scene });
  if (rawRegister.violations.length > 0) {
    accumulator.rawHardViolations += 1;
    countViolations(rawRegister.violations, accumulator.rawByViolation);
  }

  const integrity = inspectGeneratedOutput(text, 'visitor');
  if (integrity.invalid) {
    accumulator.invalidOutputTurns += 1;
    for (const reason of integrity.reasons) increase(accumulator.outputReasons, reason);
  }
  return integrity.clean.trim();
}

function accumulateSpokenTurn(accumulator: BaselineAccumulator, sceneCounts: SceneCounts, scene: RealismScene, text: string): void {
  const register = inspectVisitorRegister(text, { scene });
  if (register.violations.length > 0) {
    accumulator.hardViolations += 1;
    sceneCounts.hardViolations += 1;
    countViolations(register.violations, accumulator.byViolation);
  }

  for (const signal of register.signals) increase(accumulator.bySignal, signal);
  if (register.signals.length > 0) accumulator.softSignals += 1;

  if (measureVisitorTurnLength(text).overGlobalLimit) {
    accumulator.tooLongTurns += 1;
    sceneCounts.tooLongTurns += 1;
  }

  const counted = countRealismEvents(text);
  accumulator.totalEvents += counted.totalEvents;
  sceneCounts.totalEvents += counted.totalEvents;
  for (const [kind, value] of Object.entries(counted.counts)) increase(accumulator.events, kind, value);
}

function accumulateTurn(accumulator: BaselineAccumulator, session: BaselineSession, raw: string): void {
  const text = raw.trim();
  if (text.length === 0) return;

  accumulator.turns += 1;
  const sceneCounts = accumulator.scenes[session.scene];
  sceneCounts.turns += 1;

  const spoken = accumulateRawTurn(accumulator, session.scene, text);
  if (spoken.length > 0) accumulateSpokenTurn(accumulator, sceneCounts, session.scene, spoken);
}

function sceneReport(scene: SceneCounts): SceneBaseline {
  return {
    sessions: scene.sessions,
    turns: scene.turns,
    hardViolations: scene.hardViolations,
    hardRatePer100Turns: ratePer100(scene.hardViolations, scene.turns),
    tooLongTurns: scene.tooLongTurns,
    tooLongRatePer100Turns: ratePer100(scene.tooLongTurns, scene.turns),
    totalEvents: scene.totalEvents,
    eventsPerTurn: ratio(scene.totalEvents, scene.turns),
  };
}

/**
 * 聚合一批会话，得到批次基线。
 *
 * 输入只接受已经按会话分好组的台词；函数不会跨会话推断上下文，
 * 因此指标是“台词级”而非“对话级”的。
 */
export function aggregateRealismBaseline(sessions: readonly BaselineSession[]): VisitorRealismBaseline {
  const accumulator = createAccumulator();

  for (const session of sessions) {
    accumulator.scenes[session.scene].sessions += 1;
    for (const raw of session.visitorTurns) accumulateTurn(accumulator, session, raw);
  }

  return {
    sessions: sessions.length,
    turns: accumulator.turns,
    hardViolations: accumulator.hardViolations,
    hardRatePer100Turns: ratePer100(accumulator.hardViolations, accumulator.turns),
    byViolation: accumulator.byViolation,
    rawAudit: {
      hardViolations: accumulator.rawHardViolations,
      hardRatePer100Turns: ratePer100(accumulator.rawHardViolations, accumulator.turns),
      byViolation: accumulator.rawByViolation,
    },
    softSignals: accumulator.softSignals,
    bySignal: accumulator.bySignal,
    outputIntegrity: {
      invalidTurns: accumulator.invalidOutputTurns,
      invalidRatePer100Turns: ratePer100(accumulator.invalidOutputTurns, accumulator.turns),
      byReason: accumulator.outputReasons,
    },
    tooLongTurns: accumulator.tooLongTurns,
    tooLongRatePer100Turns: ratePer100(accumulator.tooLongTurns, accumulator.turns),
    events: accumulator.events,
    totalEvents: accumulator.totalEvents,
    eventsPerTurn: ratio(accumulator.totalEvents, accumulator.turns),
    scenes: {
      in_person: sceneReport(accumulator.scenes.in_person),
      online_voice: sceneReport(accumulator.scenes.online_voice),
      online_text: sceneReport(accumulator.scenes.online_text),
    },
  };
}

/** 供测试与调用方确认分类全集，避免新增枚举后报告漏项。 */
export function baselineCategories(): {
  readonly violations: readonly RegisterViolation[];
  readonly signals: readonly RegisterSignal[];
} {
  return { violations: REGISTER_VIOLATIONS, signals: REGISTER_SIGNALS };
}

/**
 * 从渲染 prompt 的“场景层”推断本场接触方式。
 *
 * 旧批次（R1 之前）没有场景层，按项目默认的面对面咨询室处理；
 * 这里只读一个固定标记句，不做语义猜测，也不把整段 prompt 带到报告里。
 */
export function inferRealismSceneFromPrompt(prompt?: string | null): RealismScene {
  if (!prompt) return 'in_person';
  if (prompt.includes('保持同步语音感')) return 'online_voice';
  if (prompt.includes('保持文字咨询感')) return 'online_text';
  return 'in_person';
}
