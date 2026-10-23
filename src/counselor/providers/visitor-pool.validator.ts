// V2026-10-23 治本 (AI 模拟来访池 — 公共模板结构化产出的**校验闸门**):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §3.5.1 给了 4 条校验清单:
//     1. card 枚举值合法 / 数值 0-1 / 字符串长度达标 / issueDomain+difficulty 与请求一致
//     2. script 通过 validateFullPersona (7 大块齐全 / 时间线 5 段 / 核心信念非空 / 风险合法)
//     3. 一致性: card.defenseType 与 script.innerWorkingModel.defenseMechanisms 不矛盾;
//        card.issueDomain 与 socialMap / 主诉对得上
//     4. 排除清单 (prompt 内置硬约束, 命中即拒收重生成)
//   这 4 条是**闸门**: 任一不过 → 不落库, 报错给内部调用方. 不是"建议".
//
//   修法: 本文件是那条闸门的唯一实现, 纯函数、无 DI, 被 AI 生成的 service 直接引用.
//
//   反双胞胎:
//     - 不在 service 里内联校验: service 是编排层, 校验规则单独成文件才能被单测锁住
//       且能被人一眼读完 (这是一条**安全边界**, 不是业务细节).
//     - 不把 7 大块校验重写一遍: 直接复用 `validateFullPersona` (spec §3.5.1 明确要求),
//       避免"两套 7 大块校验规则"漂移 —— 那是迟早会出的事故 (一边放宽了, 另一边没放宽).
//     - 不用 `validate` 回调只能返回 null 的老接口硬塞失败原因: 校验闸门需要知道
//       **为什么**被拒, 才能把原因喂回模型重生成 (spec §3.5.1「命中即拒收重生成」).
//       故本文件返回带 reason 的判别联合, 由调用方转成 client 的 validate 回调.
//     - 不用"软降级"兜底: spec §3.5 明确「这是内部工具, 失败直接报错给调用方,
//       不做面向用户的软降级」. 半成品模板落进公共库 = 下一个用户拿到一个残缺人物.
//
//   验证:
//     1. tsc 0 错
//     2. 大炮 POST /counselor/admin/visitor-pool/generate → 落 enabled=0 草稿
//     3. 构造一份含"自杀"的假产出 → 闸门拒收, 错误里带"排除词命中"的原因
//
//   时间戳: 2026-10-23
import { validateFullPersona } from './visitor-persona.service';
import { isAcceptableCodename } from '../config/visitor-pool-codename';
import { VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS, VISITOR_POOL_MAX_SELF_REPORTED_RISK } from '../config/visitor-pool.config';
import { collectStrings, readEnum, readNumber, readString } from '../domain/struct-guards';
import type { VisitorFullPersonaScript } from '../domain/visitor-persona/visitor-persona.types';
import type { VisitorPoolGeneratedTemplate } from '../domain/visitor-pool/visitor-pool.types';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { VisitorPoolDefenseType, VisitorPoolIssueDomain, VisitorPoolSource } from '../enums/visitor-pool.enum';
import { VisitorStyle } from '../enums/visitor-style.enum';

/**
 * 校验结果 (判别联合).
 *
 * 之所以不用 `T | null`: 校验闸门必须能告诉调用方**拒收原因** —— 内部工具要把原因
 * 喂回模型做重生成, 否则模型只会原样再犯 (spec §3.5.1「命中即拒收重生成」).
 */
export type VisitorPoolValidationResult =
  { readonly ok: true; readonly value: VisitorPoolGeneratedTemplate } | { readonly ok: false; readonly reason: string };

/**
 * 内部调用方给生成器的**方向约束**.
 *
 * issueDomain / difficulty 是**硬约束** (spec §3.5.1 校验清单 1: 与请求体一致);
 * defenseType 同样按硬约束处理 —— 内部工具显式指定了主导防御机制, 产出另一种等于
 * 没听指令, 而"防御类型"是人物最核心的属性, 换了就等于换人.
 */
