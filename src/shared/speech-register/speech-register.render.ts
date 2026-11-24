// AF-462 · 语域指纹渲染与有限漂移.
// 边界: 纯函数, 零 IO / 零 LLM; 只把结构化语域压成自然语言块.
// 不写"文化水平低 / 农村人 / 底层"等评价标签; 教育只映射词汇预算, 地域只做词汇层.

import type {
  DirectnessLevel,
  EducationBand,
  PolitenessLevel,
  RegionMacro,
  SocialContext,
  SpeechRegister,
  SpeechRegisterDriftState,
} from './speech-register.types.js';

/**
 * 按本轮 BDI 状态做有限漂移.
 *
 * 只允许三项变化: 话量(句长) / 抽象词预算 / 直接度.
 * 教育背景、地域、标志词、生活锚点、方言强度不漂移; 风险轮压制全部风味.
 */
export function resolveCurrentRegister(base: SpeechRegister, state: SpeechRegisterDriftState): SpeechRegister {
  const risk = state.riskLevel !== 'none';
  const shortBecauseResistance = state.resistance.verbal >= 0.6 ? 2 : 0;
  const shortBecauseArousal = state.emotion.arousal >= 0.65 ? 2 : 0;
  const shortBecauseRisk = risk ? 3 : 0;
  const averageSentenceLength = clamp(
    base.syntax.averageSentenceLength - shortBecauseResistance - shortBecauseArousal - shortBecauseRisk,
    5,
    30,
  );
  const abstractTermBudget = clamp(
    base.vocabulary.abstractTermBudget -
      (state.emotion.arousal >= 0.65 ? 0.08 : 0) -
      (state.resistance.depth >= 0.6 ? 0.05 : 0) -
      (risk ? 0.1 : 0),
    0,
    1,
  );
  const directness = resolveDirectness(base.stance.directness, state, risk);
  return {
    ...base,
    identity: { ...base.identity },
    socialContext: [...base.socialContext],
    vocabulary: {
      ...base.vocabulary,
      abstractTermBudget,
      jargonBudget: risk ? 0 : base.vocabulary.jargonBudget,
      concreteAnchorDensity: clamp(
        base.vocabulary.concreteAnchorDensity + (risk ? 0.1 : 0) + (state.resistance.verbal >= 0.6 ? 0.05 : 0),
        0,
        1,
      ),
    },
    syntax: {
      ...base.syntax,
      averageSentenceLength,
      fragmentTolerance: clamp(base.syntax.fragmentTolerance + (risk ? 0.1 : 0), 0, 1),
    },
    stance: { ...base.stance, directness },
    anchors: [...base.anchors],
    signatureLexicon: risk ? [] : [...base.signatureLexicon],
    avoidLexicon: [...base.avoidLexicon],
    sampleLines: risk ? [] : [...base.sampleLines],
    antiSampleLines: [...base.antiSampleLines],
  };
}

/**
 * 渲染语域块; 无状态时渲染基础语域, 有状态时先做有限漂移.
 *
 * 输出约 250-350 字; 不含角色代号 / 原始枚举 / 舞台指令.
 */
export function renderSpeechRegisterBlock(register: SpeechRegister, state?: SpeechRegisterDriftState): string {
  const current = state === undefined ? register : resolveCurrentRegister(register, state);
  const lines: string[] = ['你说话的样子（只影响用词，不改内容和情绪）：'];
  lines.push(
    educationLine(current.identity.educationBand),
    ...socialLines(current.socialContext).slice(0, 1),
    regionLine(current.identity.regionMacro, current.dialectStrength),
    ...vocabularyLines(current).slice(0, 2),
    ...syntaxLines(current).slice(0, 1),
    stanceLine(current.stance.directness, current.stance.politeness, current.stance.disclosure),
  );
  if (current.anchors.length > 0) {
    lines.push(`你嘴边常挂着的事：${current.anchors.slice(0, 2).map(quote).join('、')}。`);
  }
  if (current.signatureLexicon.length > 0) {
    lines.push(`你偶尔会说${current.signatureLexicon.slice(0, 2).map(quote).join('、')}这样的词，一轮最多一两个。`);
  }
  if (current.avoidLexicon.length > 0) {
    lines.push(`你不会说${current.avoidLexicon.slice(0, 2).map(quote).join('、')}这类词，也不会像助手一样总结对方。`);
  }
  if (current.sampleLines.length > 0) {
    lines.push(`比如你可能会说：${current.sampleLines.slice(0, 1).map(quote).join('')}`);
  }
  if (current.antiSampleLines.length > 0) {
    lines.push(`不要这样说：${current.antiSampleLines.slice(0, 1).map(quote).join('')}`);
  }
  return lines.filter((line) => line.length > 0).join('\n');
}

function resolveDirectness(base: DirectnessLevel, state: SpeechRegisterDriftState, risk: boolean): DirectnessLevel {
  if (risk || state.emotion.label === 'angry') return 'direct';
  if (state.emotion.label === 'ashamed' || state.emotion.label === 'guarded' || state.emotion.label === 'hurt') return 'indirect';
  return base;
}

