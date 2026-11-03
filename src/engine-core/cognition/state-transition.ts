// V2026-10-28 WP1 (引擎内核 · 状态迁移算子):
//   职责: 标准事件 → 信任 / 三维阻抗 / 情绪 / 移情的确定性增减, 统一 clamp.
//   边界: 纯函数, 无状态, 无随机, 可复现. 输入旧快照 + 事件列表, 输出新快照
//         (值语义, 整体替换, 不就地改).
//
//   架构原则: 阻抗 / 情绪是来访内部防御状态, 由**咨询师事件**推动升降, 作为 WP5
//   渲染参数; 绝不从来访自己的输出反推 (来访输出是 WP5 渲染结果, 反推 = 循环论证).
//
//   delta 表是工程种子值 (非临床标定), 集中在此便于后期调参 / 换模型轨.
//
// V2026-11-03 WP15 (引擎内核 · 单回合非对称 delta cap):
//   加一条领域不变量: "一回合内 BDI 不该跳太多" —— 与 clamp01 同类, 属状态迁移的
//   内在约束, 不是可插拔策略.
//   cap 是**速率限制** (derivative limit), clamp 是**绝对值兜底**: 两道防线都要留.
//     clamp 防越界 (值必须落在 [0,1]); cap 防跳变 (一回合最多允许动多少).
//   非对称的依据是损失厌恶: trust / valence 涨慢跌快 (信任建得慢、破得快);
//   arousal 与阻抗三维对称; 移情三维涨得慢 (±0.15).
//
// V2026-11-03 WP26 (引擎内核 · P2-14 注入改造 · 本文件第二次改写):
//   三处治本, 全部指向同一条不变量: **内核不得有任何进程级外部依赖**.
//
//   ① cap 参数改**注入** (DeltaCapConfig 端口):
//      改之前本文件直接读 process.env —— WP15 引进的第一处外部依赖, 与内核
//      "没有配置层"的自述直接冲突, 更实质的后果是**可复现性**: 引擎把 seed
//      定义成"可复现性的入口", 而 env 参与决策后, 同 seed 同序列在不同 cap 配置下
//      会落到不同状态, 回放/对拍失去意义.
//      现在: env 由 adapter 读 → 组装 DeltaCapConfig → 注入内核; 内核零 env 读取.
//
//   ② 观察者改**注入**, 删掉模块级单槽:
//      改之前 `let capObserver` 是模块级可变状态 —— 文件头写的"无状态"三项全不成立
//      (调外部回调 / 模块级可变状态 / env 参与决策). 单槽还有个隐性缺陷: 进程内
//      第二个引擎实例会把第一个的观察者顶掉, 多实例部署直接串台.
//      现在: 观察者随会话实例注入, 同 seed + 同 capConfig + 同观察者 → 逐字同输出.
//
//   ③ cap 报告带**会话标识** (sessionId / handleId):
//      多人内测时运维看到 "[WP15] turn delta capped: trust raw=+0.30" 无法定位是哪场
//      被砍. 标识随注入的上下文一起进报告.
//
//   WP26 P2-12 (轨迹 delta 也走 cap):
//     cap 管的是"**一回合总 delta**", 不管 delta 来自事件还是剧本. 剧本的 node.delta
//     是作者写死的偏移, 同样可能一开口就 -0.3; 事件是"这一轮咨询师说了什么"带来的
//     增量. 两者都是**这一轮**对来访内心状态的一次改动, 必须合并后过一次 cap.
//     所以本文件提供两把尺子:
//       · `aggregateTurnDelta` — 把一轮事件累加成 delta 向量;
//       · `applyDeltaVector`   — 把一个 delta 向量落到快照上 (含 clamp 兜底).
//     会话层 (in-memory-engine-session.ts) 拿这两把尺子把"事件 delta + 轨迹 delta"
//     合成总 delta, 过一次 cap 再落快照 —— 内核负责算, 装配层负责传参, 两边都不越界.
//
//   为什么 cap 报告走"观察者回调"而不是出参字段:
//     内核 → adapter 的通道必须窄且显式. 观察者回调让内核**只报告、不 import logger**
//     —— 打不打日志由 adapter 决定. 回调是**同步调用**, 报告与触发它的那一轮严格对应
//     (不留存, 不跨轮串台); 内核对它**永不抛穿** (抛了也只是观测失败, 不该炸掉整轮).
//
// V2026-11-03 WP34 (引擎内核 · P1 人格调节算子):
//   管道里多了**人格调节**一环: 聚合 → 人格调节 → cap → 落快照.
//
//   为什么调节在 cap 之前:
//     cap 是"一回合最多动多少"的**最后一道尺子** —— 调节若在 cap 之后, 就能把
//     被砍掉的量再加回来, cap 的保证当场作废. 顺序固定为: 先按角色调幅度, 再限总量.
//
//   为什么只对**事件 delta** 调节, 不对剧本 delta 调节:
//     剧本 (trajectory) 的 node.delta 是**作者写死**的偏移, 且本就按角色分化 ——
//     再叠一层人格系数等于把作者的设计乘两遍. 事件 delta 才是"这一轮咨询师说了什么"
//     带来的增量, 它的幅度该随来访者的关系模式而异.
//
//   为什么人格调节是**注入**而不是内核里读配置:
//     与 WP26 P2-14 的 cap 参数同一治本: 内核不认 env, 只认端口. 依赖方向是
//     env → (适配层) → PersonalityModulatorConfig → (内核端口).
//
//   cap 报告的 raw 口径随之变成"人格调节**后**的 delta": 报告只该显示真实被砍掉的量 —
//     调节带来的变化不该混进"砍幅"里.
//
// V2026-11-03 WP42 (引擎内核 · 咨询同盟三维):
//   信任拆成三个独立维度: **trust / safety / bond**. 这里是它们各自被推动的地方.
//
//   为什么三个维度**各走各的 delta**:
//     旧模型只有一个 trust, 于是"共情"这类修复动作在三个维度上只能给同一个数 ——
//     但临床上"我信你专业"(trust) / "我敢跟你说话"(safety) / "我跟你有感情了"(bond)
//     是三种不同的增长: 共情让 trust 和 safety 都涨, 但纽带涨得慢;
//     边界侵犯把三者一起打下去, 且 safety 掉得最狠 (被侵犯的人最先不敢说话).
//     把三者按同一个比例缩放, 恰好抹掉了临床信息 —— 所以三维各给各的种子系数.
//
//   系数为什么走**端口** (AllianceConfig, 见 cognition/alliance-config.ts):
//     同盟三维的系数与门槛是部署形态的决定 (内测期按真实对练校准), 不是算子逻辑 ——
//     与 WP26 P2-14 的 cap 参数、WP34 的人格系数同一范式:
//       env → (适配层) → AllianceConfig → (内核端口).
//     内核零 env 读取; 基础系数表仍在本文件 (DELTA_TABLE), 端口只做覆写 ——
//     单一真相源, 两处各写一份完整表 = 两个会漂移的真相源.
//
//   cap 维度同步扩到 11 维: safety / bond 与 trust 同档 (上 +0.20 / 下 -0.30,
//     损失厌恶口径) —— 同盟破裂与信任破裂一样, 破得快、建得慢.
//
//   剧本 (trajectory) 偏移**不覆盖** safety / bond (见 trajectory-applier.ts):
//     剧本写死的偏移是作者的设计, 任务单本期没有给剧本的同盟三维口径 ——
//     宁可它不动, 也不发明一个没依据的数.

