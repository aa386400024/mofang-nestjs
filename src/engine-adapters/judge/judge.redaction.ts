// V2026-11-29 (Phase3 Judge Layer P0 · Judge 专用脱敏纯函数):
//   职责: 在 Judge 输入出境前, 把 PII / 语义身份线索 / 自伤与创伤细节降级为类别标签.
//   边界: 纯函数, 零 IO / 零网络; PII 正则**复用** src/shared/infra/observability/pii-redactor.ts.
//
//   两层脱敏:
//     ① 字面层: 手机号 / 身份证 / 邮箱 / 凭据 (直接复用 pii-redactor 的唯一实现);
//     ② 语义层: 人名 / 地点 / 单位 / 家庭关系 → 角色类别; 自伤 / 创伤细节 → 类别占位.
//
//   ⚠️ 危机 / 自伤相邻轮次的**排除**不在这里做文本替换 —— 那是编排层的事
//     (见 judge.shadow.ts selectExcludedTurns): 这些轮次根本不进外部请求,
//     只保留本地规则结论与引用.

import type { JudgeRedactionInput, JudgeRedactionOutput, JudgeRedactedExcerpt } from './judge.types.js';
import { PHONE_PATTERN, ID_CARD_PATTERN, EMAIL_PATTERN, redactString } from '../../shared/infra/observability/pii-redactor.js';

/** 危机 / 自伤相关事件标签 (与 L1 事件标签体系对齐). */
export const JUDGE_CRISIS_EVENT_TAGS = ['crisis', 'self_harm', 'suicide', 'risk_high', 'crisis_ended'] as const;

/** 危机 / 自伤语义词 (用于语义层降级与命中判断). */
const CRISIS_TERMS = /自杀|自残|割腕|跳楼|上吊|吞药|安眠药|想死|不想活|结束生命|轻生|自伤|性侵|强奸|猥亵|家暴|虐待|创伤|闪回|流血|尸体/;

/** 家庭关系词 (统一泛化为 [家庭成员]); 长词在前, 避免「妈妈」被「妈」先吃掉. */
const FAMILY_ROLE_TERMS = [
  '爸爸',
  '妈妈',
  '父亲',
  '母亲',
  '老公',
  '老婆',
  '丈夫',
  '妻子',
  '儿子',
  '女儿',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '爷爷',
  '奶奶',
  '外公',
  '外婆',
  '叔叔',
  '阿姨',
  '舅舅',
  '姑姑',
  '继父',
  '继母',
  '妈',
  '爸',
] as const;

/** 自我介绍式人名. */
const SELF_NAME_PATTERN = /(我叫|叫我|名字叫|本人叫)([\u4E00-\u9FA5·]{2,6})/g;

/** 姓 + 职业称呼 (例如 王老师 / 李医生). */
const ROLE_NAME_PATTERN = /([，。！？、；,.\s])([\u4E00-\u9FA5]{1,2})(老师|医生|咨询师|主任|经理|教授)/g;

/** 地点后缀. */
const LOCATION_PATTERN = /[\u4E00-\u9FA5]{2,8}(?:市|区|县|镇|村|街道|路|小区|大厦|广场)/g;

/** 单位 / 机构后缀. */
const AFFILIATION_PATTERN = /[\u4E00-\u9FA5]{2,10}(?:公司|单位|学校|大学|医院|机构|集团|银行|工厂)/g;

/** 句子分隔 (保留分隔符, 用于整句降级). */
const SENTENCE_SEPARATOR = /([。！？；\n])/;

/**
 * 自伤 / 创伤细节整句降级 (按句处理, 避免跨句回溯).
 *
 * @param text 文本
 * @returns 降级文本与是否命中
 */
function downgradeSelfHarmSentences(text: string): { readonly text: string; readonly changed: boolean } {
  const parts = text.split(SENTENCE_SEPARATOR);
  let changed = false;
  for (let index = 0; index < parts.length; index += 2) {
    if (parts[index].length > 0 && CRISIS_TERMS.test(parts[index])) {
      parts[index] = '[自伤/创伤细节已降级为类别标签]';
      changed = true;
    }
  }
  return { text: parts.join(''), changed };
}

/**
 * 判断一轮是否命中危机 / 自伤信号.
 *
 * @param riskLevel 风险等级
 * @param eventTags 事件标签
 * @param rawText 原始文本 (可空)
 * @returns 是否命中
 */
export function isCrisisSignal(riskLevel: string, eventTags: readonly string[], rawText?: string): boolean {
  if (riskLevel === 'high') return true;
  if (eventTags.some((tag) => (JUDGE_CRISIS_EVENT_TAGS as readonly string[]).includes(tag))) return true;
  return rawText !== undefined && CRISIS_TERMS.test(rawText);
}

