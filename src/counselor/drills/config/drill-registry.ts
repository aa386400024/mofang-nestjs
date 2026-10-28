// V2026-10-27 治本 (情景演练 · 剧本注册表 — 内容基线的单一入口):
//   原因: 任务单 §4.1/§4.2 要求两个端点都从**同一份剧本基线**取数:
//     GET /counselor/drills?track=...   —— 列表元信息 (不含关键词表)
//     GET /counselor/drills/:drillId    —— 开练详情 (不含关键词表 / 不含参考回应)
//   若这两个端点各自 import 一份剧本数组, 迟早出现"列表里有、详情 404"这类漂移
//   (新增剧本只改了其中一个 import). 注册表就是这条漂移的治本点.
//
//   修法: 本文件是剧本基线的**唯一入口**:
//     - DRILL_SCRIPTS: 全部剧本 (boundary + crisis), 只读
//     - listDrillScripts(track?): 按赛道过滤 (不带 track = 全部)
//     - findDrillScript(drillId): 单条查找 (找不到返回 null, 由 service 转 404)
//     - validateDrillScripts(): 内容基线自检 (供单测调用)
//
//   ── 物理隔离 (任务单 §5.5) ──
//   - boundary 与 crisis 剧本**分目录存放** (config/scripts/boundary/ 与 config/scripts/crisis/),
//     本文件只做**聚合**, 不做内容改写 —— 危机内容不会因为聚合而流进普通池的任何导出.
//   - 本注册表只被 `counselor/drills` 自己的 service 引用; 普通池 (visitor-pool) 与
//     practice 场景库**不引用**本文件 —— 隔离测试第 ③ 条据此断言.
//
//   ── 反双胞胎 ──
//   - **不新增第二份剧本数组**: 全仓只有这一处聚合点, 端点一律走它.
//   - **不把 crisis 剧本混进 boundary 文件**: 两个赛道各自目录, 便于隔离测试按目录核对.
//   - **不用 enum 表达 track**: 赛道是应用层字符串 (§1.1), 二期加 track 只加数据.
//   - **不在注册表里做"可见性"判断**: 剧本是全局教学素材 (所有咨询师学员都能练),
//     可见性只有"按 track 过滤"这一维; 归属/租户隔离由 service 层的 JwtAuthGuard 承担.
//
//   验证:
//     1. tsc 0 错
//     2. npx jest test/counselor/drill-judge.spec.ts 全绿 (注册表自检通过)
//     3. grep 'drill' src/counselor/config/visitor-pool-seed.ts → 0 命中 (普通池零污染)
//   时间戳: 2026-10-27 20:35 GMT+8

import { DRILL_BOUNDARY_ANCHOR_KEYS, DRILL_CRISIS_ANCHOR_KEYS, type DrillScript, type DrillTrack } from '../domain/drill.types';
import { BOUNDARY_DRILL_SCRIPTS } from './scripts/boundary/boundary-scripts';
import { CRISIS_DRILL_SCRIPTS } from './scripts/crisis/crisis-scripts';

/**
 * 全部情景剧本 (boundary + crisis).
 *
 * 只读常量 —— 调用方**不得**修改 (修改会破坏"同一份基线"的单一真值源).
 */
export const DRILL_SCRIPTS: readonly DrillScript[] = Object.freeze([...BOUNDARY_DRILL_SCRIPTS, ...CRISIS_DRILL_SCRIPTS]);

/**
 * 按赛道列出剧本.
 *
 * @param track 赛道; 不传 = 全部
 * @returns 剧本清单 (只读)
 */
export function listDrillScripts(track?: DrillTrack): readonly DrillScript[] {
  if (track === undefined) {
    return DRILL_SCRIPTS;
  }
  return DRILL_SCRIPTS.filter((script) => script.track === track);
}

/**
 * 按 drillId 查找剧本.
 *
 * @param drillId 剧本稳定 slug
 * @returns 剧本; 找不到返回 null (由 service 转成 404)
 */
export function findDrillScript(drillId: string): DrillScript | null {
  return DRILL_SCRIPTS.find((script) => script.drillId === drillId) ?? null;
}

/**
 * 内容基线自检 (供单测调用).
 *
 * 检查项:
 *   ① drillId 全局唯一
 *   ② 每个剧本的锚点 key 集合 = 该赛道的标准三锚点 (不增不减, 顺序一致)
 *   ③ 每个锚点至少有一个正向关键词与一个反向关键词 (否则该锚点永远命中或永远不命中)
 *   ④ boundary 剧本必须有 boundaryNotice; crisis 剧本必须有 boundaryNotice (合规要求)
 *   ⑤ 参考回应与常见偏差非空 (前端"可以参考这样回应 / 留意避免"两栏不能是空的)
 *   ⑥ 难度必须是 1/2/3
 *
 * @returns 错误清单 (空数组 = 通过)
 */
