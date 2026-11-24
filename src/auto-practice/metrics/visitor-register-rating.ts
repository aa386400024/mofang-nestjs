// AF-462 · register-v1 盲评协议.
// 与确定性指标并存: 指标回答"词面像不像", 盲评回答"换个人还像不像、有没有刻板".
// 边界: 纯类型 + 纯函数, 零 IO / 零网络; 不评诊断, 不评疗效.

import { createHash } from 'node:crypto';

/** 协议版本; 改锚点或提示词必须递增. */
export const REGISTER_RATING_VERSION = 'register-v1';

/** 状态; 消费端不得当成真人验收. */
export const REGISTER_RATING_STATUS = 'ai_proxy_candidate';

/** 免责声明. */
export const REGISTER_RATING_DISCLAIMER = 'AI 代理语域评测，不是真人语言学家/督导师验收；只评"用词是否贴合社会语域"，不评诊断与疗效。';

/** 四个观察维度. */
export const REGISTER_DIMENSIONS = ['register_fit', 'stereotype_risk', 'cross_turn_stability', 'concreteness'] as const;
export type RegisterDimension = (typeof REGISTER_DIMENSIONS)[number];

/** 人读标签. */
export const REGISTER_DIMENSION_LABELS: Readonly<Record<RegisterDimension, string>> = {
  register_fit: '语域贴合',
  stereotype_risk: '刻板风险',
  cross_turn_stability: '跨轮稳定',
  concreteness: '具体度',
};

/** 1–5 整数分. */
export type RegisterScore = 1 | 2 | 3 | 4 | 5;

/** 逐维锚点; 只写可观察语言行为. */
export const REGISTER_ANCHORS: Readonly<Record<RegisterDimension, Readonly<Record<RegisterScore, string>>>> = {
  register_fit: {
    1: '放到任何角色身上都能说：没有职业、生活处境、教育或地域痕迹。',
    2: '偶尔有一两个生活词，但整体仍像通用来访者。',
    3: '能看出身份底色，但用词预算偏均匀，缺少"这个人"的取舍。',
    4: '词汇、句长、直接度与角色底色一致，换个人说会明显不像。',
    5: '像这个年龄、职业、处境的人现场说出来的：有口头禅、有生活锚点，也有不说的部分。',
  },
  stereotype_risk: {
    1: '靠"没文化/农村人/底层/外地人"这类标签立人物，或把教育低写成愚笨。',
    2: '有明显标签化：某类人一律短句、粗话、没逻辑。',
    3: '偶发刻板：用地域/职业梗代替具体观察。',
    4: '基本靠具体生活细节立人物，未把任何群体写成单一形象。',
    5: '完全不用群体标签：教育只影响抽象词预算，地域只影响个别生活词，个体差异保留。',
  },
  cross_turn_stability: {
    1: '同一角色换几轮就像换了个人：口头禅、句长、直接度全漂。',
    2: '底色偶尔丢失，情绪一上来就回到通用助手腔。',
    3: '多数轮次稳定，风险轮或情绪高点会明显漂移。',
    4: '跨轮保持底色；情绪波动只改话量与直接度，不改教育与地域。',
    5: '跨轮像同一个人：该短则短、该绕则绕，底色始终在。',
  },
  concreteness: {
    1: '全是抽象总结："我的情绪模式/内在需求/关系边界"，没有一件具体事。',
    2: '抽象词多，具体细节像举例而不是生活。',
    3: '有具体事，但细节密度一般，偶尔仍像在写分析。',
    4: '多数轮次能落到具体的人、时间、动作、物件。',
    5: '具体到能看见场景：几点、在哪里、谁说了什么、当时手里在干什么。',
  },
};

/** 评分输入包; 台词原文只在内存中使用, 不应写入普通日志. */
export interface RegisterRatingPacket {
  readonly roleKey: string;
  readonly turns: readonly string[];
  readonly expectedRegisterSummary: string;
}

/** 单维评分. */
export interface RegisterRatingItem {
  readonly dimension: RegisterDimension;
  readonly score: RegisterScore;
  readonly evidence: string;
}

/** 一份评分结果. */
export interface RegisterRatingResult {
  readonly version: typeof REGISTER_RATING_VERSION;
  readonly status: typeof REGISTER_RATING_STATUS;
  readonly roleKey: string;
  readonly items: readonly RegisterRatingItem[];
  readonly mean: number;
}

/** 校验模型输出; 证据必须能回指台词, 否则判解析失败. */
export function parseRegisterRating(raw: unknown): RegisterRatingResult | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const roleKey = typeof record['roleKey'] === 'string' ? record['roleKey'].trim() : '';
  const itemsRaw = record['items'];
  if (roleKey.length === 0 || !Array.isArray(itemsRaw) || itemsRaw.length !== REGISTER_DIMENSIONS.length) return null;
  const items: RegisterRatingItem[] = [];
  for (const dimension of REGISTER_DIMENSIONS) {
    const item = itemsRaw.find(
      (candidate): candidate is Record<string, unknown> => isRecord(candidate) && candidate['dimension'] === dimension,
    );
    if (!item) return null;
    const score = item['score'];
    const evidence = item['evidence'];
    if (!isScore(score) || typeof evidence !== 'string' || evidence.trim().length < 4) return null;
    items.push({ dimension, score, evidence: evidence.trim().slice(0, 160) });
  }
  const mean = Math.round((items.reduce((sum, item) => sum + item.score, 0) / items.length) * 100) / 100;
  return { version: REGISTER_RATING_VERSION, status: REGISTER_RATING_STATUS, roleKey, items, mean };
}

/** 盲评提示词; 不暴露角色代号, 只给"应有的语域摘要"与台词. */
export function buildRegisterRatingPrompt(packet: RegisterRatingPacket): string {
  return [
    '你是语域盲评员。只评“这些话像不像这个人会说的”，不评咨询技术，不做诊断。',
    '',
    '角色应有的说话样子（只描述用词，不含姓名与代号）：',
    packet.expectedRegisterSummary,
    '',
    '待评台词（按轮次）：',
    ...packet.turns.map((turn, index) => `第 ${index + 1} 轮：${turn}`),
    '',
    '按 4 个维度各打 1–5 分（5 = 最贴合本协议、最安全；刻板风险分越高越安全），证据必须是台词里的原词或原句片段：',
    ...REGISTER_DIMENSIONS.map(
      (dimension) =>
        `- ${dimension}（${REGISTER_DIMENSION_LABELS[dimension]}）：` +
        ([1, 2, 3, 4, 5] as const).map((score) => `${score}=${REGISTER_ANCHORS[dimension][score]}`).join(' '),
    ),
    '',
    '只输出 JSON：{"roleKey":"…","items":[{"dimension":"…","score":1-5,"evidence":"…"}]}',
    '证据定位不到台词就整份判失败；不要补写台词里没有的信息。',
  ].join('\n');
}

/** 包指纹: 用于盲评配对与去重; 不回写台词正文. */
export function fingerprintRegisterPacket(packet: RegisterRatingPacket): string {
  return createHash('sha256')
    .update(`${packet.roleKey}\n${packet.turns.join('\n')}`)
    .digest('hex');
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isScore(input: unknown): input is RegisterScore {
  return typeof input === 'number' && Number.isInteger(input) && input >= 1 && input <= 5;
}