function educationLine(band: EducationBand): string {
  if (band === 'basic') return '你说话更靠具体的事，不太爱讲抽象道理；说感受时，常常先讲发生了什么。';
  if (band === 'vocational') return '你学过一门手艺，讲话直接，喜欢用干活、修东西这类事打比方。';
  if (band === 'postgraduate') return '你偶尔会用专业词，但会看对方接不接得住；接不住就换成大白话。';
  return '你能把事情理出条理，但不会把话讲成报告。';
}

function socialLines(contexts: readonly SocialContext[]): readonly string[] {
  const lines: string[] = [];
  for (const context of contexts.slice(0, 2)) {
    const line = socialLine(context);
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

function socialLine(context: SocialContext): string {
  if (context === 'shift_work') return '你的日子常按班次算，夜里上班、白天补觉，话题离不开排班和困。';
  if (context === 'service_sector') return '你一天要接很多人的话，回家反而不想再解释。';
  if (context === 'student') return '你生活里主要是课、论文、兼职，钱和时间都算得比较细。';
  if (context === 'part_time') return '你除了上课还做兼职，时间被切得很碎。';
  if (context === 'caregiver') return '你回家还要管家里人的事，自己的话常往后放。';
  if (context === 'small_town') return '你生活的地方不大，熟人社会，说话会顾着人情。';
  if (context === 'rural_migrant') return '你很多事靠自己扛，不太愿意麻烦别人。';
  if (context === 'retired') return '你退下来以后日子慢了，但有些旧事还是会反复想起来。';
  if (context === 'unemployed') return '你现在没上班，日子不太有准点，也不太想解释近况。';
  return '你平常打交道的是同事、客户和家人，话题多落在通勤、房租、绩效这些事上。';
}

function regionLine(region: RegionMacro, strength: number): string {
  if (region === 'unknown' || strength < 0.25) return '你基本说普通话，偶尔带一两个地方词，但不带口音。';
  const label: Readonly<Record<Exclude<RegionMacro, 'unknown'>, string>> = {
    north: '北方',
    east: '江浙沪',
    south: '南方',
    central: '中原',
    northeast: '东北',
    west: '西南',
  };
  return `你说话会带一点${label[region]}的生活词，只是个别词，不带口音。`;
}

function vocabularyLines(register: SpeechRegister): readonly string[] {
  const lines: string[] = [];
  const { abstractTermBudget, jargonBudget, concreteAnchorDensity } = register.vocabulary;
  if (abstractTermBudget < 0.35) lines.push('你很少用大词，能把事说清楚就行。');
  else if (abstractTermBudget >= 0.55) lines.push('你偶尔会总结两句，但不会一开口就分析。');
  else lines.push('你能把事说明白，但不会刻意拔高。');
  if (jargonBudget < 0.2) lines.push('你不太用行业术语或心理词。');
  else if (jargonBudget >= 0.45) lines.push('工作里的术语会冒出来，你会马上换成对方听得懂的说法。');
  if (concreteAnchorDensity >= 0.6) lines.push('你说话爱带具体细节：几点、几个人、吃了什么。');
  else if (concreteAnchorDensity <= 0.3) lines.push('你不太爱铺细节，几句话就说结论。');
  return lines;
}

function syntaxLines(register: SpeechRegister): readonly string[] {
  const lines: string[] = [];
  const { averageSentenceLength, fragmentTolerance, connectiveUse } = register.syntax;
  if (averageSentenceLength <= 11) lines.push('句子偏短，常常半句就停。');
  else if (averageSentenceLength <= 15) lines.push('句子不长，想到哪说到哪。');
  else lines.push('你能说完整的长句，但不会句句都圆。');
  if (fragmentTolerance >= 0.5) lines.push('偶尔改口、重复，别每句都顺。');
  if (connectiveUse < 0.3) lines.push('少用“因为所以”，事情按发生的顺序说。');
  else if (connectiveUse >= 0.45) lines.push('你会用“其实”“但是”转一下，但别写成文章。');
  return lines;
}

function stanceLine(directness: DirectnessLevel, politeness: PolitenessLevel, disclosure: SpeechRegister['stance']['disclosure']): string {
  return `${DIRECTNESS_LINE[directness]}；${POLITENESS_LINE[politeness]}；${DISCLOSURE_LINE[disclosure]}。`;
}

const DIRECTNESS_LINE: Readonly<Record<DirectnessLevel, string>> = {
  direct: '有不满你会直接说，不绕太多',
  indirect: '有不满你先绕一下，或者用“算了”带过去',
  guarded: '你不太直接说要求，先看对方反应',
};

const POLITENESS_LINE: Readonly<Record<PolitenessLevel, string>> = {
  deferential: '你说话客气，常把“可能”“会不会”挂嘴边',
  polite: '你说话留面子，不轻易顶人',
  plain: '你说话不客套，但也不冲',
};

const DISCLOSURE_LINE: Readonly<Record<SpeechRegister['stance']['disclosure'], string>> = {
  guarded: '私事你只说一半，等对方问',
  open: '你比较愿意讲自己的事，但也会停',
  selective: '你愿意说，但会挑能说的说',
};

function quote(text: string): string {
  return `“${text}”`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
