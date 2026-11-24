// AF-475 · 单进程逐轮配对的顺序纯函数.
// 边界: 零 IO；只决定同一轮 base/active 谁先发，避免固定顺序带来的一致偏置.

/**
 * 返回某一轮的 base/active 执行顺序.
 *
 * 偶数轮 base 先发，奇数轮 active 先发；30 轮下来两边各先发 15 次。
 *
 * @param {number} turnIndex 0-based 轮次
 * @returns {readonly ['base', 'active'] | readonly ['active', 'base']}
 */
export function pairedTurnOrder(turnIndex) {
  if (!Number.isInteger(turnIndex) || turnIndex < 0) {
    throw new Error(`turnIndex 必须是非负整数：${turnIndex}`);
  }
  return turnIndex % 2 === 0 ? ['base', 'active'] : ['active', 'base'];
}