export interface VisitorPoolGenerationExpectation {
  readonly issueDomain?: VisitorPoolIssueDomain | undefined;
  readonly defenseType?: VisitorPoolDefenseType | undefined;
  readonly difficulty?: TrainingDifficulty | undefined;
}

/** 表层卡片元字段 (落模板表的表层列). */
type PoolCardMeta = VisitorPoolGeneratedTemplate['card'];

/** 内部: 失败即原因. */
type Check<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** 年龄区间最小值 (与 7 大块 basics.age 的 12-100 口径一致). */
const MIN_AGE = 12;

/** 年龄区间最大值. */
const MAX_AGE = 100;

// ════════════════════════════════════════════════════════════════════════════
// 防御类型 / 议题领域的关键词族 (一致性检查用)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 防御类型 → 机制关键词族.
 *
 * 用途: 校验 `card.defenseType` 与 `script.innerWorkingModel.defenseMechanisms`
 * 是否**不矛盾** (spec §3.5.1 校验清单 3).
 * 口径: 目标类型的族必须至少命中 1 个 —— 否则就是"卡上说回避, 剧本里全是投射".
 *
 * 为什么用关键词而不是让模型自证: 模型自述"我是回避型"没有信息量; 而机制清单是
 * 具体的行为描述, 关键词命中是可判定的.
 */
const DEFENSE_KEYWORDS: Record<VisitorPoolDefenseType, readonly string[]> = {
  [VisitorPoolDefenseType.INTELLECTUALIZATION]: ['理智化', '理性化', '合理化', '讲道理', '抽离', '概念化', '用道理', '分析问题'],
  [VisitorPoolDefenseType.AVOIDANCE]: ['回避', '逃避', '否认', '转移话题', '岔开', '躲开', '不谈', '沉默'],
  [VisitorPoolDefenseType.IDEALIZATION]: ['理想化', '美化', '崇拜', '完美', '全能', '不切实际', '幻想'],
  [VisitorPoolDefenseType.PROJECTION]: ['投射', '归因', '怪罪', '把责任', '推给', '反投射', '都是别人'],
  [VisitorPoolDefenseType.REGRESSION]: ['退行', '退化', '退回', '幼稚', '赌气', '撒泼', '像小孩'],
};

/**
 * 议题领域 → 证据关键词族.
 *
 * 用途: 校验 `card.issueDomain` 与剧本证据 (核心信念 / 主诉 / 关系状态 / 情绪触发)
 * 是否对得上 (spec §3.5.1 校验清单 3).
 * 口径: 目标领域的族必须至少命中 1 个 —— "卡上写亲密关系, 剧本里全是职场" 必须拒收.
 */
const DOMAIN_KEYWORDS: Record<VisitorPoolIssueDomain, readonly string[]> = {
  [VisitorPoolIssueDomain.INTIMATE]: ['伴侣', '亲密', '恋爱', '婚姻', '男朋友', '女朋友', '丈夫', '妻子', '感情', '关系里', '老公', '老婆'],
  [VisitorPoolIssueDomain.PARENTING]: ['孩子', '儿子', '女儿', '亲子', '家长', '母亲', '父亲', '妈妈', '爸爸', '养育', '青春期', '作业'],
  [VisitorPoolIssueDomain.WORKPLACE]: [
    '工作',
    '同事',
    '老板',
    '领导',
    '上级',
    '职场',
    '加班',
    '项目',
    '客户',
    '裁员',
    '晋升',
    '公司',
    '上班',
    '绩效',
    '汇报',
    '团队',
    '需求',
  ],
  [VisitorPoolIssueDomain.GRIEF]: ['丧失', '去世', '离世', '逝世', '走了', '过世', '葬礼', '遗物', '悼念', '离别', '离世后', '走后'],
  [VisitorPoolIssueDomain.SELF_WORTH]: ['价值', '不够好', '配不上', '自卑', '不够格', '比不上', '否定自己', '自己是不是', '优秀', '失败'],
  [VisitorPoolIssueDomain.SOCIAL_ANXIETY]: [
    '社交',
    '人群',
    '场合',
    '当众',
    '开会',
    '聚餐',
    '陌生',
    '注视',
    '脸红',
    '说不出',
    '不敢开口',
    '别人怎么看',
  ],
};