import { resolveAllianceDelta, type AllianceConfig } from './alliance-config.js';
import { modulateDeltaByPersonality, type PersonalityModulationInput } from './personality-modulator.js';
import type { BdiSnapshot } from '../domain/bdi-snapshot.js';
import { clamp01, clampValence, resolveEmotionLabel } from '../domain/emotion.js';
import type { CounselorEventKind, SessionEvent } from '../domain/events/session-event.js';

/**
 * delta 向量的 11 个维度 (WP15: cap 维度与 delta 维度一一对应; WP42 加 safety / bond).
 *
 * 单独列一份而不是直接用 DeltaVector 的键: cap 需要**顺序** (报告按维度顺序出),
 * 而接口的键顺序没有语义. 两边多一个少一个, capTurnDelta 的类型检查会当场报错.
 */
const CAP_DIMS = [
  'trust',
  'safety',
  'bond',
  'valence',
  'arousal',
  'verbal',
  'depth',
  'style',
  'positive',
  'negative',
  'dependency',
] as const;

/** cap 维度名. */
export type CapDim = (typeof CAP_DIMS)[number];

/** 单事件对各维度的增量. */
export interface DeltaVector {
  readonly trust: number;
  /** 安全感增量 (WP42). */
  readonly safety: number;
  /** 纽带感增量 (WP42). */
  readonly bond: number;
  readonly verbal: number;
  readonly depth: number;
  readonly style: number;
  readonly valence: number;
  readonly arousal: number;
  readonly positive: number;
  readonly negative: number;
  readonly dependency: number;
}

