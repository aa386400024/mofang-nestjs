// V2026-11-10 建立 (WP-J P1d · #4 · 来访者行为词表 · 纯模块):
//   职责: 把**文本层词表与打标逻辑**从 CLI 脚本里抽出来, 让它**可被单测覆盖**.
//
//   为什么抽出来 (不是把脚本当模块直接测):
//     ~~~visitor-quality-audit.ts~~~ 末尾是 `await main();` —— 一 import 就跑整场审计
//     (连 DB + 读几百份逐字稿), 单测没法 import 它.
//     纯逻辑抽到这里, 脚本只留 CLI 编排 (读目录 / 查库 / 打印) —— 口径与实现同源.
//
//   边界 (为什么这个文件里没有别的东西):
//     · 零 IO、零 DB、零网络 —— 纯函数, 便于单测与复算;
//     · 词表是**工程种子值, 非临床标定** (与脚本同款纪律).
//
//   验证: npx vitest run test/quality/p1d-visitor-quality-lexicon.spec.ts

/** 来访者台词的行为标签 (词表推断, 仅作交叉验证). */
export type BehaviorLabel = 'approach' | 'avoid' | 'attack' | 'appease' | 'neutral';

/**
 * 行为标签词表 —— ⚠️ 工程种子值, 非临床标定. 只用于交叉验证内核信号.
 *
 * WP-J P1d · #4: 四个标签各扩容了一倍 (求证/讨好/怕被抛弃的常见说法补进 appease/avoid),
 *   目的是把"能打上标签的轮次占比"从 5.7% 抬到 15% 以上 —— 覆盖率太低时,
 *   后面的"主导标签命中率"根本没法算 (脚本有 30% 门禁).
 */
export const LABEL_LEXICON: Readonly<Record<Exclude<BehaviorLabel, 'neutral'>, readonly string[]>> = {
  approach: ['我想说', '我想告诉', '我其实', '我一直', '我在意', '我在乎', '我想让你', '我怕你', '能不能多', '我希望', '我想试试', '我想聊', '我愿意', '我想弄明白', '我最近', '我昨天', '说出来', '跟别人说', '我想知道', '我一直在想', '我想要', '我想变', '我觉得', '我觉得自己', '我会', '我想过', '我打算', '我承认', '我想跟', '我其实想', '我可以', '我明白'],
  avoid: ['不想说', '不愿意说', '算了', '不聊', '跳过', '没什么好说', '说不上来', '不知道说什么', '别问了', '换个话题', '不太好说', '没什么事', '我不想', '以后再说', '说不了', '不想提', '不用管我', '没什么好聊的', '先不说', '没什么', '不想', '不知道', '说不上', '不太想', '不太愿意', '也差不多', '没什么好聊', '不想聊'],
  attack: ['你根本', '没用', '你懂什么', '凭什么', '烦死', '你到底', '有什么用', '都是你', '你不懂', '你也就', '我不需要', '你别管我', '关你什么事', '你们都一样', '别装', '你就是', '我讨厌', '我受够', '不公平', '凭什么要', '根本没用', '跟我有什么关系'],
  appease: ['对不起', '是我不好', '我是不是', '麻烦你', '你别生气', '我尽量', '都可以', '听你的', '不好意思', '我是不是太', '没关系', '都行', '你忙就先', '我没事', '不用麻烦', '我来就好', '按你说的', '我配合', '你决定就好', '我怕你生气', '你说了算', '还行', '还好', '一般', '都听你的', '麻烦你了', '要不然', '随你', '我怕添麻烦', '别嫌我'],
};

/**
 * anxious 行为通道三维度 (WP-J P1d · #4).
 *
 * 为什么单列一套 (不并进上面的四行为标签):
 *   ① **语义不同**: 四行为标签判的是"这一轮在接近 / 回避 / 攻击 / 讨好",
 *      是**通用**人际行为; 三维度判的是焦虑型依恋**特有**的临床行为
 *      (反复求证 / 怕添麻烦 / 被抛弃预演) —— 合并会让"主导标签"的判据漂移;
 *   ② **内核侧看不见**: 焦虑型的"求证"在内核指标上完全可能仍是 阻抗 0% / 探索 0%
 *      (WP-J P1c 实测: 接线前 anxious 三角色就是 0% / 0%), 所以必须**单列文本层指标**,
 *      否则"anxious 通道生效没有"这个问题用现有指标根本答不了;
 *   ③ **词表是工程种子值, 非临床标定** —— 与四行为标签同款纪律.
 */
