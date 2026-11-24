// AF-462 · 语域指纹结构校验.
// 只接受显式字段; 任何评价性标签 / 越界数值 / 超长台词都在入库前拦下.

import {
  AGE_BANDS,
  DIRECTNESS_LEVELS,
  DISCLOSURE_LEVELS,
  EDUCATION_BANDS,
  POLITENESS_LEVELS,
  REGION_MACROS,
  SOCIAL_CONTEXTS,
  SPEECH_REGISTER_VERSION,
  type SpeechRegister,
} from './speech-register.types.js';

const BANNED_LABELS = ['文化水平低', '没文化', '文盲', '农村人', '乡下人', '底层', '低端人口', '外地人', '素质低', '下等人'] as const;

const MAX_SAMPLE_TEXT = 120;

/**
 * 校验期使用的宽松记录: 既有索引签名, 又把要读的键声明出来.
 *
 * 为什么不直接 `Record<string, unknown>`: 仓库开了 `noPropertyAccessFromIndexSignature`,
 * 点取 `input.version` 会报 TS4111; 每个键写 `input['version']` 又会把 20 行读值搅乱.
 */
interface RawRecord {
  readonly [key: string]: unknown;
  version?: unknown;
  roleKey?: unknown;
  identity?: unknown;
  socialContext?: unknown;
  dialectStrength?: unknown;
  vocabulary?: unknown;
  syntax?: unknown;
  stance?: unknown;
  anchors?: unknown;
  signatureLexicon?: unknown;
  avoidLexicon?: unknown;
  sampleLines?: unknown;
  antiSampleLines?: unknown;
  ageBand?: unknown;
  occupation?: unknown;
  educationBand?: unknown;
  livingStatus?: unknown;
  regionMacro?: unknown;
  abstractTermBudget?: unknown;
  jargonBudget?: unknown;
  concreteAnchorDensity?: unknown;
  averageSentenceLength?: unknown;
  fragmentTolerance?: unknown;
  connectiveUse?: unknown;
  directness?: unknown;
  politeness?: unknown;
  disclosure?: unknown;
}

/** 解析并归一化一份语域指纹; 结构非法返回 null. */
export function parseSpeechRegister(input: unknown): SpeechRegister | null {
  if (!isRecord(input) || input.version !== SPEECH_REGISTER_VERSION) return null;
  const roleKey = readText(input.roleKey, 64, 3);
  const identity = readIdentity(input.identity);
  const socialContext = readEnumArray(input.socialContext, SOCIAL_CONTEXTS, 4);
  const dialectStrength = readNumber(input.dialectStrength, 0, 1);
  const vocabulary = readVocabulary(input.vocabulary);
  const syntax = readSyntax(input.syntax);
  const stance = readStance(input.stance);
  const anchors = readTextArray(input.anchors, 5, 40);
  const signatureLexicon = readTextArray(input.signatureLexicon, 6, 40);
  const avoidLexicon = readTextArray(input.avoidLexicon, 8, 40);
  const sampleLines = readTextArray(input.sampleLines, 3, MAX_SAMPLE_TEXT, 1);
  const antiSampleLines = readTextArray(input.antiSampleLines, 2, MAX_SAMPLE_TEXT, 1);
  if (
    roleKey === null ||
    identity === null ||
    socialContext === null ||
    dialectStrength === null ||
    vocabulary === null ||
    syntax === null ||
    stance === null ||
    anchors === null ||
    signatureLexicon === null ||
    avoidLexicon === null ||
    sampleLines === null ||
    antiSampleLines === null
  ) {
    return null;
  }

  const register: SpeechRegister = {
    version: SPEECH_REGISTER_VERSION,
    roleKey,
    identity,
    socialContext,
    dialectStrength,
    vocabulary,
    syntax,
    stance,
    anchors,
    signatureLexicon,
    avoidLexicon,
    sampleLines,
    antiSampleLines,
  };
  return containsBannedLabel(register) ? null : register;
}

/** 入库前自检; 返回 null = 合法, 否则返回人读原因. */
export function validateSpeechRegister(input: unknown): string | null {
  return parseSpeechRegister(input) === null ? '语域指纹结构非法或含评价性标签' : null;
}