const ZERO: DeltaVector = {
  trust: 0,
  safety: 0,
  bond: 0,
  verbal: 0,
  depth: 0,
  style: 0,
  valence: 0,
  arousal: 0,
  positive: 0,
  negative: 0,
  dependency: 0,
};

/**
 * 初始 delta 表 (任务单 §6.1 种子值).
 * 正值 = 提升该维度; 负值 = 下降. 叠加后统一 clamp, 不逐事件 clamp.
 *
 * WP15: 每个事件上方加一行**幅度声明** —— 新增算子时对照单回合 cap 看一眼:
 *   某维度单事件 |delta| 超过该维度单回合 cap 的 80% → 注释里标 ⚠️ 接近 cap.
 *   (现有 11 个算子里最高比值是 75%: boundary_cross.style / sensitive_touch.arousal,
 *    都还没到 80% 警戒线, 所以没有 ⚠️ 标记.)
 *
 * WP42: 加 **safety / bond** 两列 (同盟三维).
 *   ⚠️ 系数是**工程种子值, 非临床标定** —— 待真实对练校准.
 *   两列的口径 (任务单 §3.3):
 *     · 共情 / 接纳: 信任与安全感都涨, 纽带涨得慢 —— 情感连接需要时间;
 *     · 开放探问: 涨安全感 (敢答), 不涨纽带 (还没到建立连接那一步);
 *     · 肯定: 涨纽带 (被看见 = 关系推进);
 *     · 评判 / 说教 / 淡化: 安全感掉得比信任快 —— 先不敢说话, 才是关系真正受损的样子;
 *     · 边界侵犯: 三维一起掉, safety 掉最狠 (被侵犯的人最先不敢说话);
 *     · 敏感议题触碰: 安全感略降 (话题本身让人紧绷), 但不是破坏性的, 纽带不动.
 *   幅度对照单回合 cap (11 维, safety / bond 与 trust 同档 ±0.20 / -0.30):
 *     safety 最大单事件 |delta| = 0.05 (boundary_cross) = 上向 cap 的 25%;
 *     bond   最大单事件 |delta| = 0.04 (boundary_cross) = 上向 cap 的 20%;
 *     都不到 80% 警戒线, 无 ⚠️ 标记.
 */