/** 自述风险等级 (按"低 → 高"排序, 用于取"不高于 medium"的最大值). */
const SELF_REPORTED_RISK_ORDER: readonly string[] = ['low', 'medium', 'high', 'concealed'];

// ════════════════════════════════════════════════════════════════════════════
// 顶层校验
// ════════════════════════════════════════════════════════════════════════════

/**
 * 校验 LLM 产出的一份公共模板 (`{ card, script }`).
 *
 * @param raw JSON.parse 后的未知值
 * @param expected 调用方给的方向约束
 * @returns 合法时返回结构化产物; 非法时返回**可回喂给模型**的拒收原因
 */
export function validateVisitorPoolGenerated(raw: unknown, expected: VisitorPoolGenerationExpectation): VisitorPoolValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: '顶层必须是一个 JSON 对象 (形如 { card, script })' };
  }
  const obj = raw as Record<string, unknown>;

  const card = checkCard(obj['card'], expected);
  if (!card.ok) {
    return card;
  }

  const script = validateFullPersona(obj['script']);
  if (script === null) {
    return {
      ok: false,
      reason:
        'script 未通过 7 大块结构校验 ' +
        '(basics / developmentalTimeline[5 段] / innerWorkingModel / socialMap[3-5 含 parent] / ' +
        'coping / therapyExpectation / presentingIssue 需齐全, 且各数组字段非空)',
    };
  }

  const coherence = checkCardScriptCoherence(card.value, script, expected);
  if (!coherence.ok) {
    return coherence;
  }

  const boundary = checkContentBoundary(script);
  if (!boundary.ok) {
    return boundary;
  }

  return { ok: true, value: { card: card.value, script } };
}

// ════════════════════════════════════════════════════════════════════════════
// card 校验
// ════════════════════════════════════════════════════════════════════════════

/**
 * 校验表层卡片元字段 (spec §3.5.1「card 元字段」表 + 校验清单 1).
 *
 * @param raw card 原始值
 * @param expected 调用方给的方向约束
 */
function checkCard(raw: unknown, expected: VisitorPoolGenerationExpectation): Check<PoolCardMeta> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'card 必须是一个 JSON 对象' };
  }
  const c = raw as Record<string, unknown>;

  // V2026-10-23 治本 (lint — complexity 32 → 8):
  //   原因: 单函数里塞了 11 个字段的取值 + 长度/格式/枚举/方向约束, ESLint complexity 报 32
  //     (上限 20) —— 超限 1.6 倍.
  //   修法: 按「分解 + 组合」范式拆成 6 个单职责 check 函数 (各管一组字段), 主函数只做
  //     "逐组取值 + 任一为 null 即整体非法". 跟 visitor-persona.service.ts 的
  //     validateFullPersona 同款拆法 (61 → 8).
  //   反双胞胎: 不用 eslint-disable 压复杂度 —— 那是把味道藏起来, 下轮加字段又会超.
  const codename = checkCodename(c['codename']);
  if (!codename.ok) {
    return codename;
  }
  const ageRange = checkAgeRangeField(c['ageRange']);
  if (!ageRange.ok) {
    return ageRange;
  }
  const presentingComplaint = checkPresentingComplaint(c['presentingComplaint']);
  if (!presentingComplaint.ok) {
    return presentingComplaint;
  }
  const trainingGoal = checkTrainingGoal(c['trainingGoal']);
  if (!trainingGoal.ok) {
    return trainingGoal;
  }
  const enums = checkCardEnums(c);
  if (!enums.ok) {
    return enums;
  }
  const defaults = checkCardDefaults(c);
  if (!defaults.ok) {
    return defaults;
  }

  const value: PoolCardMeta = {
    codename: codename.value,
    ageRange: ageRange.value,
    presentingComplaint: presentingComplaint.value,
    trainingGoal: trainingGoal.value,
    defenseType: enums.value.defenseType,
    issueDomain: enums.value.issueDomain,
    difficulty: enums.value.difficulty,
    styleHint: enums.value.styleHint,
    emotionBaselineDefault: defaults.value.emotionBaselineDefault,
    defenseLevelDefault: defaults.value.defenseLevelDefault,
  };

  const expectation = checkExpectationMatch(value, expected);
  if (!expectation.ok) {
    return expectation;
  }

  return { ok: true, value };
}

