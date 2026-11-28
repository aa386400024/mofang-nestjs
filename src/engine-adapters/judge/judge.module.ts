// V2026-11-29 (Phase3 Judge Layer P0 · Nest 装配):
//   职责: 把 MiniMax Judge Provider 绑到 ReviewJudgePort token, 供批次编排按需注入.
//   边界: 不自动接进现有 EvalModule / 批次跑批入口 —— P0 只提供端口与装配, 由调用方显式启用 Shadow,
//     避免在未拍板 P1 (双 Judge / 人工队列) 前改变现网批次行为.

import { Module } from '@nestjs/common';

import { MinimaxJudgeProvider } from './judge.provider.js';
import { CounselorModule } from '../../counselor/counselor.module.js';

/** ReviewJudgePort 注入 token. */
export const JUDGE_REVIEW_PORT = 'JUDGE_REVIEW_PORT';

@Module({
  imports: [CounselorModule],
  providers: [MinimaxJudgeProvider, { provide: JUDGE_REVIEW_PORT, useExisting: MinimaxJudgeProvider }],
  exports: [JUDGE_REVIEW_PORT, MinimaxJudgeProvider],
})
export class JudgeModule {}
