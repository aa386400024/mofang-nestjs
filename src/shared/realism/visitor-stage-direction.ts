// V2026-11-22 建立 (AF-281 · 来访者台词投影 · 去舞台说明):
//   职责: 把模型偶发写出的括号/星号舞台说明从流式或聚合产物里确定性剥离，
//         保证 TTS 拿到的是可出声台词，而不是“（叹气）”这种旁白。
//   边界: 纯函数；不读 env、不调模型、不依赖 NestJS。
//
// 为什么放在渲染边界而不是只靠 prompt:
//   V5 已经把“不写括号动作”写进约束，实测 12 轮仍会漏 1 次。输出格式是硬契约，
//   硬契约不能依赖采样概率；prompt 负责“尽量不写”，投影层负责“写了也不会出声”。

const STAGE_DIRECTION = /（[^）]{1,30}）|\([^)]{1,30}\)|【[^】]{1,30}】|\*[^*\n]{1,30}\*/gu;

/**
 * 剥离台词里的舞台说明，保留可出声内容。
 *
 * - 括号/星号片段直接删除，不转换成旁白；
 * - 删除后为空时退回沉默占位，避免返回空串触发调用方降级；
 * - 连续空白折叠，句首残留标点清掉。
 *
 * @param text 模型原始台词
 * @returns 可直接交给 TTS 的台词
 */
export function stripVisitorStageDirections(text: string): string {
  const withoutDirections = text.replaceAll(STAGE_DIRECTION, ' ');
  const normalized = withoutDirections
    .replaceAll(/[ \t]+/gu, ' ')
    .replace(/^[\s，,。.、；;：:]+/u, '')
    .trim();
  return normalized.length > 0 ? normalized : '……';
}