const DELTA_TABLE: Readonly<Record<CounselorEventKind, DeltaVector>> = {
  empathy: {
    // 正向修复算子: trust +0.10 (单事件已达上向 cap 的 50%)
    trust: 0.1,
    safety: 0.02,
    bond: 0.01,
    verbal: -0.08,
    depth: -0.1,
    style: -0.06,
    valence: 0.1,
    arousal: -0.05,
    positive: 0.03,
    negative: 0,
    dependency: 0,
  },
  acceptance: {
    // 接纳算子: trust +0.08 (单事件达上向 cap 的 40%)
    trust: 0.08,
    safety: 0.02,
    bond: 0.01,
    verbal: -0.06,
    depth: -0.08,
    style: -0.05,
    valence: 0.08,
    arousal: -0.04,
    positive: 0.02,
    negative: 0,
    dependency: 0,
  },
  normalization: {
    // 正常化算子: trust +0.07 (单事件达上向 cap 的 35%)
    trust: 0.07,
    safety: 0.01,
    bond: 0.01,
    verbal: -0.05,
    depth: -0.07,
    style: -0.04,
    valence: 0.07,
    arousal: 0,
    positive: 0.01,
    negative: 0,
    dependency: 0,
  },
  open_probe: {
    // 开放探问算子: trust +0.05 (单事件达上向 cap 的 25%)
    trust: 0.05,
    safety: 0.01,
    bond: 0,
    verbal: -0.03,
    depth: -0.06,
    style: -0.03,
    valence: 0.04,
    arousal: 0.02,
    positive: 0,
    negative: 0,
    dependency: 0,
  },
  affirmation: {
    // 肯定算子: trust +0.08 (单事件达上向 cap 的 40%)
    trust: 0.08,
    safety: 0.01,
    bond: 0.01,
    verbal: -0.04,
    depth: -0.06,
    style: -0.04,
    valence: 0.1,
    arousal: -0.03,
    positive: 0.04,
    negative: 0,
    dependency: 0.02,
  },
  judgment: {
    // 评判算子: trust -0.12 (单事件达下向 cap 的 40%)
    trust: -0.12,
    safety: -0.03,
    bond: -0.02,
    verbal: 0.06,
    depth: 0.08,
    style: 0.12,
    valence: -0.12,
    arousal: 0.06,
    positive: 0,
    negative: 0.05,
    dependency: 0,
  },
  preaching: {
    // 说教算子: trust -0.10 (单事件达下向 cap 的 33%)
    trust: -0.1,
    safety: -0.02,
    bond: -0.01,
    verbal: 0.08,
    depth: 0.06,
    style: 0.06,
    valence: -0.08,
    arousal: 0.03,
    positive: 0,
    negative: 0.03,
    dependency: 0,
  },
  minimizing: {
    // 淡化算子: trust -0.10 (单事件达下向 cap 的 33%)
    trust: -0.1,
    safety: -0.02,
    bond: -0.02,
    verbal: 0.05,
    depth: 0.1,
    style: 0.05,
    valence: -0.12,
    arousal: 0.04,
    positive: 0,
    negative: 0.04,
    dependency: 0,
  },
  boundary_cross: {
    // 重大损害算子: trust -0.15 (单事件已达下向 cap 的 50%; 最接近的一维是 style +0.15 = 上向 cap 的 75%)
    trust: -0.15,
    safety: -0.05,
    bond: -0.04,
    verbal: 0.04,
    depth: 0.05,
    style: 0.15,
    valence: -0.15,
    arousal: 0.08,
    positive: 0,
    negative: 0.1,
    dependency: 0,
  },
  sensitive_touch: {
    // 敏感议题触碰算子: trust 0 (只动唤醒 arousal +0.15 = 上向 cap 的 75%, 不动信任)
    trust: 0,
    safety: -0.01,
    bond: 0,
    verbal: 0.05,
    depth: 0.05,
    style: 0.06,
    valence: -0.05,
    arousal: 0.15,
    positive: 0,
    negative: 0.04,
    dependency: 0,
  },
  // 中性算子: 零 delta (不推进任何维度)
  neutral: ZERO,
};

/**
 * 把多事件 delta 乘强度后聚合 (内部可变累加, 返回只读向量).
 *
 * WP26 P2-12: 导出为 `aggregateTurnDelta` —— 会话层要拿它把"事件 delta"与
 * "剧本 delta"合成**本轮总 delta**, 再统一过一次 cap.
 *
 * WP42: 同盟三维 (safety / bond) 的基础值来自 DELTA_TABLE; 端口给的覆写
 *   (AllianceConfig.deltas) 优先, 缺项 / 缺维度回基础值 —— 见 alliance-config.ts.
 *
 * @param events 本轮事件
 * @param alliance 同盟三维端口 (缺省 = 用 DELTA_TABLE 的基础系数)
 */
export function aggregateTurnDelta(events: readonly SessionEvent[], alliance?: AllianceConfig): DeltaVector {
  const sum = {
    trust: 0,
    safety: 0,
    bond: 0,
    verbal: 0,
    depth: 0,
    style: 0,
    valence: 0,
    arousal: 0,
    positive: 0,
    negative: 0,
    dependency: 0,
  };
  const overrides = alliance?.deltas;
  for (const event of events) {
    const delta = DELTA_TABLE[event.kind] ?? ZERO;
    const strength = clamp01(event.strength);
    const allianceDelta = resolveAllianceDelta(event.kind, delta, overrides);
    sum.trust += delta.trust * strength;
    sum.safety += allianceDelta.safety * strength;
    sum.bond += allianceDelta.bond * strength;
    sum.verbal += delta.verbal * strength;
    sum.depth += delta.depth * strength;
    sum.style += delta.style * strength;
    sum.valence += delta.valence * strength;
    sum.arousal += delta.arousal * strength;
    sum.positive += delta.positive * strength;
    sum.negative += delta.negative * strength;
    sum.dependency += delta.dependency * strength;
  }
  return sum;
}

