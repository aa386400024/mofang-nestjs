// V2026-10-23 治本 (AI 模拟来访池 — 运行参数: 分页上限 / 生成条数上限 / 池内容守卫):
//   原因: spec `docs/specs/counselor-visitor-pool.md` 里有三处「上限」型约束, 它们是
//     **会随运营调整的旋钮**, 不是业务常量:
//       ① §3.1 图鉴列表 limit (默认 20)
//       ② §3.5 AI 生成条数上限「由内部 env 控制」
//       ③ §6 内容边界 (排除性创伤 / 重度精神障碍 / 人格障碍 / 危机内容)
//     把它们散落在 DTO / service / prompt 里, 改一次要动 3 个文件, 迟早漏.
//     故集中到 config/ (跟 quote-seeds.ts 的 QUOTE_LIST_* 同 pattern).
//
//   反双胞胎:
//     - 不用 magic number 散落各处: 分页上限写在 DTO 装饰器里时, service 还得再写一次
//       缺省值, 两处漂移 = 前端不传 limit 时行为随版本变化.
//     - 不用 config/ 存**内容**: 内容 (6 个官方人物剧本) 属于"会持续编辑的资产",
//       单独放 config/visitor-pool-seed.ts, 与运行参数分开放.
//     - 排除清单不写死在 prompt 里就算完: prompt 是"劝模型别写", 校验器才是"挡住".
//       本文件导出词表, prompt 与校验器共用同一份, 不会出现"prompt 改了校验没改".
//
//   验证:
//     1. tsc 0 错
//     2. grep 'VISITOR_POOL_LIST_DEFAULT_LIMIT' 于本文件 → 1 处定义, DTO 与 service 各 1 处引用
//
//   时间戳: 2026-10-23

/** 图鉴列表默认条数 (spec §3.1 的 limit=20). */
export const VISITOR_POOL_LIST_DEFAULT_LIMIT = 20;

/** 图鉴列表单次最大条数 (防一次拉爆载荷). */
export const VISITOR_POOL_LIST_MAX_LIMIT = 50;

/**
 * 公共模板 id 的最大字符数.
 *
 * V2026-10-23 治本 (seed 失败 — "Data too long for column 'id'":
 *   原因: 模板 id 是**内容 slug** (形如 `vpt_self_worth_intellectualization_l1` = 37 字符),
 *     而建表时沿用了 UUID 的列宽 `CHAR(36)` —— 两者错配, 种子第 5 条直接被 MySQL 拒收.
 *     根因不是"某个 id 写长了", 而是**列宽不匹配 id 方案**: 仓库既有的 `quotes.id`
 *     早就用 `varchar(64)` (因为它同样是内容 slug 主键), 这里却按 UUID 建的表.
 *   修法: 列宽统一到 64 (迁移 1714900000019), 并把本常量作为**单一真值源**:
 *     entity 装饰器 / 迁移 DDL / seed 基线自检 三处引用同一个值, 不会再漂.
 *   反双胞胎: 不用"把 id 缩短到 36 以内"打补丁 —— 那是迁就错误列宽, 下一个
 *     `vpt_social_anxiety_intellectualization_l1` (40 字符) 会再炸一次.
 *   验证: 1. tsc 0 错  2. seed 自检覆盖 id 长度断言  3. 迁移后 VARCHAR(64) 落库成功
 *   时间戳: 2026-10-23
 */
export const VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH = 64;

/**
 * 公共模板绑定音色 id 的列宽上限 (V2026-10-27 治本, 来访池 — 公共人物绑定系统音色).
 *
 * 单一真值源: entity 装饰器 (`voice_id VARCHAR(64)`) / 迁移 DDL / seed 基线自检
 * 三处引用同一个值, 不会再漂 —— 跟 VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH 同款做法.
 *
 * 64 够用: 官方系统音色 id 形如 `Chinese (Mandarin)_Lyrical_Voice` (33 字符),
 * 留一倍余量给后续更长的命名.
 */
