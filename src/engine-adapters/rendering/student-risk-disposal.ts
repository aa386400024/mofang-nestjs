// V2026-11-02 治本 (WP14 · 学员心理风险处置层 — 判定与载荷构造):
//   职责: 把内核给出的 `SafetyVerdict` 翻译成**学员侧该做什么** (不提示 / 轻提示 / 阻断),
//         并构造给前端的危机帧载荷.
//   边界: 纯函数, 零 IO / 零网络 / 零 @nestjs / 零 ORM; **不碰引擎内核**, 不改判定.
//
//   为什么这一层必须独立成纯模块:
//     处置动作有**两条边界**, 任何一条搞反都是产品事故 ——
//       ① **side 边界**: 学员自己说的话 (counselor_input) 要处置;
//          AI 扮演的来访者说的话 (visitor_output) 是**演练内容**, 绝不处置 ——
//          学员在练自杀危机干预剧本时, AI 来访本来就要说"我不想活了".
//          搞反 = 把正常训练一刀切断.
//       ② **类别边界**: 内核 warn/block 里混着"专业越界" (承诺治愈 / 双重关系 / …)
//          与"危机类别" (被动意念 / 主动意念 / …). 只有**危机类别**该触发危机处置 ——
//          专业越界是督导的事后复盘项, 不该在对话中途弹窗打断学员.
//     两条边界都收在这一个纯函数里, 便于单测直接钉死.
//
//   动作档位 (WP14 §1.1):
//     none  = 无危机信号 → 学员侧无感知 (AI 正常回复)
//     toast = warn 级危机 → **不阻断**, AI 正常流式回复, 同时推一条 3 秒自动消失的轻提示
//     block = block 级危机 → **阻断本轮 AI 回复** (不调 RenderPort.render, 不发 llm/tts 帧),
//            推全屏 modal (含 12356 / 120)
//
//   反双胞胎:
//     - 不自己判等级: 等级用内核的 `SafetyLevel` (pass/warn/block), 类别用内核的
//       `VisitorRiskCategory` —— 处置层只做"映射", 不发明第四套严重度刻度.
//     - 不在这里写库 / 推帧: 本模块只产出**决定**, 落库与推帧在装配层 (端口 + 帧出口),
//       纯函数才好单测.
//     - 不给来访输出侧兜底: `visitor_output` 命中危机 = 演练素材, 一律 none.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp14-student-risk-disposal.spec.ts 覆盖 side/类别/等级三条边界

import type { ProbeSource } from './probe-source.js';
import { isCrisisCategory } from './render-risk.js';
import type { RiskProbeResult, SafetyVerdict } from '../../engine-core/index.js';

/**
 * 学员侧处置动作 (三档).
 *
 * `none` = 无感知; `toast` = 轻提示不阻断; `block` = 阻断本轮 + 全屏 modal.
 */
export type StudentRiskAction = 'none' | 'toast' | 'block';

/**
 * 危机帧的等级档 (与渲染风险档同款词汇: medium / high).
 *
 * 为什么不直接用内核的 warn/block: 前端帧协议里已经有 `medium` / `high`
 * 这套"给用户看的严重度"词汇 (WP9-C 的督导提示档也是这套), 两套词汇混用
 * 会让前端每接一个帧都要做一次映射.
 */
export type StudentRiskLevel = 'medium' | 'high';

/**
 * 审计口径的判定来源.
 */
export type StudentRiskSource = 'rule' | 'psyguard' | 'local_dict';

/**
 * 心理援助热线 (全国统一).
 */
export const CRISIS_HOTLINE = '12356';

/**
 * 急救电话.
 */
export const CRISIS_EMERGENCY = '120';

/**
 * 命中片段最大长度 (审计表 snippet 列; 隐私最小化 —— 不存完整对话原文).
 */
export const RISK_SNIPPET_MAX_LENGTH = 200;

/**
 * 处置决定.
 */
export interface StudentRiskDecision {
  /** 该做什么. */
  readonly action: StudentRiskAction;
  /** 帧上的等级 (none 时为 null). */
  readonly level: StudentRiskLevel | null;
  /** 命中的危机类别 (none 时为 null). */
  readonly category: string | null;
  /** 判定来源 (审计口径). */
  readonly source: StudentRiskSource;
}

/**
 * 危机轻提示帧 (medium).
 *
 * 等级写死成字面量 `'medium'` (不是 `StudentRiskLevel` 联合) ——
 * 这样它能**直接**当 `VoiceServerMessage` 用, 不用在推帧处再 cast 一次.
 */
export interface CrisisToastFrame {
  readonly type: 'crisis_toast';
  readonly level: 'medium';
  readonly category: string;
}

/**
 * 危机全屏弹窗帧 (high).
 *
 * 同上: 等级写死成字面量 `'high'`, 帧可直接当 `VoiceServerMessage` 用.
 */
