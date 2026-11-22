import type { CounselorHistoryTurn } from '../dto/counselor-types.js';

/**
 * 历史窗口裁剪 (纯函数).
 *
 * 为什么单独抽出来:
 *   以后要做"事实记忆"时, 窗口裁剪逻辑可能要改 (比如不是按轮数, 而是按 token 数),
 *   抽成纯函数后单测好写, 改起来也不影响上层.
 *
 * @param history 完整对话历史
 * @param maxTurns 最多保留多少轮 (一轮 = 咨询师一句 + 来访者一句 = 2 条消息)
 * @returns 裁剪后的历史 (最近 maxTurns * 2 条)
 */
export function sliceHistoryWindow(history: readonly CounselorHistoryTurn[], maxTurns: number): readonly CounselorHistoryTurn[] {
  const maxMessages = maxTurns * 2;
  if (history.length <= maxMessages) {
    return history;
  }
  return history.slice(-maxMessages);
}