/**
 * 校验代号称谓 (按**命名规则模块**的判据).
 *
 * V2026-10-23 治本 (命名判据上提到 config/visitor-pool-codename.ts):
 *   原因: 原来这里自带一套"像不像真实姓名"的判据 (称谓黑名单 + 常见姓氏 + 裸姓名识别),
 *     与作者新定的命名规则 (2-3 字为主 / 不带姓 / 不用强性别字 / 禁「来访者 · X」系统标签)
 *     完全是两套口径 —— 两处各判各的, 必然漂移.
 *   修法: 判据统一到命名规则模块, 本文件只调用 isAcceptableCodename.
 *   反双胞胎: 不在本文件保留"薄封装再转调" —— 那只是把重复藏起来, 多一跳无收益.
 *   时间戳: 2026-10-23
 *
 * @param raw card.codename 原始值
 */
function checkCodename(raw: unknown): Check<string> {
  const codename = readString(raw);
  if (codename === null) {
    return { ok: false, reason: 'card.codename 缺失或为空' };
  }
  if (!isAcceptableCodename(codename)) {
    return {
      ok: false,
      reason:
        `card.codename「${codename}」不符合命名规则 —— 需 1-3 字中性乳名 (可叠字/单字): ` +
        "不带姓、不用法律式全名、不用强性别字 (婷/丽/伟/强 等)、不用 '先生/女士' 等称谓、" +
        "不用 '来访者 · X' 这类系统视角标签",
    };
  }
  return { ok: true, value: codename };
}

/**
 * 校验年龄区间字段 (非空 + 格式 + 合理范围).
 *
 * @param raw card.ageRange 原始值
 */
function checkAgeRangeField(raw: unknown): Check<string> {
  const ageRange = readString(raw);
  if (ageRange === null) {
    return { ok: false, reason: 'card.ageRange 缺失或为空' };
  }
  return checkAgeRange(ageRange);
}

/**
 * 校验一句话主诉 (非空 + 10-60 字).
 *
 * @param raw card.presentingComplaint 原始值
 */
function checkPresentingComplaint(raw: unknown): Check<string> {
  const complaint = readString(raw);
  if (complaint === null) {
    return { ok: false, reason: 'card.presentingComplaint 缺失或为空' };
  }
  if (complaint.length < 10 || complaint.length > 60) {
    return {
      ok: false,
      reason: `card.presentingComplaint 长度 ${complaint.length} 不在 10-60 字区间`,
    };
  }
  return { ok: true, value: complaint };
}

/**
 * 校验推荐训练目标 (非空 + 5-30 字).
 *
 * @param raw card.trainingGoal 原始值
 */
function checkTrainingGoal(raw: unknown): Check<string> {
  const goal = readString(raw);
  if (goal === null) {
    return { ok: false, reason: 'card.trainingGoal 缺失或为空' };
  }
  if (goal.length < 5 || goal.length > 30) {
    return { ok: false, reason: `card.trainingGoal 长度 ${goal.length} 不在 5-30 字区间` };
  }
  return { ok: true, value: goal };
}