export interface CrisisModalFrame {
  readonly type: 'crisis_modal';
  readonly level: 'high';
  readonly category: string;
  readonly hotline: string;
  readonly emergency: string;
}

/**
 * 判定 → 处置动作.
 *
 * 三条边界 (顺序不能换):
 *   ① **side**: 不是 `counselor_input` → none (来访输出侧是演练内容, 绝不处置);
 *   ② **等级**: `pass` → none;
 *   ③ **类别**: 没有危机类别 → none (专业越界不是危机处置).
 *   过了三条: `block` → block, `warn` → toast.
 *
 * @param verdict 内核本轮判定 (缺省 = 无判定)
 * @returns 处置动作
 */
export function decideStudentRiskAction(verdict: SafetyVerdict | undefined): StudentRiskAction {
  if (!verdict) return 'none';
  // ① side 边界: 学员输入侧才处置.
  if (verdict.side !== 'counselor_input') return 'none';
  // ② 等级边界: pass = 没事.
  if (verdict.level === 'pass') return 'none';
  // ③ 类别边界: 只有危机类别才处置 (专业越界交给督导复盘, 不打断学员).
  const crisis = verdict.categories.filter((category) => isCrisisCategory(category));
  if (crisis.length === 0) return 'none';
  return verdict.level === 'block' ? 'block' : 'toast';
}

/**
 * 判定 + 探测来源 → 完整处置决定.
 *
 * @param verdict 内核本轮判定
 * @param probeSource 探测来源 (本地词典 / PsyGUARD; 缺省 = 规则层)
 * @returns 处置决定 (action=none 时其余字段为 null)
 */
export function buildStudentRiskDecision(verdict: SafetyVerdict | undefined, probeSource: ProbeSource | undefined): StudentRiskDecision {
  const action = decideStudentRiskAction(verdict);
  if (action === 'none') {
    return { action: 'none', level: null, category: null, source: resolveSource(verdict, probeSource) };
  }
  return {
    action,
    level: action === 'block' ? 'high' : 'medium',
    category: pickCrisisCategory(verdict),
    source: resolveSource(verdict, probeSource),
  };
}

/**
 * 学员选择 (modal 之后的回写).
 */
export type StudentRiskChoice = 'phone' | 'continue' | 'dismissed';

/**
 * 学员侧处置闸门端口 (装配层实现).
 *
 * 为什么要有这层"闸门": 内核的 `RiskProbePort.probe(text, side)` **没有 session id**,
 * 而 `createEngineSessionPort` 只造**一个** `InMemoryEngineSession` (探测器进程级共享)
 * —— 于是"这一场已经出过高危, 后续每轮必须强制走 PsyGUARD"这件事**没法在 probe 层实现**.
 * 把"监测状态 + 强制远端探测"抽成装配层的一个端口, 由编排门面在**渲染前**调用:
 *   · 内核那一次判定仍然照常跑 (规则 + 探测, 口径不变);
 *   · 监测中的场次**额外**强制问一次远端, 与内核判定合并后取更严的一档.
 *
 * 端口形状刻意只暴露"能不能问 / 怎么问", 不暴露探测器实现 ——
 * 装配层换探测器 (PsyGUARD → 别的服务) 时, 门面一行不动.
 */
export interface StudentRiskGate {
  /**
   * 该场次是否处于重点监测 (出过一次 high 事件后置位).
   *
   * @param handleId 内核会话句柄
   * @returns true = 重点监测中
   */
  isMonitored(handleId: string): boolean;
  /**
   * 置位重点监测 (high 事件后调用).
   *
   * @param handleId 内核会话句柄
   */
  markMonitored(handleId: string): void;
  /**
   * 清重点监测 (会话关闭时调用; 否则句柄复用会串场).
   *
   * @param handleId 内核会话句柄
   */
  clearMonitored(handleId: string): void;
  /**
   * 强制走一次远端探测 (监测中场次的每一轮都问一次).
   *
   * 失败语义: **静默失败** —— 返回 undefined 表示"没问出结果",
   * 调用方按内核判定继续 (不能因为远端挂了就把整场对练搞挂).
   *
   * @param text 学员本轮输入
   * @param handleId 内核会话句柄
   * @returns 处置决定; undefined = 没问出结果
   */
  forceRemoteProbe(text: string, handleId: string): Promise<StudentRiskDecision | undefined>;
}

/**
 * 无处置决定 (常量).
 *
 * 用常量而不是每次新建: 装配层要拿它当"没判出风险"的哨兵值比较,
 * 每次新建对象会让引用比较失效.
 */
export const NO_STUDENT_RISK_DECISION: StudentRiskDecision = {
  action: 'none',
  level: null,
  category: null,
  source: 'rule',
};

/**
 * 处置档位严重度 (合并时取更严的一档).
 */
const ACTION_SEVERITY: Readonly<Record<StudentRiskAction, number>> = {
  none: 0,
  toast: 1,
  block: 2,
};