export function validateDrillScripts(): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const script of DRILL_SCRIPTS) {
    errors.push(...validateDrillScript(script, seenIds));
  }

  return errors;
}

/**
 * 单个剧本的内容基线校验.
 *
 * 拆成三个小函数的原因: 全部校验项塞进一个函数时 Cognitive Complexity 会顶到上限
 * (一次加一条校验就 +1, 加到第 8 条就超限) —— 那种写法下"再加一条校验"必然触发 lint 报错,
 * 于是后来的人要么压行数、要么加 eslint-disable, 都不是治本.
 * 按校验维度拆开后, 每条校验各自独立、顺序可读, 新增校验也只是往对应的小函数里加一行.
 *
 * @param script 待校验剧本
 * @param seenIds 已出现过的 drillId (跨剧本查重, 跨调用不共享)
 * @returns 错误清单
 */
function validateDrillScript(script: DrillScript, seenIds: Set<string>): string[] {
  const errors: string[] = [];

  if (seenIds.has(script.drillId)) {
    errors.push(`drillId 重复: ${script.drillId}`);
  }
  seenIds.add(script.drillId);

  const expectedKeys = script.track === 'boundary' ? BOUNDARY_EXPECTED_KEYS : CRISIS_EXPECTED_KEYS;
  errors.push(...validateDrillPoints(script, expectedKeys), ...validateDrillContent(script));

  return errors;
}

/**
 * 锚点校验: key 集合必须与赛道标准三锚点逐位一致, 且每个锚点正/反向关键词都齐备.
 *
 * @param script 待校验剧本
 * @param expectedKeys 该赛道的标准锚点 key (顺序固定)
 * @returns 错误清单
 */
function validateDrillPoints(script: DrillScript, expectedKeys: readonly string[]): string[] {
  const errors: string[] = [];
  const actualKeys = script.requiredPoints.map((point) => point.key);

  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    errors.push(`${script.drillId}: 锚点 key 集合应为 [${expectedKeys.join(', ')}], 实际 [${actualKeys.join(', ')}]`);
  }

  for (const point of script.requiredPoints) {
    if (point.positiveKeywords.length === 0) {
      errors.push(`${script.drillId}/${point.key}: 缺少正向关键词`);
    }
    if (point.antiKeywords.length === 0) {
      errors.push(`${script.drillId}/${point.key}: 缺少反向关键词`);
    }
    if (!expectedKeys.includes(point.key)) {
      errors.push(`${script.drillId}/${point.key}: 锚点 key 不属于 ${script.track} 赛道的标准集合`);
    }
  }

  return errors;
}

/**
 * 剧本内容校验: 边界声明 / 参考回应 / 常见偏差 / 难度 / 本期不实现的分支字段.
 *
 * @param script 待校验剧本
 * @returns 错误清单
 */
function validateDrillContent(script: DrillScript): string[] {
  const errors: string[] = [];

  if (!script.boundaryNotice || script.boundaryNotice.trim().length === 0) {
    errors.push(`${script.drillId}: 缺少 boundaryNotice`);
  }
  if (script.referenceResponse.trim().length === 0) {
    errors.push(`${script.drillId}: 参考回应为空`);
  }
  if (script.commonPitfalls.length === 0) {
    errors.push(`${script.drillId}: 常见偏差为空`);
  }
  if (![1, 2, 3].includes(script.difficulty)) {
    errors.push(`${script.drillId}: 难度必须是 1/2/3`);
  }
  if (script.nodes.length > 0 || script.branches.length > 0) {
    errors.push(`${script.drillId}: 本期不支持 nodes/branches (二期再做)`);
  }

  return errors;
}

/** boundary 赛道的标准三锚点 (顺序固定). */
const BOUNDARY_EXPECTED_KEYS: readonly string[] = [
  DRILL_BOUNDARY_ANCHOR_KEYS.EMPATHY,
  DRILL_BOUNDARY_ANCHOR_KEYS.HOLDS_BOUNDARY,
  DRILL_BOUNDARY_ANCHOR_KEYS.OFFERS_ALTERNATIVE,
];

/** crisis 赛道的标准三锚点 (顺序固定). */
const CRISIS_EXPECTED_KEYS: readonly string[] = [
  DRILL_CRISIS_ANCHOR_KEYS.OPEN_PROBE,
  DRILL_CRISIS_ANCHOR_KEYS.NON_JUDGMENTAL,
  DRILL_CRISIS_ANCHOR_KEYS.GUIDE_TO_SUPPORT,
];
