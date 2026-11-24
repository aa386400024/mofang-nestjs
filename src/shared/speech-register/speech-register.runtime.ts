// AF-462 · 语域灰度开关.
// 默认 off; audit 只产出配置摘要; active 且命中试点角色才注入 prompt.

import { auditSpeechRegisterConfig } from './speech-register.audit.js';
import { parseSpeechRegister } from './speech-register.schema.js';
import {
  SPEECH_REGISTER_MODES,
  type SpeechRegister,
  type SpeechRegisterMode,
  type SpeechRegisterSelection,
} from './speech-register.types.js';

export interface SpeechRegisterEnv {
  readonly [key: string]: string | undefined;
  readonly VISITOR_REGISTER_MODE?: string;
  readonly VISITOR_REGISTER_PILOT_IDS?: string;
}

/** 解析开关; 非法值回落 off. */
export function parseSpeechRegisterMode(raw: string | undefined): SpeechRegisterMode {
  return typeof raw === 'string' && (SPEECH_REGISTER_MODES as readonly string[]).includes(raw.trim())
    ? (raw.trim() as SpeechRegisterMode)
    : 'off';
}

/** 解析试点角色 id; 空 = 全部角色. */
export function parseSpeechRegisterPilotIds(raw: string | undefined): readonly string[] {
  if (typeof raw !== 'string') return [];
  return [
    ...new Set(
      raw
        .split(/[,，\s]+/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

/** 选择本角色本轮是否注入语域; 纯函数, 环境值由调用方传入. */
export function selectSpeechRegister(
  base: SpeechRegister | null | undefined,
  roleKey: string,
  env: SpeechRegisterEnv,
): SpeechRegisterSelection {
  const mode = parseSpeechRegisterMode(env.VISITOR_REGISTER_MODE);
  if (mode === 'off') return { mode, reason: 'off' };
  if (!base) return { mode, reason: 'missing_register' };
  const audit = auditSpeechRegisterConfig(base);
  if (mode === 'audit') return { mode, audit, reason: 'audit_only' };
  const pilots = parseSpeechRegisterPilotIds(env.VISITOR_REGISTER_PILOT_IDS);
  const inPilot = pilots.length === 0 || pilots.includes(roleKey) || pilots.includes(base.roleKey);
  return inPilot ? { mode, register: base, audit } : { mode, audit, reason: 'not_in_pilot' };
}

/** 从 DB JSON 字段解析; 非法返回 null. */
export function parseSpeechRegisterColumn(raw: unknown): SpeechRegister | null {
  return parseSpeechRegister(raw);
}