/**
 * 单维度的 cap 上下界.
 *
 * `up` 是**上向**上限 (正 delta 的天花板, 非负), `down` 是**下向**下限
 * (负 delta 的地板, 非正). 两者都带符号 —— 下向用负数表达, 与 delta 同号比较.
 */
export interface CapBounds {
  /** 上向 cap (≥ 0). */
  readonly up: number;
  /** 下向 cap (≤ 0). */
  readonly down: number;
}

/**
 * 单回合 cap 配置 (内核端口).
 *
 * 11 个维度 × 上下向 = 22 个数值. 由**适配层**读 env 后组装注入 (WP26 P2-14):
 * 内核不认 env, 只认这个端口 —— 于是"配置从哪来"是装配层的决定, 内核只管怎么砍.
 *
 * 缺省 = `DEFAULT_DELTA_CAP_CONFIG` (内核种子值), env 只做覆写.
 */
export type DeltaCapConfig = Readonly<Record<CapDim, CapBounds>>;

/**
 * 内核种子值 (工程种子值, 非临床标定).
 *
 * 三档:
 *   - trust / valence / safety / bond: 上 +0.20 / 下 -0.30 —— 损失厌恶
 *     (信任建得慢、破得快; 同盟三维同理: 安全感与纽带感也是"破得快、建得慢");
 *   - arousal + 阻抗三维: ±0.20 —— 激活度对称, 涨多少就跌多少;
 *   - 移情三维: ±0.15 —— 移情涨得慢, 一回合不该就建立强烈移情.
 */
export const DEFAULT_DELTA_CAP_CONFIG: DeltaCapConfig = {
  trust: { up: 0.2, down: -0.3 },
  safety: { up: 0.2, down: -0.3 },
  bond: { up: 0.2, down: -0.3 },
  valence: { up: 0.2, down: -0.3 },
  arousal: { up: 0.2, down: -0.2 },
  verbal: { up: 0.2, down: -0.2 },
  depth: { up: 0.2, down: -0.2 },
  style: { up: 0.2, down: -0.2 },
  positive: { up: 0.15, down: -0.15 },
  negative: { up: 0.15, down: -0.15 },
  dependency: { up: 0.15, down: -0.15 },
};

/**
 * 归一一个 cap 边界值 (非法 → 回退默认).
 *
 * 为什么内核还要再校验一遍 (适配层已经校验过 env):
 *   端口是**公开契约**, 任何人都能 new 一个配置塞进来. 一个配错的方向 (上向给负数)
 *   若直接生效, 会把"砍幅"变成"放大幅度" —— 比不砍更糟. 内核这层兜底保证
 *   **无论谁注入, cap 永远只会让变化更小**.
 */
function sanitizeBound(value: number, fallback: number, direction: 'up' | 'down'): number {
  if (!Number.isFinite(value)) return fallback;
  if (direction === 'up' && value < 0) return fallback;
  if (direction === 'down' && value > 0) return fallback;
  return value;
}

/** 取某维度的有效 cap 边界 (配置缺项 / 非法 → 回退内核种子值). */
function resolveBounds(dim: CapDim, config: DeltaCapConfig | undefined): CapBounds {
  const fallback = DEFAULT_DELTA_CAP_CONFIG[dim];
  const provided = config?.[dim];
  if (!provided) return fallback;
  return {
    up: sanitizeBound(provided.up, fallback.up, 'up'),
    down: sanitizeBound(provided.down, fallback.down, 'down'),
  };
}

/**
 * 单向 cap: 正 delta 砍到上向, 负 delta 砍到下向.
 *
 * 砍的是 **delta**, 不是绝对值 —— clamp 是防越界的最后一道防线, 两者不能互相替代:
 *   clamp 管"结果不能超出 [0,1]"; cap 管"一回合最多能动多少".
 */
