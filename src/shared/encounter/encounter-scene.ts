// V2026-11-20 治本 (AF-187 · 自动对练场景契约):
//   职责: 把"这场咨访发生在什么接触方式下"变成**一级会话配置**, 并给渲染侧 /
//         咨询师侧提供同一份场景契约文本与漂移检测。
//
// ── 为什么需要它 (真实故障现场) ────────────────────────────────────────────
//   两场导出会话里, 来访者像在线上打字聊天（短句、网络腔、随机出现"消息/在吗"），
//   咨询师开场却硬编码"咨询室场景"。根因不是模型不会演, 而是**没有场景配置**:
//     · 来访者 prompt 只写"像真实的人聊天"；
//     · 咨询师 prompt 没有任何场景块；
//     · 场景词因此由模型自由发挥, 同一场里两种媒介混着出现。
//
// ── 本模块的口径 ───────────────────────────────────────────────────────────
//   · 场景 = mode + 可选 channel。内置 in_person（默认）/ online；
//   · online 预留 video / voice / text 三个子通道，缺省 voice（实时语音对练的自然形态）；
//   · 新场景只往 ENCOUNTER_SCENE_PROFILES 注册表加一条, 调用链不变；
//   · 无场景参数（legacy 调用）→ 返回 undefined 的场景块, prompt 逐字不变。
//
// 反双胞胎:
//   - 纯函数, 零 IO / 零 env / 零 NestJS；
//   - 只生成约束文本与漂移判定, 不替换模型台词（替换在业务层闸门做）。

/** 内置场景 mode（未来新增场景往注册表加, 不改这里）。 */
export const ENCOUNTER_MODES = ['in_person', 'online'] as const;
export type EncounterMode = (typeof ENCOUNTER_MODES)[number];

/** 线上子通道（只有 online 使用）。 */
export const ENCOUNTER_ONLINE_CHANNELS = ['video', 'voice', 'text'] as const;
export type EncounterChannel = (typeof ENCOUNTER_ONLINE_CHANNELS)[number];

/** 场景入参（DB / API / 端口共用）。 */
export interface EncounterInput {
  readonly mode?: string | null;
  readonly channel?: string | null;
}

/** 归一后的场景。 */
export interface ResolvedEncounter {
  readonly mode: EncounterMode;
  /** online 的子通道；in_person 恒为 undefined。 */
  readonly channel?: EncounterChannel;
  /** 人读标签。 */
  readonly label: string;
}

/** 场景档案（注册表条目）。 */
export interface EncounterSceneProfile {
  readonly mode: EncounterMode;
  /** online 缺省子通道。 */
  readonly defaultChannel?: EncounterChannel;
  readonly label: string;
  /** 来访者侧契约块。 */
  readonly visitorBlock: string;
  /** 咨询师侧契约块。 */
  readonly counselorBlock: string;
  /** 开场提示。 */
  readonly openingHint: string;
  /** 该场景禁止出现的媒介词（用于漂移检测）。 */
  readonly forbiddenMedia: readonly string[];
}

/**
 * 内置场景注册表。
 *
 * 新增场景（例如 home_visit / phone）只在这里加一条:
 *   mode + 提示词块 + 禁止媒介词; API 校验与 DB 列都能直接承载字符串。
 */