/** 断言式自检; seed 在写库前调用. */
export function assertSpeechRegister(input: unknown, label: string): asserts input is SpeechRegister {
  const issue = validateSpeechRegister(input);
  if (issue !== null) throw new Error(`${label}: ${issue}`);
}

function readIdentity(input: unknown): SpeechRegister['identity'] | null {
  if (!isRecord(input)) return null;
  const ageBand = readEnum(input.ageBand, AGE_BANDS);
  const occupation = readText(input.occupation, 60, 2);
  const educationBand = readEnum(input.educationBand, EDUCATION_BANDS);
  const livingStatus = readText(input.livingStatus, 40, 2);
  const regionMacro = readEnum(input.regionMacro, REGION_MACROS);
  if (ageBand === null || occupation === null || educationBand === null || livingStatus === null || regionMacro === null) {
    return null;
  }
  return { ageBand, occupation, educationBand, livingStatus, regionMacro };
}

function readVocabulary(input: unknown): SpeechRegister['vocabulary'] | null {
  if (!isRecord(input)) return null;
  const abstractTermBudget = readNumber(input.abstractTermBudget, 0, 1);
  const jargonBudget = readNumber(input.jargonBudget, 0, 1);
  const concreteAnchorDensity = readNumber(input.concreteAnchorDensity, 0, 1);
  if (abstractTermBudget === null || jargonBudget === null || concreteAnchorDensity === null) return null;
  return { abstractTermBudget, jargonBudget, concreteAnchorDensity };
}

function readSyntax(input: unknown): SpeechRegister['syntax'] | null {
  if (!isRecord(input)) return null;
  const averageSentenceLength = readNumber(input.averageSentenceLength, 4, 40);
  const fragmentTolerance = readNumber(input.fragmentTolerance, 0, 1);
  const connectiveUse = readNumber(input.connectiveUse, 0, 1);
  if (averageSentenceLength === null || fragmentTolerance === null || connectiveUse === null) return null;
  return { averageSentenceLength, fragmentTolerance, connectiveUse };
}

function readStance(input: unknown): SpeechRegister['stance'] | null {
  if (!isRecord(input)) return null;
  const directness = readEnum(input.directness, DIRECTNESS_LEVELS);
  const politeness = readEnum(input.politeness, POLITENESS_LEVELS);
  const disclosure = readEnum(input.disclosure, DISCLOSURE_LEVELS);
  if (directness === null || politeness === null || disclosure === null) return null;
  return { directness, politeness, disclosure };
}

function readText(input: unknown, maxLength: number, minLength = 1): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text.length < minLength || text.length > maxLength) return null;
  if (BANNED_LABELS.some((label) => text.includes(label))) return null;
  return text;
}

function readTextArray(input: unknown, maxItems: number, maxLength: number, minItems = 1): readonly string[] | null {
  if (!Array.isArray(input) || input.length < minItems || input.length > maxItems) return null;
  const items: string[] = [];
  for (const item of input) {
    const text = readText(item, maxLength);
    if (text === null) return null;
    if (!items.includes(text)) items.push(text);
  }
  return items;
}

function readEnumArray<T extends string>(input: unknown, allowed: readonly T[], maxItems: number): readonly T[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > maxItems) return null;
  const values: T[] = [];
  for (const item of input) {
    const value = readEnum(item, allowed);
    if (value === null) return null;
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function readEnum<T extends string>(input: unknown, allowed: readonly T[]): T | null {
  return typeof input === 'string' && (allowed as readonly string[]).includes(input) ? (input as T) : null;
}

function readNumber(input: unknown, min: number, max: number): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max ? input : null;
}

function containsBannedLabel(register: SpeechRegister): boolean {
  const values = [
    register.identity.occupation,
    register.identity.livingStatus,
    ...register.anchors,
    ...register.signatureLexicon,
    ...register.avoidLexicon,
    ...register.sampleLines,
    ...register.antiSampleLines,
  ];
  return values.some((value) => BANNED_LABELS.some((label) => value.includes(label)));
}

function isRecord(input: unknown): input is RawRecord {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