export const VISITOR_POOL_TEMPLATE_VOICE_ID_MAX_LENGTH = 64;

/**
 * 内部 AI 生成单次条数上限的 env 键 (spec §3.5「生成条数上限由内部 env 控制」).
 */
export const VISITOR_POOL_GENERATE_MAX_COUNT_ENV_KEY = 'VISITOR_POOL_GENERATE_MAX_COUNT';

/** 内部 AI 生成单次条数上限的缺省值 (1 条 = 人工审核成本最低). */
export const VISITOR_POOL_GENERATE_MAX_COUNT_DEFAULT = 1;

/**
 * 内部 AI 生成单次条数的**硬顶** (env 配再大也不超过这个).
 *
 * 为什么要有硬顶: env 是运维可改的, 但一次生成 N 条 = N 份待审草稿 + N 倍 token 花费.
 * 设硬顶是为了让"误配 env"不会把成本与审核队列打爆.
 */
export const VISITOR_POOL_GENERATE_MAX_COUNT_LIMIT = 5;

/**
 * 单份模板的生成**重试次数上限** (含首次尝试).
 *
 * spec §3.5.1「排除清单命中即拒收重生成」: 校验不通过不是终点, 而是把**拒收原因**
 * 喂回模型让它改. 但重试必须有上限 —— 否则一个"永远过不了校验"的方向会变成
 * 无限循环烧 token. 2 次 = 首尝 + 1 次带原因的重生成, 足够覆盖"模型没看仔细"
 * 这一类失败, 且成本可控.
 */
export const VISITOR_POOL_GENERATE_MAX_ATTEMPTS = 2;

// ════════════════════════════════════════════════════════════════════════════
// 内容边界守卫 (§6 硬约束 / §3.5.1 校验清单 4)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 普通池**禁止出现**的内容词表 (命中即拒收, 不落库).
 *
 * spec §6「内容边界 (硬约束)」: 普通池排除性创伤、重度精神障碍、人格障碍;
 * grief 只写普通丧失, 不写危机干预; §4「危机识别类人物不进普通池」.
 *
 * 为什么要"词表 + 校验"双保险:
 *   - prompt 里已经写了这条排除清单 (劝模型别写)
 *   - 但模型不是契约: 校验器是**拒收闸门**, 保证公共库里永远不会出现危机内容.
 *     只靠 prompt = 概率性安全, 只靠词表 = 漏网. 两者叠加才是结构级保证.
 *
 * 词表口径: 命中**语义关键词**即拒收, 不做同义词穷举 —— 这里宁可误伤 (内部工具,
 * 报错重生成即可), 不可漏放 (危机内容进公共池是合规事故).
 */
export const VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS: readonly string[] = [
  // 自杀 / 自伤 / 轻生
  '自杀',
  '轻生',
  '自伤',
  '割腕',
  '服毒',
  '跳楼',
  '结束生命',
  '不想活',
  '活不下去',
  // 重度精神障碍 / 精神病性症状
  '重度抑郁',
  '双相',
  '躁狂',
  '精神病性症状',
  '幻听',
  '妄想',
  '精神分裂',
  // 人格障碍
  '人格障碍',
  '自恋型人格',
  '回避型人格',
  '反社会人格',
  '边缘型人格',
  // 性创伤
  '性创伤',
  '童年性侵',
  '性侵',
  '强奸',
  '性虐待',
];

/**
 * 普通池允许的**最高自述风险水平**.
 *
 * spec §4「危机识别类人物不进普通池」: 普通池里的人设 `selfReportedRisk` 只能是
 * low / medium. `high` 与 `concealed` 都不放行 —— concealed 的语义是"来访隐瞒了
 * 真实风险", 即便当下看着是 low, 也意味着存在未披露的风险, 不属于普通池的边界.
 */
export const VISITOR_POOL_MAX_SELF_REPORTED_RISK = 'medium';