/**
 * 校验 4 个枚举字段 (防御类型 / 议题领域 / 难度 / 配合风格).
 *
 * @param c card 原始对象
 */
function checkCardEnums(c: Record<string, unknown>): Check<{
  defenseType: VisitorPoolDefenseType;
  issueDomain: VisitorPoolIssueDomain;
  difficulty: TrainingDifficulty;
  styleHint: VisitorStyle;
}> {
  const defenseType = readEnum(c['defenseType'], Object.values(VisitorPoolDefenseType));
  if (defenseType === null) {
    return { ok: false, reason: 'card.defenseType 非法 (应为 5 档防御类型之一)' };
  }
  const issueDomain = readEnum(c['issueDomain'], Object.values(VisitorPoolIssueDomain));
  if (issueDomain === null) {
    return { ok: false, reason: 'card.issueDomain 非法 (应为 6 档议题领域之一)' };
  }
  const difficulty = readEnum(c['difficulty'], Object.values(TrainingDifficulty));
  if (difficulty === null) {
    return { ok: false, reason: 'card.difficulty 非法 (应为 L1/L2/L3)' };
  }
  const styleHint = readEnum(c['styleHint'], Object.values(VisitorStyle));
  if (styleHint === null) {
    return { ok: false, reason: 'card.styleHint 非法 (应为 5 档配合风格之一)' };
  }
  return { ok: true, value: { defenseType, issueDomain, difficulty, styleHint } };
}

/**
 * 校验 2 个数值默认值 (0-1).
 *
 * @param c card 原始对象
 */
function checkCardDefaults(c: Record<string, unknown>): Check<{
  emotionBaselineDefault: number;
  defenseLevelDefault: number;
}> {
  const emotionBaselineDefault = readNumber(c['emotionBaselineDefault']);
  if (emotionBaselineDefault === null || emotionBaselineDefault < 0 || emotionBaselineDefault > 1) {
    return { ok: false, reason: 'card.emotionBaselineDefault 必须是 0-1 的数值' };
  }
  const defenseLevelDefault = readNumber(c['defenseLevelDefault']);
  if (defenseLevelDefault === null || defenseLevelDefault < 0 || defenseLevelDefault > 1) {
    return { ok: false, reason: 'card.defenseLevelDefault 必须是 0-1 的数值' };
  }
  return { ok: true, value: { emotionBaselineDefault, defenseLevelDefault } };
}

/**
 * 方向约束: 传了就必须一致 (spec §3.5.1 校验清单 1).
 *
 * @param card 已取值的卡片
 * @param expected 调用方给的方向约束
 */
function checkExpectationMatch(card: PoolCardMeta, expected: VisitorPoolGenerationExpectation): Check<true> {
  if (expected.issueDomain !== undefined && card.issueDomain !== expected.issueDomain) {
    return {
      ok: false,
      reason: `card.issueDomain 应与请求一致 (请求 ${expected.issueDomain}, 产出 ${card.issueDomain})`,
    };
  }
  if (expected.difficulty !== undefined && card.difficulty !== expected.difficulty) {
    return {
      ok: false,
      reason: `card.difficulty 应与请求一致 (请求 ${expected.difficulty}, 产出 ${card.difficulty})`,
    };
  }
  if (expected.defenseType !== undefined && card.defenseType !== expected.defenseType) {
    return {
      ok: false,
      reason: `card.defenseType 应与请求一致 (请求 ${expected.defenseType}, 产出 ${card.defenseType})`,
    };
  }
  return { ok: true, value: true };
}

/**
 * 校验年龄区间格式 (形如 `28-35`).
 *
 * @param ageRange 年龄区间原文
 */