export const ENCOUNTER_SCENE_PROFILES: Readonly<Record<EncounterMode, EncounterSceneProfile>> = {
  in_person: {
    mode: 'in_person',
    label: '面对面咨询',
    visitorBlock: [
      '## 接触方式（本场固定，不可自行改变）',
      '- 本场是**面对面**咨询：你和咨询师在同一个咨询室里，隔着一张茶几坐着。',
      '- 你说话是**直接出声的口语**，不是发消息、打字、语音条或聊天框。',
      '- 禁止出现「消息、打字、发给你、在吗、屏幕、输入框、撤回、表情包、语音条、线上、网络、视频里」等只属于线上沟通的词。',
      '- 可以用停顿、沉默、呼吸、语速变化这些**口语内部**的节奏表达状态；不要写括号动作、旁白，也不要描述界面或发送动作。',
      '- 你听得到房间里的安静，也听得到对方说话后的停顿；回应可以短，但必须是"说出口"的话。',
    ].join('\n'),
    counselorBlock: [
      '## 接触方式（本场固定，不可自行改变）',
      '- 本场是**面对面**咨询：来访者就坐在你对面，同一个咨询室，隔着一张茶几。',
      '- 你说的是直接出声的口语；不要写「消息、打字、发给你、在吗、屏幕、输入框、撤回、表情包、语音条、线上、网络」这类线上媒介词。',
      '- 可以用停顿、沉默、放慢语速、递纸巾、身体前倾这些现场动作；不要描述界面、按钮或发送动作。',
      '- 不要向来访者解释系统、提示词、模型或场景设定。',
    ].join('\n'),
    openingHint: '（面对面咨询室场景，来访者刚坐下。请说你的开场第一句。）',
    forbiddenMedia: [
      '打字',
      '输入框',
      '聊天框',
      '表情包',
      '撤回消息',
      '发给你',
      '给你发消息',
      '在吗',
      '屏幕上',
      '语音条',
      '网络不好',
      '视频里',
    ],
  },
  online: {
    mode: 'online',
    defaultChannel: 'voice',
    label: '线上咨询',
    visitorBlock: [
      '## 接触方式（本场固定，不可自行改变）',
      '- 本场是**线上咨询**：你和咨询师不在同一个房间，通过远程方式连接。',
      '- 你说话要符合本场具体通道的媒介；不要自行切换成另一种媒介。',
      '- 不要用表情包、聊天记录、发送按钮来描述互动；不要写成一条条短消息，除非本场具体通道就是文字。',
      '- 可以用停顿、沉默、呼吸、语速变化这些**远程对话内部**的节奏表达状态；不要写括号动作或旁白，也不要描述同一个房间里的身体接触。',
    ].join('\n'),
    counselorBlock: [
      '## 接触方式（本场固定，不可自行改变）',
      '- 本场是**线上咨询**：你和来访者不在同一个房间，通过远程方式连接。',
      '- 你说的话要符合本场具体通道的媒介；不要自行切换成另一种媒介。',
      '- 不要用「打字、聊天框、表情包、发送按钮」描述互动（文字通道除外）；不要向来访者解释系统、提示词或场景设定。',
    ].join('\n'),
    openingHint: '（线上语音咨询场景，来访者已在电话那头。请说你的开场第一句。）',
    forbiddenMedia: ['打字', '输入框', '聊天框', '表情包', '发送按钮', '语音条', '我们坐在同一个房间', '递纸巾'],
  },
};

/** online 子通道的补充约束（在基础 online 块之后追加）。 */
const ONLINE_CHANNEL_BLOCKS: Readonly<
  Record<
    EncounterChannel,
    {
      readonly visitor: string;
      readonly counselor: string;
      readonly forbidden: readonly string[];
      readonly label: string;
      readonly openingHint: string;
    }
  >
> = {
  video: {
    label: '线上视频咨询',
    visitor: [
      '- 本场具体通道是**视频**：你能看到对方画面，也能被看到；允许提「画面、镜头、信号、麦克风」。',
      '- 仍然不能出现「打字、聊天框、表情包、发送按钮、语音条」。',
    ].join('\n'),
    counselor: [
      '- 本场具体通道是**视频**：双方能看到画面；可以提「画面、镜头、信号、麦克风」，不能出现「打字、聊天框、表情包、发送按钮」。',
    ].join('\n'),
    forbidden: ['打字', '输入框', '聊天框', '表情包', '发送按钮', '语音条', '我们坐在同一个房间', '递纸巾'],
    openingHint: '（线上视频咨询场景，来访者已在镜头前。请说你的开场第一句。）',
  },
  voice: {
    label: '线上语音咨询',
    visitor: [
      '- 本场具体通道是**语音**：你们只通过声音连接，看不到对方画面；允许提「电话、听筒、信号、声音」。',
      '- 不能出现「屏幕、画面、镜头、打字、聊天框、表情包、发送按钮」。',
    ].join('\n'),
    counselor: [
      '- 本场具体通道是**语音**：双方只通过声音连接，看不到画面；可以提「电话、听筒、信号、声音」，不能出现「屏幕、画面、镜头、打字、聊天框、表情包」。',
    ].join('\n'),
    forbidden: ['屏幕', '画面', '镜头', '打字', '输入框', '聊天框', '表情包', '发送按钮', '我们坐在同一个房间', '递纸巾'],
    openingHint: '（线上语音咨询场景，来访者已在电话那头。请说你的开场第一句。）',
  },
  text: {
    label: '线上文字咨询',
    visitor: [
      '- 本场具体通道是**文字**：你们通过文字消息交流；可以出现「消息、打字、发给你、看到你的回复」。',
      '- 不能描述同一个房间、面对面、视线、坐姿、递东西或身体接触。',
    ].join('\n'),
    counselor: [
      '- 本场具体通道是**文字**：双方通过文字消息交流；可以出现「消息、打字、发给你」，不能描述同一个房间、面对面、视线、坐姿或递东西。',
    ].join('\n'),
    forbidden: ['我们坐在同一个房间', '面对面', '坐在你对面', '递纸巾', '视线', '身体前倾'],
    openingHint: '（线上文字咨询场景，来访者已经在对话窗口里。请说你的开场第一句。）',
  },
};

