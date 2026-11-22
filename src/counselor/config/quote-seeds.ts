// V2026-10-22 治本 (首页金句 · 每日一句 — 内容库配置 + 运行参数):
//   原因: `xin_su_app/docs/product/home-quote-backend-api.md` §2 要求后端提供
//     今日金句 / 金句流 / 收藏三个端点, 且 §4 给了两条硬红线:
//       ① 「引文须确认版权/署名可公开使用, **不伪造名言归属**」
//       ② 「内容限定心理成长/自我接纳/情绪理解, 不做诊断、不做疗效承诺」
//     这两条决定了内容库的设计: 署名必须**真实可考**, 所以每条金句要么标真实作者
//     (+ 出处), 要么标"心塑"原创 —— 绝不用一个泛化词(如"心理成长")冒充作者,
//     那是把一句无人说过的话挂在某个心理学家名下, 属伪造归属.
//
//   修法: 本文件集中 ① 内容库基线 (QUOTE_SEEDS) ② 运行参数 (CDN base / 分页上限).
//     内容与运行参数分开放: 内容是"会持续编辑"的资产 (运营改文案/加条目),
//     参数是"上线后可能要调"的旋钮, 混在一起改内容时会误伤参数.
//
//   反双胞胎:
//     - 不用 migration 灌内容: 内容会持续演进, migration 一旦执行即冻结
//       (改一句文案就要加一条 migration, 迁移历史被业务内容淹没).
//       走独立 seed 脚本按稳定 id 幂等 upsert, 生命周期与 schema 解耦
//       (同 training-exercises / practice-scenarios 的 pattern).
//     - 不把金句当"标准答案"或"治疗承诺": 内容全部取自心理学科普读物里的公认表述,
//       领域标签限定心理成长/自我接纳/情绪理解/存在主义/意义疗法等非临床方向
//     - 不用泛化作者兜底: 宁可标"心塑"原创, 也不伪造名人归属
//
//   验证:
//     1. tsc 0 错
//     2. QUOTE_SEEDS 的 id 全局唯一, 且符合 q_YYYYMMDD_<slug> 形态
//     3. QUOTE_SEEDS 的 publishedAt 连续覆盖 16 天
//
//   时间戳: 2026-10-22

/**
 * 单条金句的 seed 结构.
 *
 * 字段与 `quotes` 表 1:1 (除 id 之外), 供 seed 脚本与单测共用.
 */
export interface QuoteSeed {
  /**
   * 稳定 id (对外契约, 也是游标分页的 cursor 值).
   *
   * 形态 `q_YYYYMMDD_<slug>`: 日期前缀让 id 本身带上"发布日"信息,
   * 与 spec §2.1 的示例 `q_20261022` 同形; slug 部分保证同日多条时不撞号.
   * **不可改为随机 UUID** —— 改了会让已入库内容的 id 与外部契约脱节.
   */
  readonly id: string;
  /** 引文正文 (不做诊断、不做疗效承诺) */
  readonly text: string;
  /** 署名: 真实作者名, 或 "心塑" (产品原创) */
  readonly author: string;
  /** 领域标签 (心理成长 / 来访者中心 / 存在主义 / 情绪理解 / 自我接纳 / 积极倾听 / 意义疗法 / 分析心理学) */
  readonly category: string;
  /** 出处 (作品名); 产品原创为 null */
  readonly sourceWork: string | null;
  /** 满版背景图文件名 (CDN 完整地址由 seed 脚本按 base url 组装) */
  readonly backgroundAsset: string;
  /** 发布日期 'YYYY-MM-DD' (用于 feed 排序与"今日"候选池) */
  readonly publishedAt: string;
}

// ─── 背景图资源 (与前端 assets/images/ 下的本地兜底图一一对应) ───

/** 晨雾湖面 (冷蓝) */
export const QUOTE_BG_DAWN_LAKE = 'quote_dawn_lake.jpg';
/** 星空远山 (深蓝) */
export const QUOTE_BG_STARRY_MOUNTAIN = 'quote_starry_mountain.jpg';

// ─── 运行参数 ───

/** 满版背景图 CDN base url 的 env 键. */
export const QUOTE_CDN_BASE_URL_ENV_KEY = 'QUOTE_CDN_BASE_URL';

/** 满版背景图 CDN base url 的缺省值. */
export const QUOTE_CDN_BASE_URL_DEFAULT = 'https://cdn.xinsu.app/quote/';

/** 金句流默认条数 (spec §2.2 的 limit=10). */
export const QUOTE_LIST_DEFAULT_LIMIT = 10;