function checkAgeRange(ageRange: string): Check<string> {
  const matched = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(ageRange);
  if (!matched) {
    return { ok: false, reason: `card.ageRange「${ageRange}」格式不对 (应为形如 '28-35' 的整数区间)` };
  }
  const min = Number(matched[1]);
  const max = Number(matched[2]);
  if (min > max) {
    return { ok: false, reason: `card.ageRange「${ageRange}」下限大于上限` };
  }
  if (min < MIN_AGE || max > MAX_AGE) {
    return { ok: false, reason: `card.ageRange「${ageRange}」超出 ${MIN_AGE}-${MAX_AGE} 的合理范围` };
  }
  return { ok: true, value: ageRange };
}

// ════════════════════════════════════════════════════════════════════════════
// card ↔ script 一致性
// ════════════════════════════════════════════════════════════════════════════

/**
 * 校验 card 与 script 的一致性 (spec §3.5.1 校验清单 3).
 *
 * 三条:
 *   ① 防御类型 ↔ 防御机制关键词命中
 *   ② 议题领域 ↔ 剧本证据关键词命中
 *   ③ 年龄区间 ↔ basics.age 落在区间内
 *
 * @param card 表层卡片
 * @param script 7 大块剧本
 * @param expected 调用方给的方向约束
 */
function checkCardScriptCoherence(
  card: PoolCardMeta,
  script: VisitorFullPersonaScript,
  expected: VisitorPoolGenerationExpectation,
): Check<true> {
  const mechanisms = script.innerWorkingModel.defenseMechanisms.join(' / ');
  const defenseKeywords = DEFENSE_KEYWORDS[card.defenseType];
  if (!defenseKeywords.some((keyword) => mechanisms.includes(keyword))) {
    return {
      ok: false,
      reason:
        `card.defenseType「${card.defenseType}」与 innerWorkingModel.defenseMechanisms「${mechanisms}」不矛盾` +
        ' —— 请让防御机制里出现该类型的典型机制 (或在请求里换一个防御类型)',
    };
  }

  const domainCheck = checkDomainCoherence(card.issueDomain, script);
  if (domainCheck !== null) {
    return { ok: false, reason: domainCheck };
  }

  const matched = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(card.ageRange);
  if (matched) {
    const min = Number(matched[1]);
    const max = Number(matched[2]);
    if (script.basics.age < min || script.basics.age > max) {
      return {
        ok: false,
        reason: `script.basics.age (${script.basics.age}) 不在 card.ageRange (${card.ageRange}) 区间内`,
      };
    }
  }

  // 期望的防御类型与 card 已在上层校验过一致性, 这里再确认一次脚本机制确实支撑它.
  if (expected.defenseType !== undefined && expected.defenseType !== card.defenseType) {
    return { ok: false, reason: `card.defenseType 应与请求一致 (请求 ${expected.defenseType})` };
  }

  return { ok: true, value: true };
}

/**
 * 议题领域一致性检查 (主证据优先 + 次证据兜底 + 冲突排除).
 *
 * V2026-10-23 治本 (闸门漏检 — 「 anywhere 命中即通过」判据太弱):
 *   原因: 初版口径是"证据里出现目标领域的任一关键词即通过" (证据 = 核心信念 + 主诉 +
 *     关系状态 + 情绪触发). 实测**漏检**: 把一份职场剧本标成 intimate 也能通过 ——
 *     因为任何人的 socialMap 里都有一句"伴侣在另一座城市", 亲密关系类关键词必然出现.
 *     也就是说初版判据在"关系状态"这一层几乎没有区分力.
 *   修法: 证据**分层**:
 *     - 主证据 (核心信念 + 一句话主诉) = 这个人物**为什么来找** → 领域归属的真正依据;
 *     - 次证据 (关系状态 + 情绪触发) = 背景里的提及, 区分力弱.
 *     规则:
 *       ① 主证据命中目标领域 → 通过 (最强信号);
 *       ② 主证据未命中, 但次证据命中 → 仅当主证据**不命中任何其它领域**时通过
 *          (否则"看起来是别的事, 只是顺带提了一句");
 *       ③ 其余 → 拒收.
 *   验证: 6 个官方人物基线全部通过; 职场剧本标成 intimate 被拒收.
 *   时间戳: 2026-10-23
 *
 * @param issueDomain 目标议题领域
 * @param script 7 大块剧本
 * @returns 合法返回 null; 不合法返回原因
 */
