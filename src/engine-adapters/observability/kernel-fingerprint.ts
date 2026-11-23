/**
 * 内核指纹 (kernelRef) —— 判断一份语料/一场会话属于哪版 delta 系数。
 *
 * 为什么需要 (AF-428 取证 / AF-427 backlog B1):
 *   `data/debug-sessions` 的语料是**跨内核版本的混合快照** —— 同为「empathy 单算子轮」
 *   出现过 5 套 delta 签名 (trust 0.12/safety 0.014、0.06、0.10 …)。会话落盘不带任何
 *   版本标识, 事后无法判断某轮 trace 到底是哪版 `DELTA_TABLE` 跑出来的, 于是
 *   「实测/系数比」既不能判「当前系数是否生效」, 也不能跨语料横比.
 *   落一个指纹之后: 同一 `kernelRef` 内部才可比, 不同指纹必须分开统计.
 *
 * 为什么用 `aggregateTurnDelta` 而不是内核私有 `DELTA_TABLE`:
 *   `DELTA_TABLE` 是 `state-transition.ts` 的 module 内 `const`, **没有导出** ——
 *   要读它就得改 `src/engine-core` (纯层红线, 一行不动). `aggregateTurnDelta` 是
 *   内核公开 API: 传入 SingleEvent 会依次经过 delta 规则覆写 / 同盟基础值解析,
 *   返回的向量就是**运行时真正落地的值**. 用它当指纹输入, 好处是:
 *     · 不需要读私有常量, 不碰纯层;
 *     · 跟随所有影响落地的层 (规则表 / AllianceConfig 基础值), 指标准确;
 *     · 内核重构内部结构时指纹不变 —— 只要系数语义没变.
 *
 * 指纹随系数变化: 任一算子的任一维度改值 → 哈希变 → 老语料与新语料自动分到两组.
 */

import { createHash } from 'node:crypto';

import { aggregateTurnDelta } from '../../engine-core/index.js';
import type { CounselorEventKind, DeltaVector, SessionEvent } from '../../engine-core/index.js';

/** 指纹 schema 版本. 指纹算法本身变化时递增, 老指纹仍可辨认为旧 schema. */
export const KERNEL_FINGERPRINT_SCHEMA = 'kernel-ref-v1';

/** 指纹前缀: `kr1-<16 位十六进制>`. */
export const KERNEL_REF_PREFIX = 'kr1-';

/** 哈希截断长度 (十六进制字符数). 13×11 个系数, 16 位足以区分版本且便于人读. */
export const KERNEL_REF_HEX_LENGTH = 16;

/**
 * 参与指纹的算子名单 (顺序固定, 进哈希).
 *
 * 必须与内核 `CounselorEventKind` 的 13 值逐字一致; 内核新增算子时这里要同步,
 * 否则指纹会漏掉新算子的系数 (单测 `FINGERPRINT_EVENT_KINDS` 长度断言会红).
 */
export const FINGERPRINT_EVENT_KINDS: readonly CounselorEventKind[] = Object.freeze([
  'neutral',
  'empathy',
  'acceptance',
  'normalization',
  'open_probe',
  'affirmation',
  'judgment',
  'preaching',
  'minimizing',
  'boundary_cross',
  'sensitive_touch',
  'holding_present',
  'cold_absent',
]);

/** 一条「单事件」的探针事件: 不带命中词, 强度 1 —— 只求系数, 不涉分类. */
function probeEvent(kind: CounselorEventKind): SessionEvent {
  return { kind, matchedTerms: [], strength: 1 };
}

/**
 * 规范化一个 delta 向量: 键名按字母序 + 数值固定 6 位小数.
 *
 * 为什么固定小数位: 浮点累加顺序不同会带来 1e-17 级噪声, 不截断会让指纹在
 * 「语义等价」的两次计算间抖动. 6 位小数对 [−1,1] 量级已远超业务精度.
 */
function canonicalize(delta: DeltaVector): Record<string, number> {
  const entries = Object.entries(delta as unknown as Record<string, number>)
    .filter(([, value]) => typeof value === 'number')
    .toSorted(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries.map(([key, value]) => [key, Number(value.toFixed(6))]));
}

/**
 * 逐算子取运行时有效 delta (11 维).
 *
 * 导出是给单测断言具体系数用的 —— 也让指纹的输入对人可读 (不必只信哈希).
 */
export function fingerprintRows(): readonly { readonly kind: CounselorEventKind; readonly delta: DeltaVector }[] {
  return FINGERPRINT_EVENT_KINDS.map((kind) => ({
    kind,
    delta: aggregateTurnDelta([probeEvent(kind)]),
  }));
}

/** 由逐算子向量算出指纹哈希 (纯函数, 无 IO). */
export function hashFingerprintRows(rows: readonly { readonly kind: CounselorEventKind; readonly delta: DeltaVector }[]): string {
  const payload = JSON.stringify({
    schema: KERNEL_FINGERPRINT_SCHEMA,
    rows: rows.map(({ kind, delta }) => ({ kind, delta: canonicalize(delta) })),
  });
  return `${KERNEL_REF_PREFIX}${createHash('sha256').update(payload).digest('hex').slice(0, KERNEL_REF_HEX_LENGTH)}`;
}

/**
 * 当前内核的指纹.
 *
 * 每次调用都重新算 (纯函数); 进程内需要多次使用时直接用 `KERNEL_REF`.
 */
export function computeKernelFingerprint(): string {
  return hashFingerprintRows(fingerprintRows());
}

/**
 * 模块级指纹: 进程启动时算一次.
 *
 * 为什么缓存在模块级: 建档路径每场会话都要写它, 每次重算 13 次 `aggregateTurnDelta`
 * 是无意义的重复; 系数在进程生命周期内不会变 (纯常量表).
 */
export const KERNEL_REF: string = computeKernelFingerprint();
