// V2026-10-30 治本 (WP11 · B 层 · PsyGUARD 服务启动自检):
//   职责: NestJS 启动时探一次 PsyGUARD 服务的 `/health`, 失败**只记 warn**, 不阻断启动.
//   边界: 只做一次启动自检 + 契约自检; 运行期不做主动巡检 (被动降级即可).
//
//   为什么要在启动时探一次 (而不是完全不管):
//     探测器是**可选增强** —— 配了 PSYGUARD_BASE_URL 却连不上时, 现象是"每轮探测
//     都静默回落规则", 而内核的 catch 是**静默**的: 没人看日志的话, 这个降级可以
//     持续几个月不被发现. 启动时探一次 = 一条明确的启动日志说明"探测可用 / 不可用".
//
//   为什么**不阻断启动**:
//     PsyGUARD 是可选增强, 不是会话的前置条件. 探不通就回落本地规则, 对话照常.
//     把可选能力的失败升级成"应用起不来"是错的失败半径.
//
//   为什么**不 await** (不拖慢启动):
//     启动期探不通最坏要等一次超时. 让它挂在后台跑, 启动不等它 —— 这也避免了
//     "健康检查把启动卡住"这种自伤式设计.
//
//   契约自检 (labels 比对) 为什么值得做:
//     Python 服务与 NestJS 内核各有一份 11 类标签口径 (跨仓库, 无法共享类型).
//     两边漂了的表现是: 服务返回的类别名内核**不认** → 内核 `mergeVerdicts` 把它
//     过滤掉 → 类别丢了, 但 level 还在 → "看起来在工作, 其实细节全丢".
//     这种故障极难从现象反推. 所以启动时比对一次, 对不上就记 warn.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp11-psyguard-probe.spec.ts 覆盖健康检查与契约比对

import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { stripTrailingSlashes, type PsyGuardFetch, type PsyGuardWireLevel } from './http-psyguard.probe';
import { PSYGUARD_LEVEL_MAP, type SafetyLevel, type VisitorRiskCategory } from '../../../engine-core';

/**
 * 内核动作等级 → wire 粗档 (与 `http-psyguard.probe.ts` 的映射互逆).
 *
 * 两边分区一致, 所以这里能**逐类别**比对: 服务说某类别是 high, 内核说它该是
 * block, 两者等价; 不等价就是漂了.
 */
const KERNEL_LEVEL_TO_WIRE_LEVEL: Readonly<Record<SafetyLevel, PsyGuardWireLevel>> = {
  block: 'high',
  warn: 'medium',
  pass: 'low',
};

/**
 * 合法来访类别集合 (来源: 内核**已导出**的 `PSYGUARD_LEVEL_MAP` 的键 —— 那张表
 * 按 `VisitorRiskCategory` 逐项列出 11 类, 键集恰好就是合法类别集).
 *
 * 为什么不用内核的 `isVisitorRiskCategory`: 它没从内核 barrel 导出, 而内核整树是
 * **红线不可改** —— 用已导出的映射表键集, 同一份真相, 零改动.
 */
const VISITOR_RISK_CATEGORY_SET: ReadonlySet<string> = new Set<string>(Object.keys(PSYGUARD_LEVEL_MAP));

/**
 * 是否合法的来访风险类别名.
 *
 * @param value 待判断值
 * @returns 合法则 true (并收窄类型)
 */
function isVisitorRiskCategoryName(value: string): value is VisitorRiskCategory {
  return VISITOR_RISK_CATEGORY_SET.has(value);
}

/**
 * 启动自检用的健康检查超时 (ms).
 *
 * 比探测超时 (150ms) 宽松得多: 启动自检不在热路径上, 宁可多等一会儿把话说清楚,
 * 也不要因为服务刚起还没热好就误判"不可用".
 */
export const PSYGUARD_HEALTH_TIMEOUT_MS = 3000;

/**
 * PsyGUARD 服务启动自检.
 */
@Injectable()
export class PsyGuardHealthChecker implements OnApplicationBootstrap {
  private readonly logger = new Logger(PsyGuardHealthChecker.name);
  /** 服务基地址; 空 = 没配服务, 本自检不跑. */
  private readonly baseUrl: string;
  /** fetch 实现 (单测注入). */
  private readonly fetchImpl: PsyGuardFetch;

  constructor(options: { readonly baseUrl: string; readonly fetchImpl?: PsyGuardFetch }) {
    this.baseUrl = stripTrailingSlashes(options.baseUrl.trim());
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * 启动钩子: 后台探一次 `/health` (不 await, 不拖慢启动).
   */
  onApplicationBootstrap(): void {
    if (!this.baseUrl) return;
    void this.check().catch((error: unknown) => {
      this.logger.warn(`[WP11] PsyGUARD 健康自检异常(不阻断启动): ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * 探一次 `/health` 并比对标签契约.
   *
   * @returns 自检结论 (供单测断言)
   */
  async check(): Promise<{ readonly reachable: boolean; readonly modelLoaded: boolean; readonly contractOk: boolean }> {
    const url = `${this.baseUrl}/health`;
    let payload: unknown;
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        body: '',
        signal: AbortSignal.timeout(PSYGUARD_HEALTH_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`[WP11] PsyGUARD 健康检查返回 HTTP ${response.status} (不阻断启动, 运行时将回落本地规则)`);
        return { reachable: false, modelLoaded: false, contractOk: false };
      }
      payload = await response.json();
    } catch (error) {
      this.logger.warn(
        `[WP11] PsyGUARD 服务不可达 (不阻断启动, 运行时将回落本地规则): ${error instanceof Error ? error.message : String(error)}`,
      );
      return { reachable: false, modelLoaded: false, contractOk: false };
    }

    const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const modelLoaded = record['model_loaded'] === true;
    if (!modelLoaded) {
      this.logger.warn('[WP11] PsyGUARD 服务可达但模型未加载 (model_loaded=false), 运行时将回落本地规则');
    }

    const contractOk = this.verifyContract(record['labels']);
    if (contractOk) {
      this.logger.log(`[WP11] PsyGUARD 服务就绪 (model_loaded=${modelLoaded}), 标签口径与内核一致`);
    } else {
      this.logger.warn('[WP11] PsyGUARD 标签口径与内核不一致, 未知类别会被内核丢弃 (详见本条日志后紧跟的差异清单)');
    }
    return { reachable: true, modelLoaded, contractOk };
  }

  /**
   * 比对服务声明的标签口径与内核口径.
   *
   * @param labels `/health` 返回的标签清单
   * @returns 是否一致
   */
  private verifyContract(labels: unknown): boolean {
    if (!Array.isArray(labels)) return false;
    const mismatches: string[] = [];
    for (const item of labels) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const name = record['name'];
      const level = record['level'];
      if (typeof name !== 'string' || !isVisitorRiskCategoryName(name)) {
        mismatches.push(`未知类别名 ${JSON.stringify(name)}`);
        continue;
      }
      if (typeof level !== 'string') {
        mismatches.push(`${name} 缺等级`);
        continue;
      }
      const expected = KERNEL_LEVEL_TO_WIRE_LEVEL[PSYGUARD_LEVEL_MAP[name]];
      if (level !== expected) {
        mismatches.push(`${name} 服务说 ${level} / 内核口径是 ${expected}`);
      }
    }
    if (mismatches.length > 0) {
      this.logger.warn(`[WP11] 标签口径差异: ${mismatches.join('; ')}`);
      return false;
    }
    return true;
  }
}