/**
 * 合并两个处置决定 (取更严的一档).
 *
 * 为什么"更严"而不是"后者覆盖": 内核判定与强制远端探测是**两条独立证据**,
 * 取更严的那档是安全方向 —— 宁可多弹一次提示, 不可漏掉一次危机.
 *
 * @param primary 主判定 (通常来自内核)
 * @param extra 附加判定 (重点监测场次的强制远端探测; 缺省 = 没有)
 * @returns 合并后的处置决定
 */
export function mergeStudentRiskDecisions(primary: StudentRiskDecision, extra: StudentRiskDecision | undefined): StudentRiskDecision {
  if (!extra || extra.action === 'none') return primary;
  if (ACTION_SEVERITY[extra.action] > ACTION_SEVERITY[primary.action]) return extra;
  return primary;
}

/**
 * 探测结果 → 处置决定 (重点监测场次的强制远端探测走这里).
 *
 * 为什么绕一圈构造 `SafetyVerdict` 再交给 `buildStudentRiskDecision`:
 *   处置判定的三条边界 (side / 等级 / 危机类别) 已经写在那一个函数里,
 *   再写一份"探测结果怎么映射成处置"就是**第二份真相** —— 两份迟早漂移.
 *   这里只做"把探测结果包装成同一种判定形状", 边界判定仍然只有一处.
 *
 * @param result 探测结果 (缺省 = 没问出结果)
 * @param probeSource 判定来源 (审计口径).
 *   缺省 = `psyguard` (调用方问的是远端); 前置 gate 那条路要显式传
 *   探测来源通道记下的值 —— 远端挂掉委托本地词典兜底时, 那条判定是
 *   `local_dict` 给的, 记成 `psyguard` 就是**虚报远端识别能力**.
 * @returns 处置决定
 */
export function buildStudentRiskDecisionFromProbe(
  result: RiskProbeResult | undefined,
  probeSource: ProbeSource = 'psyguard',
): StudentRiskDecision {
  if (!result) return NO_STUDENT_RISK_DECISION;
  const verdict: SafetyVerdict = {
    level: result.level,
    side: 'counselor_input',
    categories: [...result.categories],
    matchedRules: [],
    source: 'probe',
  };
  return buildStudentRiskDecision(verdict, probeSource);
}

/**
 * 构造危机轻提示帧.
 *
 * @param decision 处置决定 (action 必须是 toast)
 * @returns 轻提示帧
 */
export function buildCrisisToastFrame(decision: StudentRiskDecision): CrisisToastFrame {
  return { type: 'crisis_toast', level: 'medium', category: decision.category ?? 'passive_ideation' };
}

/**
 * 构造危机全屏弹窗帧.
 *
 * @param decision 处置决定 (action 必须是 block)
 * @returns 弹窗帧
 */
export function buildCrisisModalFrame(decision: StudentRiskDecision): CrisisModalFrame {
  return {
    type: 'crisis_modal',
    level: 'high',
    category: decision.category ?? 'active_ideation',
    hotline: CRISIS_HOTLINE,
    emergency: CRISIS_EMERGENCY,
  };
}

/**
 * 命中片段截断 (审计表 snippet 列).
 *
 * 为什么截断: 审计表要能说明"学员当时说了什么", 但**不存完整对话原文**
 * (隐私最小化; 学员的咨询内容不该整段躺在审计表里).
 *
 * @param text 学员原始输入
 * @param max 最大长度
 * @returns 截断后的片段
 */
export function truncateRiskSnippet(text: string, max: number = RISK_SNIPPET_MAX_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

/**
 * 判定来源归一 (审计口径).
 *
 * 口径:
 *   · 内核规则层命中 (verdict.source='rule') → `rule`;
 *   · 探测命中 → 探测通道记录的来源 (`psyguard` / `local_dict`).
 *
 * 通道里没记录到 (探测超时 / 探测器未装配) 而判定又确实来自探测 → 记 `local_dict`
 * (保守: 宁可记成"弱的那一路", 也不要虚报远端识别能力).
 *
 * @param verdict 内核判定
 * @param probeSource 通道记录的来源
 * @returns 审计口径的来源
 */
function resolveSource(verdict: SafetyVerdict | undefined, probeSource: ProbeSource | undefined): StudentRiskSource {
  if (!verdict) return 'rule';
  if (verdict.source === 'rule') return 'rule';
  return probeSource ?? 'local_dict';
}

/**
 * 挑一个危机类别 (稳定取第一个).
 *
 * @param verdict 内核判定
 * @returns 危机类别名 (没有则 null)
 */
function pickCrisisCategory(verdict: SafetyVerdict | undefined): string | null {
  if (!verdict) return null;
  const crisis = verdict.categories.find((category) => isCrisisCategory(category));
  return crisis ?? null;
}
