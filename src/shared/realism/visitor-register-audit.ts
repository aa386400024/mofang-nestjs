// V2026-11-20 建立 (AF-209 · R3 语域审计):
//   职责: 判断一段来访者台词是否“能直接说出口”，以及是否串进了咨询师语域。
//
//   边界:
//     · 纯函数，零 IO / 零 env / 零 LLM；
//     · 不可朗读文本（括号动作、星号动作、界面 chrome）是硬违约，必须拦；
//     · 咨询术语、书面连接词、助手口吻、元话语是软信号，只观察，不逼模型改台词；
//     · 不返回原文，只返回分类。

export type RegisterViolation = 'non_spoken_text' | 'prompt_echo';
export type RegisterSignal = 'clinical_jargon' | 'bookish_connective' | 'assistant_tone' | 'meta_speech';

export interface RegisterAuditResult {
  readonly violations: readonly RegisterViolation[];
  readonly signals: readonly RegisterSignal[];
}

/** 括号 / 星号里的舞台动作：TTS 读不出来，也不该出现在来访者台词里。 */
const STAGE_ACTION_WORDS: readonly string[] = [
  '沉默',
  '停顿',
  '叹气',
  '哭',
  '笑',
  '皱眉',
  '摇头',
  '点头',
  '深呼吸',
  '低声',
  '小声',
  '犹豫',
  '想了想',
  '顿了顿',
  '看向',
  '低头',
  '抬头',
  '发抖',
  '攥紧',
  '握紧',
  '擦了擦',
];

const STAGE_MODIFIERS: readonly string[] = ['轻轻', '慢慢', '突然', '又', '忍不住'];
const PAREN_CONTENT = /[（(]([^）)]{1,20})[）)]/g;
const STAR_CONTENT = /\*([^*\n]{1,20})\*/g;

function looksLikeStageAction(inner: string): boolean {
  let content = inner.trim();
  for (const modifier of STAGE_MODIFIERS) {
    if (content.startsWith(modifier)) {
      content = content.slice(modifier.length).trim();
      break;
    }
  }
  return STAGE_ACTION_WORDS.some((word) => content.startsWith(word));
}

function hasStageDirection(text: string): boolean {
  for (const pattern of [PAREN_CONTENT, STAR_CONTENT]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const inner = match[1];
      if (looksLikeStageAction(inner)) return true;
    }
  }
  return false;
}

/** 线上界面 chrome：不是台词内容，任何场景都不该由来访者说出来。 */
const INTERFACE_MARKERS: readonly string[] = [
  '对方正在输入',
  '语音条',
  '聊天框',
  '消息框',
  '聊天界面',
  '屏幕上',
  '发送键',
  '回车发送',
  '未读消息',
  '已读回执',
];

/**
 * 设定 / prompt 回显：这是比“语气不对”严重得多的失败。
 * 只认明确的模板标题与内部字段名，不认“规则”“设定”这类生活词。
 */
const PROMPT_ECHO_MARKERS: readonly string[] = [
  '关键事件：',
  '你心里坚信',
  '你绝不会做的事',
  '你说话的味道',
  '这一轮怎么说',
  '硬规则：',
  '上一轮咨询师说',
  '【本轮重说要求】',
  '不流利配额',
  '话轮形态层',
];

/** 咨询/诊断术语：来访者可能知道，但在这轮里说出来会像在念评估报告。 */
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

/** 书面连接词：口语里很少自然出现，出现就像写好的稿子。 */
const BOOKISH_CONNECTIVES: readonly string[] = [
  '此外',
  '然而',
  '因此',
  '综上所述',
  '值得注意的是',
  '从某种意义上说',
  '换言之',
  '首先',
  '其次',
  '最后',
  '总的来说',
  '一方面',
  '另一方面',
];

/** 助手 / 咨询师口吻：来访者不该反过来安抚、总结或给建议。 */
const ASSISTANT_TONE: readonly string[] = [
  '我理解你的意思',
  '你说得对',
  '谢谢你的建议',
  '我会尝试',
  '我们可以一起',
  '听起来你',
  '你的感受是',
  '我建议你',
  '我在这里陪着你',
  '我明白你的感受',
];

/** 元话语：把“怎么说”说出来，会打断角色沉浸。 */
const META_SPEECH: readonly string[] = [
  '我想表达的是',
  '我需要说明',
  '让我重新组织',
  '用一句话概括',
  '我总结一下',
  '我先整理一下',
  '回到刚才的话题',
];

function firstMatched(text: string, markers: readonly string[]): string | undefined {
  return markers.find((marker) => text.includes(marker));
}

/**
 * 审计来访者台词的可朗读性与语域。
 *
 * 软信号不升级为硬违约：临床上“边界感”“原生家庭”这类词的确可能从来访者嘴里说出来，
 * 机械拦截会误伤真实表达；这里只用于观察 prompt 是否把台词带成了咨询师报告。
 */
export function inspectVisitorRegister(text: string): RegisterAuditResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { violations: [], signals: [] };

  const violations: RegisterViolation[] = [];
  if (firstMatched(trimmed, PROMPT_ECHO_MARKERS)) {
    violations.push('prompt_echo');
  } else if (hasStageDirection(trimmed) || firstMatched(trimmed, INTERFACE_MARKERS)) {
    violations.push('non_spoken_text');
  }

  if (violations.includes('prompt_echo')) {
    return { violations, signals: [] };
  }

  const signals: RegisterSignal[] = [];
  if (firstMatched(trimmed, CLINICAL_JARGON)) signals.push('clinical_jargon');
  if (firstMatched(trimmed, BOOKISH_CONNECTIVES)) signals.push('bookish_connective');
  if (firstMatched(trimmed, ASSISTANT_TONE)) signals.push('assistant_tone');
  if (firstMatched(trimmed, META_SPEECH)) signals.push('meta_speech');

  return { violations, signals };
}