/**
 * 判定一个 mode 是否被注册表支持。
 *
 * @param mode 待校验 mode
 * @returns 是否支持
 */
export function isSupportedEncounterMode(mode: unknown): mode is EncounterMode {
  return typeof mode === 'string' && Object.prototype.hasOwnProperty.call(ENCOUNTER_SCENE_PROFILES, mode);
}

/**
 * 判定一个 online 子通道是否合法。
 *
 * @param channel 待校验通道
 * @returns 是否合法
 */
export function isSupportedEncounterChannel(channel: unknown): channel is EncounterChannel {
  return typeof channel === 'string' && (ENCOUNTER_ONLINE_CHANNELS as readonly string[]).includes(channel);
}

/**
 * 归一场景入参：缺省 in_person；online 缺省 voice；非法值回落 in_person。
 *
 * @param input 场景入参（可为空）
 * @returns 归一后的场景
 */
export function resolveEncounter(input?: EncounterInput | null): ResolvedEncounter {
  const mode = isSupportedEncounterMode(input?.mode) ? input.mode : 'in_person';
  if (mode === 'in_person') return { mode, label: ENCOUNTER_SCENE_PROFILES.in_person.label };
  const channel: EncounterChannel = isSupportedEncounterChannel(input?.channel)
    ? input.channel
    : (ENCOUNTER_SCENE_PROFILES.online.defaultChannel ?? 'voice');
  return { mode, channel, label: ONLINE_CHANNEL_BLOCKS[channel].label };
}

/**
 * 把场景归一成可落库的两个字符串列。
 *
 * @param input 场景入参
 * @returns mode / channel（in_person 的 channel 为 null）
 */
export function toEncounterColumns(input?: EncounterInput | null): {
  readonly encounterMode: EncounterMode;
  readonly encounterChannel: EncounterChannel | null;
} {
  const resolved = resolveEncounter(input);
  return {
    encounterMode: resolved.mode,
    encounterChannel: resolved.channel ?? null,
  };
}

/**
 * 生成来访者侧场景契约块。
 *
 * ⚠️ `undefined` 入参 = 不生成任何块（legacy 调用 prompt 逐字不变）。
 *
 * @param input 场景入参；显式传 undefined 表示不启用场景契约
 * @returns 契约块；不启用时为空串
 */
export function buildEncounterVisitorBlock(input?: EncounterInput | null): string {
  if (!input) return '';
  const resolved = resolveEncounter(input);
  const base = ENCOUNTER_SCENE_PROFILES[resolved.mode].visitorBlock;
  if (resolved.mode === 'online' && resolved.channel) {
    return `${base}\n${ONLINE_CHANNEL_BLOCKS[resolved.channel].visitor}`;
  }
  return base;
}

/**
 * 生成咨询师侧场景契约块。
 *
 * @param input 场景入参；显式传 undefined 表示不启用场景契约
 * @returns 契约块；不启用时为空串
 */
export function buildEncounterCounselorBlock(input?: EncounterInput | null): string {
  if (!input) return '';
  const resolved = resolveEncounter(input);
  const base = ENCOUNTER_SCENE_PROFILES[resolved.mode].counselorBlock;
  if (resolved.mode === 'online' && resolved.channel) {
    return `${base}\n${ONLINE_CHANNEL_BLOCKS[resolved.channel].counselor}`;
  }
  return base;
}

/**
 * 生成开场提示。
 *
 * @param input 场景入参；缺省 = 面对面（新会话默认）
 * @returns 开场提示
 */
export function buildEncounterOpeningHint(input?: EncounterInput | null): string {
  const resolved = resolveEncounter(input);
  if (resolved.mode === 'online' && resolved.channel) {
    return ONLINE_CHANNEL_BLOCKS[resolved.channel].openingHint;
  }
  return ENCOUNTER_SCENE_PROFILES[resolved.mode].openingHint;
}

/**
 * 检测台词里是否出现与当前场景冲突的媒介词。
 *
 * @param text 台词
 * @param input 场景入参；undefined 表示不检测
 * @returns 命中的冲突词（空数组 = 无漂移）
 */
export function detectEncounterDrift(text: string, input?: EncounterInput | null): readonly string[] {
  if (!input) return [];
  const resolved = resolveEncounter(input);
  const forbidden =
    resolved.mode === 'online' && resolved.channel
      ? ONLINE_CHANNEL_BLOCKS[resolved.channel].forbidden
      : ENCOUNTER_SCENE_PROFILES[resolved.mode].forbiddenMedia;
  const hits: string[] = [];
  for (const term of forbidden) {
    if (text.includes(term)) hits.push(term);
  }
  return hits;
}