/**
 * 生成无原文时的安全结构化摘要.
 *
 * @param turnIndex 轮次
 * @param riskLevel 风险等级
 * @param eventTags 事件标签
 * @returns 摘要文本
 */
function buildStructuredDigest(turnIndex: number, riskLevel: string, eventTags: readonly string[]): string {
  const tags = eventTags.length > 0 ? eventTags.join('/') : '无事件标签';
  return `第${turnIndex}轮 · 风险=${riskLevel} · 事件=${tags} · 无数值外原文`;
}

/**
 * 语义层脱敏.
 *
 * @param text 已过字面层 PII 的文本
 * @returns 脱敏文本与命中标签
 */
function redactSemantic(text: string): { readonly text: string; readonly tags: readonly string[] } {
  const tags = new Set<string>();
  let result = text;

  if (PHONE_PATTERN.test(text)) tags.add('phone');
  if (ID_CARD_PATTERN.test(text)) tags.add('id_card');
  if (EMAIL_PATTERN.test(text)) tags.add('email');
  // 正则带 /g 且 test 会推进 lastIndex —— 用完立即归零, 避免下一次误判.
  PHONE_PATTERN.lastIndex = 0;
  ID_CARD_PATTERN.lastIndex = 0;
  EMAIL_PATTERN.lastIndex = 0;

  result = result.replaceAll(SELF_NAME_PATTERN, (_match, prefix: string) => {
    tags.add('person_name');
    return `${prefix}[人名]`;
  });

  result = result.replaceAll(ROLE_NAME_PATTERN, (_match, prefix: string, _name: string, role: string) => {
    tags.add('person_name');
    return `${prefix}[人名]${role}`;
  });

  if (FAMILY_ROLE_TERMS.some((term) => result.includes(term))) tags.add('family_role');
  for (const term of FAMILY_ROLE_TERMS) result = result.replaceAll(term, '[家庭成员]');

  if (LOCATION_PATTERN.test(result)) tags.add('location');
  LOCATION_PATTERN.lastIndex = 0;
  result = result.replaceAll(LOCATION_PATTERN, '[地点]');

  if (AFFILIATION_PATTERN.test(result)) tags.add('affiliation');
  AFFILIATION_PATTERN.lastIndex = 0;
  result = result.replaceAll(AFFILIATION_PATTERN, '[单位]');

  const downgraded = downgradeSelfHarmSentences(result);
  if (downgraded.changed) tags.add('self_harm_or_trauma_detail');
  result = downgraded.text;

  return { text: result, tags: [...tags] };
}

/**
 * 在字面层脱敏**之前**识别 PII 类型 (脱敏后就再也认不出来了).
 *
 * @param text 原始文本
 * @returns 命中的 PII 标签
 */
function detectPiiTags(text: string): string[] {
  const tags: string[] = [];
  const patterns: readonly [RegExp, string][] = [
    [PHONE_PATTERN, 'phone'],
    [ID_CARD_PATTERN, 'id_card'],
    [EMAIL_PATTERN, 'email'],
  ];
  for (const [pattern, tag] of patterns) {
    pattern.lastIndex = 0;
    const hit = pattern.test(text);
    pattern.lastIndex = 0;
    if (hit) tags.push(tag);
  }
  return tags;
}

/**
 * 脱敏一轮 Judges 输入.
 *
 * @param input 原始输入
 * @returns 脱敏片段 + 命中标签 + 危机命中标记
 */
export function redactJudgeInput(input: JudgeRedactionInput): JudgeRedactionOutput {
  const raw = (input.rawText ?? '').trim();
  if (raw.length === 0) {
    const excerpt: JudgeRedactedExcerpt = {
      excerptId: `t${input.turnIndex}`,
      turnIndex: input.turnIndex,
      text: buildStructuredDigest(input.turnIndex, input.riskLevel, input.eventTags),
      redactionTags: ['structured_digest'],
      structuredDigest: true,
    };
    return { excerpt, crisisHit: isCrisisSignal(input.riskLevel, input.eventTags), tags: ['structured_digest'] };
  }

  const piiTags = detectPiiTags(raw);
  const literalRedacted = redactString(raw);
  const semantic = redactSemantic(literalRedacted);
  const allTags = [...new Set([...piiTags, ...semantic.tags])];
  const excerpt: JudgeRedactedExcerpt = {
    excerptId: `t${input.turnIndex}`,
    turnIndex: input.turnIndex,
    text: semantic.text,
    redactionTags: allTags.length > 0 ? allTags : ['no_rule_hit'],
    structuredDigest: false,
  };
  return {
    excerpt,
    crisisHit: isCrisisSignal(input.riskLevel, input.eventTags, raw),
    tags: allTags,
  };
}
