// V2026-10-28 治本 (WP4 · 引擎内核 · 安全编排):
//   职责: 把"确定性规则"与"可选风险探测"编排成一次判定 —— 规则先行, 非 block
//         才异步问探测, 超时 / 抛错 / 脏形状一律静默回落规则结果.
//   边界: 纯函数编排, 无状态, 无 IO (探测调用是**注入进来的**外部能力),
//         内部不读配置、不读时钟、不落库.
//
//   降级顺序 (为什么是这个顺序, 不能反):
//     1. 规则是**同步、确定、零延迟**的, 它先跑 —— 高危信号不该等网络;
//     2. 规则已 block → **不再发起探测**: 高危已兜住, 为一个不需要的结果
//        去付网络延迟与失败率, 纯亏;
//     3. 规则非 block → 才问探测, 因为探测擅长的是规则覆盖不到的**语义风险**
//        (来访说"我最近有点撑不住"这种没有硬关键词的表述);
//     4. 探测超时 / 抛错 / 返回脏形状 → **回落规则**, 绝不把异常抛穿 turn.
//        安全层挂掉不该让对话挂掉 —— 这是护栏, 不是门禁.
//
//   反双胞胎:
//     - 不自己判"探测结果能不能用": 归一逻辑集中在本文件一处, 规则层与
//       报告层共用同一个 PSYGUARD_LEVEL_MAP 口径.
//     - 不把探测等级直接当最终等级: 最终等级取 max(规则, 探测, 探测类别映射),
//       三个来源里**最高**的那个 —— 宁可偏高 (多提醒一次督导), 不可偏低.
//     - 不用 AbortSignal 取消探测: 探测实现可能不支持取消, 强行 abort 会在
//       实现侧留下未处理拒绝; 这里用 Promise.race + 计时器, 实现侧零要求.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp4-safety.spec.ts 覆盖合并 / 超时 / 抛错 / 脏形状 / block 不等探测

import { clearTimeout, setTimeout } from 'node:timers';

import { evaluateSafety } from './rule-engine';
import type { RiskProbePort, RiskProbeResult } from '../../domain/ports/risk-probe';
import {
  PSYGUARD_LEVEL_MAP,
  isSafetyLevel,
  isVisitorRiskCategory,
  maxSafetyLevel,
  type SafetyCategory,
  type SafetyLevel,
  type SafetySide,
  type SafetyVerdict,
} from '../../domain/safety/safety-types';

/**
 * 探测超时 (工程种子值: 本地 / 内网探测的经验上限, 非标定).
 *
 * 后期按真实 Python 服务的 P99 延迟校准, 集中为常量便于调.
 *
 * ⚠️⚠️⚠️ **临时值 500ms —— M3 内测前必须改回 150ms** ⚠️⚠️⚠️
 *
 * 改动缘由 (2026-10-30 · WP11 审核后的用户决策 #4):
 *   测试阶段**只有一个人用**, 准确率优先于延迟 → 把服务侧 token 窗口从 28 放宽到 256,
 *   同时把探测超时放宽, 让长文本也能拿到模型判定.
 *
 *   为什么必须"改回":
 *   1. 500 是**为测试让路的**, 不是标定出来的工程值 —— 真机 BERT-large int8 的
 *      token 成本 ≈ 9.9ms + 3.34ms/token, 28 token 稳在 ~104ms, 256 token 要 ~650ms
 *      (2.0 核) —— 也就是说 500ms 只够覆盖到 ~145 token, 真正要"不牺牲准确率"得
 *      回到**更快的硬件或更小的模型**, 而不是把超时调大 (见 mofang-psyguard 的
 *      `scripts/exp_window_caps.py` 横评).
 *   2. 超时是**每轮**的同步等待: 内核这层 `Promise.race` 掐断后, 适配层的 HTTP 连接
 *      仍在后台跑完 (内核不取消探测). 500ms 意味着**服务不可达时每轮多等 500ms**,
 *      不是"最多等 500ms".
 *   3. M3 内测是**多人**场景 —— 延迟预算与并发下的公平性都按 150ms 设计过.
 *
 * **回改清单 (M3 内测前, 一次性做完, 跨两个仓库 6 处)**:
 *   - 本常量: 500 → 150
 *   - `src/engine-adapters/wiring/risk/http-psyguard.probe.ts` 的 `timeoutMs` 默认值
 *     是从本常量派生的 → **无需另改** (这是刻意的: 只留一个回改点).
 *   - `.env.example` 的 `PSYGUARD_TIMEOUT_MS`: 500 → 150
 *   - `mofang-psyguard/docker-compose.yml` 的 `PSYG_MAX_LENGTH`: 256 → 28
 *   - `mofang-psyguard/classifier.py` 的 `DEFAULT_MAX_LENGTH`: 256 → 28
 *   - `mofang-psyguard/tests/test_classifier.py` 里对默认窗口的断言: 256 → 28
 *   - `test/engine-core/wp4-safety.spec.ts` 里对本常量的断言: 500 → 150
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 500;

/**
 * 安全编排入参.
 */