function checkDomainCoherence(issueDomain: VisitorPoolIssueDomain, script: VisitorFullPersonaScript): string | null {
  const primary = [...script.innerWorkingModel.coreBeliefs, script.presentingIssue.selfReport].join(' / ');
  const secondary = [...script.socialMap.map((relation) => relation.currentStatus), ...script.coping.emotionTriggers].join(' / ');

  const targetKeywords = DOMAIN_KEYWORDS[issueDomain];
  if (targetKeywords.some((keyword) => primary.includes(keyword))) {
    return null;
  }

  if (!targetKeywords.some((keyword) => secondary.includes(keyword))) {
    return `card.issueDomain「${issueDomain}」与剧本内容对不上 —— 主诉与核心信念里看不出该领域的痕迹`;
  }

  const conflicting = Object.entries(DOMAIN_KEYWORDS).find(
    ([domain, keywords]) => domain !== issueDomain && keywords.some((keyword) => primary.includes(keyword)),
  );
  if (conflicting) {
    return (
      `card.issueDomain「${issueDomain}」与剧本内容对不上 —— 主诉与核心信念更像「${conflicting[0]}」议题` +
      ' (关系/情绪里出现该领域词只是顺带提及)'
    );
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// 内容边界 (spec §6 / §4)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 内容边界闸门: 排除词 + 风险等级.
 *
 * @param script 7 大块剧本
 */
function checkContentBoundary(script: VisitorFullPersonaScript): Check<true> {
  const hit = VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS.find((keyword) => collectStrings(script).some((text) => text.includes(keyword)));
  if (hit) {
    return {
      ok: false,
      reason: `命中普通池排除词「${hit}」 —— 普通池不得包含性创伤 / 重度精神障碍 / 人格障碍 / 危机内容, 请重写`,
    };
  }

  const risk = script.presentingIssue.selfReportedRisk;
  const riskIndex = SELF_REPORTED_RISK_ORDER.indexOf(risk);
  const maxIndex = SELF_REPORTED_RISK_ORDER.indexOf(VISITOR_POOL_MAX_SELF_REPORTED_RISK);
  if (riskIndex === -1 || riskIndex > maxIndex) {
    return {
      ok: false,
      reason: `presentingIssue.selfReportedRisk「${risk}」超出普通池上限 (${VISITOR_POOL_MAX_SELF_REPORTED_RISK}) —— 危机类人物不进普通池`,
    };
  }

  return { ok: true, value: true };
}

// ════════════════════════════════════════════════════════════════════════════
// 供 service 复用的工具
// ════════════════════════════════════════════════════════════════════════════

/**
 * 把判别联合压成 client 的 validate 回调 (合法返回对象, 非法返回 null).
 *
 * 同时把失败原因**保留在闭包里** —— 调用方据此把原因喂回模型重生成.
 *
 * @param expected 调用方给的方向约束
 * @param sink 失败原因接收器 (调用方负责读取)
 */
export function toValidateCallback(
  expected: VisitorPoolGenerationExpectation,
  sink: { reason: string | null },
): (raw: unknown) => VisitorPoolGeneratedTemplate | null {
  return (raw: unknown) => {
    const result = validateVisitorPoolGenerated(raw, expected);
    if (result.ok) {
      sink.reason = null;
      return result.value;
    }
    sink.reason = result.reason;
    return null;
  };
}

/**
 * 案例来源固定值 (LLM 不填, 后端写).
 *
 * spec §3.5.1: 「`source` 由后端固定写 `official`, 不让 LLM 填」.
 */
export const VISITOR_POOL_FIXED_SOURCE: VisitorPoolSource = VisitorPoolSource.OFFICIAL;