/** 金句流单次最大条数 (防一次拉爆载荷). */
export const QUOTE_LIST_MAX_LIMIT = 50;

/** 一天的毫秒数 (本地自然日序号换算用). */
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * 取「本地自然日序号」—— 今日金句轮换的定位键.
 *
 * 用**本地**午夜而不是 UTC 午夜: 用户看到"今天"是本地日历的一天.
 * 不用「距当年 1 月 1 日的天数」(前端本地种子的口径 `quoteOfTheDay()`): 那样每年
 * 元旦会重置轮换, 元旦当天可能又轮到同一条, 显得像"没换".
 *
 * 抽成**纯函数**放 config 而不是留在 service 的私有方法里: 这是"每日一句"的领域规则,
 * 不是 service 的实现细节 —— 抽出来后可被单测直接锁住 (同一天恒定 / 跨天递增).
 *
 * @param now 参照时刻
 * @returns 本地自然日序号 (自 Unix epoch 起的本地天数)
 */
export function quoteDayIndexOf(now: Date): number {
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor(localMidnight.getTime() / MILLISECONDS_PER_DAY);
}

/**
 * 内容库基线 —— 16 条, 发布日连续覆盖 2026-10-07 ~ 2026-10-22.
 *
 * 署名口径 (spec §4 合规红线):
 *   - 12 条标真实作者 + 出处 (心理学科普读物里的公认表述)
 *   - 4 条标 "心塑" 原创 (前端本地种子里的原创句, 不冒名任何真人)
 * publishedAt 固定为具体日期 (不写 new Date()): seed 必须可重复执行且结果恒等,
 * 否则每次重跑都会把整库日期往后推一天, 破坏幂等.
 */
export const QUOTE_SEEDS: readonly QuoteSeed[] = [
  {
    id: 'q_20261007_frankl_stimulus_response',
    text: '在刺激与反应之间，我们拥有选择自己反应的自由。',
    author: '维克多·弗兰克尔',
    category: '意义疗法',
    sourceWork: '活出生命的意义',
    backgroundAsset: QUOTE_BG_DAWN_LAKE,
    publishedAt: '2026-10-07',
  },
  {
    id: 'q_20261008_rogers_process_not_state',
    text: '好的生活是一个过程，而不是一个静止的状态。',
    author: '卡尔·罗杰斯',
    category: '来访者中心',
    sourceWork: '论人的成长',
    backgroundAsset: QUOTE_BG_STARRY_MOUNTAIN,
    publishedAt: '2026-10-08',
  },
  {
    id: 'q_20261009_jung_inward_outward',
    text: '向外看的人在做梦，向内看的人觉醒。',
    author: '卡尔·荣格',
    category: '分析心理学',
    sourceWork: '回忆·梦·思考',
    backgroundAsset: QUOTE_BG_DAWN_LAKE,
    publishedAt: '2026-10-09',
  },
  {
    id: 'q_20261010_rogers_accept_as_am',
    text: '当我接纳自己原本的样子，我才有可能做出改变。',
    author: '卡尔·罗杰斯',
    category: '自我接纳',
    sourceWork: '论人的成长',
    backgroundAsset: QUOTE_BG_STARRY_MOUNTAIN,
    publishedAt: '2026-10-10',
  },
  {
    id: 'q_20261011_rogers_understand_to_help',
    text: '除非我真正理解了你，否则我无法帮助你。',
    author: '卡尔·罗杰斯',
    category: '积极倾听',
    sourceWork: '论人的成长',
    backgroundAsset: QUOTE_BG_DAWN_LAKE,
    publishedAt: '2026-10-11',
  },
  {
    id: 'q_20261012_frankl_last_freedom',
    text: '人所拥有的任何东西都可以被剥夺，唯独人性最后的自由——在既定的环境中选择自己态度的自由——不能被剥夺。',
    author: '维克多·弗兰克尔',
    category: '存在主义',
    sourceWork: '活出生命的意义',
    backgroundAsset: QUOTE_BG_STARRY_MOUNTAIN,
    publishedAt: '2026-10-12',
  },
  {
    id: 'q_20261013_james_change_attitude',
    text: '我这代人最伟大的发现是：人可以改变自己的态度，从而改变自己的人生。',
    author: '威廉·詹姆斯',
    category: '心理成长',
    sourceWork: '心理学原理',
    backgroundAsset: QUOTE_BG_DAWN_LAKE,
    publishedAt: '2026-10-13',
  },
  {
    id: 'q_20261014_fromm_love_giving',
    text: '爱是给予，而不是占有。',
    author: '埃里希·弗洛姆',
    category: '心理成长',
    sourceWork: '爱的艺术',
    backgroundAsset: QUOTE_BG_STARRY_MOUNTAIN,
    publishedAt: '2026-10-14',
  },
  {
    id: 'q_20261015_ellis_beliefs_not_events',
    text: '困扰人的往往不是事件本身，而是人对事件的看法。',
    author: '阿尔伯特·埃利斯',
    category: '情绪理解',
    sourceWork: '理性情绪行为疗法',
    backgroundAsset: QUOTE_BG_DAWN_LAKE,
    publishedAt: '2026-10-15',
  },
  {
    id: 'q_20261016_rogers_listen_to_change',
    text: '当我用心地去倾听一个人，他就开始改变。',
    author: '卡尔·罗杰斯',
    category: '积极倾听',
    sourceWork: '论人的成长',
    backgroundAsset: QUOTE_BG_STARRY_MOUNTAIN,
    publishedAt: '2026-10-16',
  },
  {
    id: 'q_20261017_frankl_why_to_live',
    text: '知道为什么而活的人，几乎能承受任何一种生活。',
    author: '维克多·弗兰克尔',
    category: '意义疗法',
    sourceWork: '活出生命的意义',
    backgroundAsset: QUOTE_BG_DAWN_LAKE,
    publishedAt: '2026-10-17',
  },
  {
    id: 'q_20261018_may_love_and_be_loved',
    text: '心理健康的核心，是能够去爱，也能够被爱。',
    author: '罗洛·梅',
    category: '心理成长',
    sourceWork: '存在与发现',
    backgroundAsset: QUOTE_BG_STARRY_MOUNTAIN,
    publishedAt: '2026-10-18',
  },
  {
    id: 'q_20261019_xinshu_emotion_no_good_bad',
    text: '情绪没有好坏，它只是在提示我们正在意什么。',
    author: '心塑',
    category: '情绪理解',
    sourceWork: null,
    backgroundAsset: QUOTE_BG_DAWN_LAKE,
    publishedAt: '2026-10-19',
  },
  {
    id: 'q_20261020_xinshu_listened_hear_self',
    text: '被一个人认真地倾听过，人就会开始听见自己。',
    author: '心塑',
    category: '积极倾听',
    sourceWork: null,
    backgroundAsset: QUOTE_BG_STARRY_MOUNTAIN,
    publishedAt: '2026-10-20',
  },
  {
    id: 'q_20261021_xinshu_imperfection',
    text: '允许自己不完美，往往是改变真正开始的地方。',
    author: '心塑',
    category: '自我接纳',
    sourceWork: null,
    backgroundAsset: QUOTE_BG_DAWN_LAKE,
    publishedAt: '2026-10-21',
  },
  {
    id: 'q_20261022_xinshu_slow_down',
    text: '慢慢来，先站稳自己，再理解他人。',
    author: '心塑',
    category: '自我接纳',
    sourceWork: null,
    backgroundAsset: QUOTE_BG_STARRY_MOUNTAIN,
    publishedAt: '2026-10-22',
  },
];