function capAsym(value: number, up: number, down: number): number {
  if (value > up) return up;
  if (value < down) return down;
  return value;
}

/**
 * 单回合 delta cap (WP15 §1.1): 对**本轮总 delta** 逐维度砍幅.
 *
 * 为什么要砍: 一回合叠 5 个正事件, trust 直接跳 +0.4 —— 心理上不真实
 * ("用户说了句话, 信任就翻倍"). cap 把单回合的变化量限在可接受区间.
 *
 * @param raw 本轮原始 delta 向量
 * @param config cap 配置 (缺省 = 内核种子值); 非法值逐项回退种子值
 */
export function capTurnDelta(raw: DeltaVector, config?: DeltaCapConfig): DeltaVector {
  const capped: Record<CapDim, number> = { ...raw };
  for (const dim of CAP_DIMS) {
    const bounds = resolveBounds(dim, config);
    capped[dim] = capAsym(raw[dim], bounds.up, bounds.down);
  }
  return capped;
}

/**
 * 两个 delta 向量相加 (WP26 P2-12: 事件 delta + 剧本 delta = 本轮总 delta).
 *
 * 不做 clamp —— clamp 是落快照时的事 (见 `applyDeltaVector`).
 */
export function addDeltaVectors(a: DeltaVector, b: DeltaVector): DeltaVector {
  return {
    trust: a.trust + b.trust,
    safety: a.safety + b.safety,
    bond: a.bond + b.bond,
    verbal: a.verbal + b.verbal,
    depth: a.depth + b.depth,
    style: a.style + b.style,
    valence: a.valence + b.valence,
    arousal: a.arousal + b.arousal,
    positive: a.positive + b.positive,
    negative: a.negative + b.negative,
    dependency: a.dependency + b.dependency,
  };
}

/** 单维度被砍的明细 (WP15). */
export interface DeltaCapEntry {
  /** 维度名 (trust / safety / bond / valence / arousal / verbal / depth / style / positive / negative / dependency). */
  readonly dimension: string;
  /** 砍之前的原始 delta. */
  readonly raw: number;
  /** 砍之后实际生效的 delta. */
  readonly capped: number;
}

/**
 * cap 报告的会话上下文 (WP26 P2-11).
 *
 * 为什么要有: 多人内测时, 运维看到一条 cap warning 若不知道是哪场会话被砍,
 * 就只能逐场回放 —— 报告必须自带定位信息.
 */
export interface DeltaCapContext {
  /** 会话 id (业务侧 sessionId). */
  readonly sessionId?: string;
  /** 引擎句柄 id (内核句柄). */
  readonly handleId?: string;
}

/** 本轮 cap 报告 (内核只报告, 由 adapter 决定打不打日志). */
export interface TurnDeltaCapReport {
  /** 被砍的维度明细 (逐维度一条). */
  readonly entries: readonly DeltaCapEntry[];
  /** 本轮事件类型 (去重, 按出现顺序). */
  readonly events: readonly string[];
  /** 被砍的会话 id (缺省 = 调用方没给上下文). */
  readonly sessionId?: string;
  /** 被砍的引擎句柄 id (缺省 = 调用方没给上下文). */
  readonly handleId?: string;
}

/**
 * cap 观察者 (WP15 §1.4 · WP26 改为注入).
 *
 * 内核不 import logger —— "打不打日志"由 adapter 决定.
 * 观察者**永不抛穿**: 它抛了只是观测失败, 不该让整轮 turn 失败.
 */
export type DeltaCapObserver = (report: TurnDeltaCapReport) => void;

/**
 * 状态迁移的**注入选项** (WP26 P2-14).
 *
 * 三项全是"外部依赖的入口", 全由调用方给 —— 内核自己不读 env、不持有全局状态.
 */