export interface AnxiousChannelHits {
  /** 求证 —— 反复确认咨询师对自己的看法. */
  readonly seekReassure: number;
  /** 讨好 —— 怕添麻烦 / 抢先让步. */
  readonly appease: number;
  /** 怕被抛弃 —— 预演离开 / 试探对方会不会走. */
  readonly abandonment: number;
}

/** anxious 行为通道三维度词表 (键与 AnxiousChannelHits 一一对应). */
export const ANXIOUS_CHANNEL_LEXICON: Readonly<Record<keyof AnxiousChannelHits, readonly string[]>> = {
  seekReassure: ['真的吗', '是不是', '会不会', '你觉得我', '你会不会', '我这样对吗', '我说得对吗', '我是不是很', '会不会太', '你觉得呢', '会不会觉得', '这样对吗', '对不对', '是这样吗', '你不生气吧', '你不会觉得', '是不是我太', '会不会嫌', '你觉得怎么样', '我说的对吗', '是吗', '对吧', '你觉得我这样'],
  appease: ['对不起', '是我不好', '麻烦你', '你别生气', '我尽量', '都可以', '听你的', '不好意思', '我是不是太', '没关系', '都行', '你忙就先', '我没事', '不用麻烦', '我来就好', '按你说的', '我配合', '你决定就好', '我怕你生气', '我不麻烦你', '你说了算'],
  abandonment: ['你会走', '别走', '你会离开', '不要走', '你会嫌弃', '你会不会不要我', '是不是不要我了', '我是不是很麻烦', '你会不会烦我', '你会不会觉得烦', '万一你走了', '我怕你走', '你是不是想离开', '你会丢下我', '我怕被丢下', '我怕你不要我', '我是不是累赘', '万一', '别人都', '他们都会', '要是我不在', '谁都不'],
};

/**
 * 一句台词是否命中某组关键词.
 *
 * @param text 台词
 * @param words 关键词组
 * @returns 命中任意一个即 true
 */
export function hitsAny(text: string, words: readonly string[]): boolean {
  for (const word of words) if (text.includes(word)) return true;
  return false;
}

/**
 * 给一句台词打行为标签 (命中词最多的那个标签; 一个都没命中 = neutral).
 *
 * @param text 台词
 * @returns 行为标签
 */
export function labelOf(text: string): BehaviorLabel {
  let best: BehaviorLabel = 'neutral';
  let bestScore = 0;
  for (const [label, keywords] of Object.entries(LABEL_LEXICON)) {
    let hits = 0;
    for (const keyword of keywords) if (text.includes(keyword)) hits += 1;
    if (hits > bestScore) {
      bestScore = hits;
      best = label as BehaviorLabel;
    }
  }
  return best;
}

/**
 * 一句台词命中了哪几个 anxious 通道维度 (每个维度记 1 次).
 *
 * @param text 台词
 * @returns 三维度命中数
 */
export function anxiousDimensionsOf(text: string): AnxiousChannelHits {
  return {
    seekReassure: hitsAny(text, ANXIOUS_CHANNEL_LEXICON.seekReassure) ? 1 : 0,
    appease: hitsAny(text, ANXIOUS_CHANNEL_LEXICON.appease) ? 1 : 0,
    abandonment: hitsAny(text, ANXIOUS_CHANNEL_LEXICON.abandonment) ? 1 : 0,
  };
}

/**
 * 一句台词是否被"四行为标签 ∪ anxious 三维度"覆盖到.
 *
 * @param text 台词
 * @returns 覆盖到即 true
 */
export function isCoveredTurn(text: string): boolean {
  if (labelOf(text) !== 'neutral') return true;
  const hits = anxiousDimensionsOf(text);
  return hits.seekReassure + hits.appease + hits.abandonment > 0;
}