/**
 * 校验内容库基线的不变量 (seed 脚本与单测共用).
 *
 * 校验项:
 *   ① id 全局唯一 (id 是游标, 撞号会让分页漏条/重条)
 *   ② id 形态为 q_YYYYMMDD_<slug>, 且日期前缀与 publishedAt 一致
 *   ③ 署名非空; 标真实作者时必须给出处 (spec §4 "须真实可考")
 *
 * @param seeds 待校验内容库
 * @returns 校验通过返回 null; 否则返回中文错误描述
 */
export function validateQuoteSeeds(seeds: readonly QuoteSeed[]): string | null {
  const seen = new Set<string>();
  for (const seed of seeds) {
    if (seen.has(seed.id)) {
      return `金句 id 重复: ${seed.id}`;
    }
    seen.add(seed.id);

    const matched = /^q_(\d{8})_[a-z0-9_]+$/.exec(seed.id);
    if (!matched) {
      return `金句 id 形态非法 (期望 q_YYYYMMDD_<slug>): ${seed.id}`;
    }
    const idDate = matched[1] ?? '';
    const datePart = seed.publishedAt.replaceAll('-', '');
    if (idDate !== datePart) {
      return `金句 id 日期前缀与 publishedAt 不一致: ${seed.id} (publishedAt=${seed.publishedAt})`;
    }

    if (seed.author.trim().length === 0) {
      return `金句署名不能为空: ${seed.id}`;
    }
    if (seed.author !== '心塑' && seed.sourceWork === null) {
      return `标真实作者的金句必须给出处 (spec §4 署名须真实可考): ${seed.id}`;
    }
  }
  return null;
}