export interface TransitionStateOptions {
  /** 单回合 cap 配置 (缺省 = 内核种子值 `DEFAULT_DELTA_CAP_CONFIG`). */
  readonly capConfig?: DeltaCapConfig;
  /** 报告上下文 (sessionId / handleId); 缺省 = 报告不带会话标识. */
  readonly capContext?: DeltaCapContext;
  /**
   * cap 报告观察者 (缺省 = 不观测).
   *
   * 口径提醒: 这里报告的是**事件 delta** 的砍幅. 会话层走的是"事件 + 剧本"的
   * **总 delta** 口径 (WP26 P2-12), 由会话层自己算自己报 —— 两处不会同时生效.
   */
  readonly observer?: DeltaCapObserver;
  /**
   * 人格调节输入 (WP34): 角色的依恋类型 / 人格特质 + 调节端口.
   *
   * 缺省 = 不做人格调节 (delta 逐字不变). 调节发生在**聚合之后、cap 之前** ——
   * cap 是"一回合最多动多少"的最后一道尺子, 调节不得绕过它.
   */
  readonly personality?: PersonalityModulationInput;
  /**
   * 同盟三维端口 (WP42): safety / bond 的系数覆写 + 决策门槛.
   *
   * 缺省 = 用 DELTA_TABLE 的基础系数与内核种子门槛 (逐字不变, 零回归).
   */
  readonly alliance?: AllianceConfig;
}

/**
 * 套上人格调节 (WP34).
 *
 * 缺省 (无 personality 选项) → 原样返回 (逐字不变, 零回归).
 * 本轮事件缺省时由调用方补上 (宜人性规则要判定"共情回应").
 */
function modulateByPersonality(
  raw: DeltaVector,
  events: readonly SessionEvent[],
  personality: PersonalityModulationInput | undefined,
): DeltaVector {
  if (!personality) return raw;
  return modulateDeltaByPersonality(raw, { ...personality, events: personality.events ?? events });
}

/**
 * 造本轮 cap 报告 (没有维度被砍 → null).
 *
 * 报告只带"被砍的维度": 观测面要的是"哪里出过问题", 不是"哪里没问题"
 * (同 WP4 安全报告的口径).
 */
export function buildDeltaCapReport(
  raw: DeltaVector,
  capped: DeltaVector,
  events: readonly SessionEvent[],
  context?: DeltaCapContext,
): TurnDeltaCapReport | null {
  const entries = CAP_DIMS.filter((dim) => raw[dim] !== capped[dim]).map((dim) => ({
    dimension: dim,
    raw: raw[dim],
    capped: capped[dim],
  }));
  if (entries.length === 0) return null;
  return {
    entries,
    events: [...new Set(events.map((event) => event.kind))],
    ...(context?.sessionId === undefined ? {} : { sessionId: context.sessionId }),
    ...(context?.handleId === undefined ? {} : { handleId: context.handleId }),
  };
}

/**
 * 通知观察者 (永不抛穿).
 *
 * WP25 治本 (封版审查): 观察者回调**抛错不许炸穿 turn**.
 *   内核对一切外部注入的能力都是"永不抛穿"的: assessSafety 的 probe 抛错 → 回落规则;
 *   collectOpeningContext 吞异常 → 回落空数组. observer 是当时**唯一**没设防的一处.
 *   它炸穿的后果比别的都重: 此刻状态还没落库 (调用点的 bdiStates.save 在这之后),
 *   整轮 turn 失败, 而失败原因只是"打日志的那个回调抛了" —— 观测通道不该有这个权力.
 *
 * WP26 P2-12: 会话层报的是"事件 + 剧本"的**总** delta 口径, 走同一个通知出口 ——
 *   "永不抛穿"这条纪律只有一份实现, 两处口径共用.
 */
export function notifyDeltaCap(observer: DeltaCapObserver | undefined, report: TurnDeltaCapReport | null): void {
  if (!observer || !report) return;
  try {
    observer(report);
  } catch {
    // 观测通道失败不影响状态迁移. 静默吞掉是刻意的: 内核不 import logger,
    // 报告本来就不影响状态 —— 它只是"给 adapter 看的".
  }
}

/**
 * 把一个 delta 向量落到快照上 (统一 clamp, 重算 emotion.label).
 *
 * WP26 P2-12 的落地点: 会话层把"事件 delta + 剧本 delta"合成总 delta、过一次 cap,
 * 再用本函数落快照 —— 于是**一回合只 clamp 一次**, 不会出现"中间夹一次 clamp
 * 把被砍掉的量又补回来"的漂移 (旧路径是 clamp → 再叠加 → 再 clamp).
 */
