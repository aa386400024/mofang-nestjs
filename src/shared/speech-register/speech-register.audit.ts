// AF-462 · 语域指纹审计与确定性指标.
// 只输出计数 / 比率 / 告警码; 不落台词原文, 不进普通日志.

import { renderSpeechRegisterBlock } from './speech-register.render.js';
import type { SpeechRegister, SpeechRegisterAuditSummary, SpeechRegisterMetrics } from './speech-register.types.js';

// 与 visitor-register-audit 的临床术语表同口径; 该文件不在本任务 scope, 不跨模块导出.
const CLINICAL_JARGON: readonly string[] = [
  '防御机制',
  '心理防御',
  '依恋类型',
  '依恋模式',
  '情绪模式',
  '内在小孩',
  '自我觉察',
  '移情',
  '阻抗',
  '抱持',
  '容器',
  '共情',
  '创伤反应',
  '自动化思维',
  '认知重构',
  '核心信念',
  '图式',
  '课题分离',
  '强迫性重复',
];

const ABSTRACT_TERMS: readonly string[] = [
  '价值',
  '意义',
  '状态',
  '关系',
  '情绪',
  '认知',
  '模式',
  '层面',
  '维度',
  '边界',
  '需求',
  '自我',
  '内在',
  '机制',
  '逻辑',
  '本质',
  '结构',
  '系统',
  '过程',
  '影响',
];

/** 配置层审计: 只检查资产本身, 不依赖台词. */
export function auditSpeechRegisterConfig(register: SpeechRegister): SpeechRegisterAuditSummary {
  const block = renderSpeechRegisterBlock(register);
  const warnings: string[] = [];
  if (register.signatureLexicon.length > 4) warnings.push('signature_lexicon_too_large');
  if (register.sampleLines.length > 3) warnings.push('sample_lines_too_many');
  if (register.antiSampleLines.length > 2) warnings.push('anti_sample_lines_too_many');
  if (register.avoidLexicon.length === 0) warnings.push('avoid_lexicon_empty');
  if (register.anchors.length === 0) warnings.push('anchors_empty');
  if (register.dialectStrength > 0.5) warnings.push('dialect_strength_high');
  if (block.length > 460) warnings.push('rendered_block_too_long');
  return {
    version: register.version,
    roleKey: register.roleKey,
    signatureCount: register.signatureLexicon.length,
    anchorCount: register.anchors.length,
    sampleCount: register.sampleLines.length,
    antiSampleCount: register.antiSampleLines.length,
    renderedLength: block.length,
    warnings,
  };
}

/** 台词层确定性指标: 用于 base vs active 回归对比, 不替代人工盲评. */
export function measureSpeechRegisterFit(text: string, register: SpeechRegister): SpeechRegisterMetrics {
  const normalized = text.replaceAll(/\s+/gu, '');
  const charCount = countChars(normalized);
  const sentences = splitSentences(normalized);
  const sentenceCount = Math.max(1, sentences.length);
  const abstractHits = countHits(normalized, ABSTRACT_TERMS);
  const jargonHits = countHits(normalized, CLINICAL_JARGON);
  const signatureHits = register.signatureLexicon.filter((word) => word.length > 0 && normalized.includes(word)).length;
  const anchorHits = register.anchors.filter((anchor) => anchor.length > 0 && normalized.includes(anchor)).length;
  return {
    roleKey: register.roleKey,
    charCount,
    sentenceCount,
    averageSentenceLength: charCount === 0 ? 0 : round(charCount / sentenceCount, 1),
    fragmentRate: sentences.length === 0 ? 0 : round(sentences.filter((sentence) => countChars(sentence) <= 6).length / sentenceCount, 2),
    abstractTermRate: charCount === 0 ? 0 : round((abstractHits / charCount) * 100, 2),
    jargonRate: charCount === 0 ? 0 : round((jargonHits / charCount) * 100, 2),
    signatureHitRate: register.signatureLexicon.length === 0 ? 0 : round(signatureHits / register.signatureLexicon.length, 2),
    anchorDensity: charCount === 0 ? 0 : round((anchorHits / charCount) * 100, 2),
  };
}

/** 聚合多轮指标; 输出均值, 不保留原文. */
export function aggregateSpeechRegisterMetrics(items: readonly SpeechRegisterMetrics[]): SpeechRegisterMetrics {
  if (items.length === 0) {
    return {
      roleKey: '',
      charCount: 0,
      sentenceCount: 0,
      averageSentenceLength: 0,
      fragmentRate: 0,
      abstractTermRate: 0,
      jargonRate: 0,
      signatureHitRate: 0,
      anchorDensity: 0,
    };
  }
  const first = items[0];
  const average = (key: keyof SpeechRegisterMetrics): number =>
    round(items.reduce((sum, item) => sum + Number(item[key]), 0) / items.length, 2);
  return {
    roleKey: first.roleKey,
    charCount: Math.round(items.reduce((sum, item) => sum + item.charCount, 0) / items.length),
    sentenceCount: Math.round(items.reduce((sum, item) => sum + item.sentenceCount, 0) / items.length),
    averageSentenceLength: average('averageSentenceLength'),
    fragmentRate: average('fragmentRate'),
    abstractTermRate: average('abstractTermRate'),
    jargonRate: average('jargonRate'),
    signatureHitRate: average('signatureHitRate'),
    anchorDensity: average('anchorDensity'),
  };
}

function splitSentences(text: string): readonly string[] {
  return text
    .split(/[。！？!?；;\n]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function countHits(text: string, terms: readonly string[]): number {
  let hits = 0;
  for (const term of terms) {
    if (term.length === 0) continue;
    let index = text.indexOf(term);
    while (index >= 0) {
      hits += 1;
      index = text.indexOf(term, index + term.length);
    }
  }
  return hits;
}

function countChars(text: string): number {
  return Array.from(text).length;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