export interface AssessSafetyInput {
  /** 待判定文本. */
  readonly text: string;
  /** 检测面. */
  readonly side: SafetySide;
  /** 装配时注入的探测端口; 缺省 = 纯规则. */
  readonly probe?: RiskProbePort;
  /** 探测超时 (种子值 DEFAULT_PROBE_TIMEOUT_MS=150); 到点回落规则. */
  readonly timeoutMs?: number;
  /**
   * 时钟 (测试可注入).
   *
   * 预留: 事件 `at` 由运行时自己的时钟记录 (内核不落库), 判定本身不依赖时钟 ——
   * 判定必须与"什么时候跑的"无关, 否则同一条文本在不同轮次会得到不同结论.
   */
  readonly now?: () => number;
}

/**
 * 规则 → 可选探测 → 合并 / 降级. 永不抛穿 (探测异常 / 超时被内部捕获为规则结果).
 *
 * @param input 编排入参
 * @returns 本轮安全判定
 */
export async function assessSafety(input: AssessSafetyInput): Promise<SafetyVerdict> {
  const text = input.text.trim();
  if (!text) return passVerdict(input.side);

  const ruleVerdict = evaluateSafety(text, input.side);
  // 未注入探测 → 纯规则.
  if (!input.probe) return ruleVerdict;
  // 规则已 block → 不发起探测 (高危已兜住, 不为不需要的结果付网络延迟).
  if (ruleVerdict.level === 'block') return ruleVerdict;

  try {
    const probeResult = await withTimeout(input.probe.probe(text, input.side), resolveTimeoutMs(input.timeoutMs));
    return mergeVerdicts(ruleVerdict, probeResult);
  } catch {
    // 超时 / 抛错 → 回落规则, 不向 turn 抛任何异常.
    return ruleVerdict;
  }
}

/**
 * 合并规则判定与探测结果.
 *
 * 等级取三者最高: 规则等级 / 探测等级 / 探测类别经 PSYGUARD 映射的等级 ——
 * 探测实现可能返回 level='pass' 却带着 block 类别的类别 (脏形状), 取最高是安全方向.
 */
function mergeVerdicts(ruleVerdict: SafetyVerdict, raw: RiskProbeResult): SafetyVerdict {
  // 非法形状 (无 level / 未知 level) → 整体回落规则.
  if (!raw || !isSafetyLevel(raw.level)) return ruleVerdict;

  const categories = (raw.categories ?? []).filter(isVisitorRiskCategory).filter((category) => category !== 'neutral');
  const categoryLevel = categories.reduce<SafetyLevel>((acc, category) => maxSafetyLevel(acc, PSYGUARD_LEVEL_MAP[category]), 'pass');
  const probeHit = raw.level !== 'pass' || categoryLevel !== 'pass';
  const level = maxSafetyLevel(ruleVerdict.level, maxSafetyLevel(raw.level, categoryLevel));
  const mergedCategories: SafetyCategory[] = [...new Set([...ruleVerdict.categories, ...categories])];
  const ruleHit = ruleVerdict.level !== 'pass';
  let source: SafetyVerdict['source'] = 'rule';
  if (probeHit) {
    source = ruleHit ? 'rule+probe' : 'probe';
  }

  return {
    level,
    side: ruleVerdict.side,
    categories: mergedCategories,
    matchedRules: ruleVerdict.matchedRules,
    source,
    ...(mergedCategories.length > 0 ? { reason: buildReason(source, mergedCategories) } : {}),
  };
}

/** reason 前缀表 (查表, 不用分支 —— 分支版本迟早漏掉新 source). */
const REASON_LABEL: Readonly<Record<SafetyVerdict['source'], string>> = {
  rule: '规则命中',
  probe: '探测命中',
  'rule+probe': '规则+探测命中',
};

/** 生成中性说明 (类别级, 不做自然语言润色). */
function buildReason(source: SafetyVerdict['source'], categories: readonly SafetyCategory[]): string {
  return `${REASON_LABEL[source]}: ${categories.join(', ')}`;
}

/**
 * 探测超时兜底: 到点 reject, 让调用方回落规则.
 *
 * 探测实现**不需要**支持取消 —— 只用 Promise.race 语义, 探测自身仍在后台跑完.
 *
 * 计时器必须 unref: 否则"探测永不返回"的场景里, 这个计时器会把 Node 事件循环
 * 吊住 —— 进程该退出时退不出去 (表现为 jest "worker failed to exit gracefully",
 * 线上则是服务停不下来). unref 只影响"是否吊住事件循环", 不影响计时器正常触发.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RiskProbe 超时')), timeoutMs);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** 超时配置归一: 越界 / 非法 → 默认值, 不抛. */
function resolveTimeoutMs(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return DEFAULT_PROBE_TIMEOUT_MS;
  return raw;
}

/** 空判定 (pass / 无类别 / 无规则). */
function passVerdict(side: SafetySide): SafetyVerdict {
  return { level: 'pass', side, categories: [], matchedRules: [], source: 'rule' };
}