export function applyDeltaVector(snapshot: BdiSnapshot, delta: DeltaVector): BdiSnapshot {
  const valence = clampValence(snapshot.emotion.valence + delta.valence);
  const arousal = clamp01(snapshot.emotion.arousal + delta.arousal);

  return {
    coreBeliefs: snapshot.coreBeliefs,
    temporaryBeliefs: snapshot.temporaryBeliefs,
    memoryBeliefs: snapshot.memoryBeliefs,
    underlyingDesires: snapshot.underlyingDesires,
    situationalDesires: snapshot.situationalDesires,
    emotion: { label: resolveEmotionLabel(valence, arousal), valence, arousal },
    resistance: {
      verbal: clamp01(snapshot.resistance.verbal + delta.verbal),
      depth: clamp01(snapshot.resistance.depth + delta.depth),
      style: clamp01(snapshot.resistance.style + delta.style),
    },
    transference: {
      positive: clamp01(snapshot.transference.positive + delta.positive),
      negative: clamp01(snapshot.transference.negative + delta.negative),
      dependency: clamp01(snapshot.transference.dependency + delta.dependency),
    },
    trust: clamp01(snapshot.trust + delta.trust),
    // WP42: 同盟三维各自 clamp —— 安全感与纽带感同样是 [0,1] 的关系量.
    safety: clamp01(snapshot.safety + delta.safety),
    bond: clamp01(snapshot.bond + delta.bond),
  };
}

/**
 * 状态迁移: 旧快照 + 事件 → 新快照.
 * 信念层 / 愿望层规则轨不改写 (原样透传, 其演进入模型轨 / 后续);
 * 只推进信任 / 阻抗 / 情绪 / 移情.
 *
 * WP15: 本轮总 delta 先过**单回合 cap** 再落快照 (砍 delta, 不是 clamp 绝对值);
 * 被砍了就把报告交给观察者 (adapter 决定打不打日志).
 *
 * WP34: 管道里多了**人格调节**一环 —— 聚合 → 人格调节 → cap → 落快照.
 *   调节放在 cap **之前**: cap 是"一回合最多动多少"的最后一道尺子, 调节不得绕过它.
 *   cap 报告的 raw 口径随之变成"**人格调节后**的 delta" —— 报告只该显示真实被砍掉的量,
 *   调节带来的变化不该混进"砍幅"里 (否则运维会把调节当成 cap).
 *
 * @param snapshot 旧快照
 * @param events 本轮标准事件
 * @param options 注入选项 (cap 配置 / 报告上下文 / 观察者 / 人格调节 / 同盟三维端口)
 */
export function transitionState(snapshot: BdiSnapshot, events: readonly SessionEvent[], options?: TransitionStateOptions): BdiSnapshot {
  const aggregated = aggregateTurnDelta(events, options?.alliance);
  const raw = modulateByPersonality(aggregated, events, options?.personality);
  const delta = capTurnDelta(raw, options?.capConfig);
  notifyDeltaCap(options?.observer, buildDeltaCapReport(raw, delta, events, options?.capContext));
  return applyDeltaVector(snapshot, delta);
}

/**
 * 状态迁移 (详细版): 新快照 + 本轮 cap 报告.
 *
 * 为什么另起一个出口, 而不是改 transitionState 的返回类型:
 *   transitionState 是内核会话端口既有调用点与既有测试的公共契约, 改返回形状 =
 *   改已发布契约 (同一条链路出现两种口径). 这里保持 transitionState 原样,
 *   另导出详细版供需要 cap 观测的调用方使用.
 */
export function transitionStateDetailed(
  snapshot: BdiSnapshot,
  events: readonly SessionEvent[],
  options?: TransitionStateOptions,
): { readonly snapshot: BdiSnapshot; readonly capped: TurnDeltaCapReport | null } {
  const aggregated = aggregateTurnDelta(events, options?.alliance);
  const raw = modulateByPersonality(aggregated, events, options?.personality);
  const delta = capTurnDelta(raw, options?.capConfig);
  const report = buildDeltaCapReport(raw, delta, events, options?.capContext);
  notifyDeltaCap(options?.observer, report);
  return { snapshot: applyDeltaVector(snapshot, delta), capped: report };
}
