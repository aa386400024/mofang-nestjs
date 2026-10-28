import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DualPuzzleController } from './controllers/dual-puzzle.controller';
import { DualPuzzleAnswer } from './entities/dual-puzzle-answer.entity';
import { DualPuzzleQuestion } from './entities/dual-puzzle-question.entity';
import { DualPuzzleSet } from './entities/dual-puzzle-set.entity';

import { DualPuzzleService } from './providers/dual-puzzle.service';
import { UserModule } from '../../user/user.module';

/**
 * 默契拼图子模块 — V2026-09-12 §6.4 心塑 V6.0.
 *
 * 范围 (跟前端 lib/features/companion/view/pages/dual_puzzle_page 一一对应):
 *   - 出一组 5 题 (跨 4 类随机凑齐)
 *   - 提交答案 (1 人 1 set 仅 1 次)
 *   - 取结果 (双方都答完 → 算 chemistryScore 0..100)
 *
 * 反双胞胎:
 *   - 不复用 companion/companion.module.ts (独立业务, 单独模块)
 *   - 不复用 rehab / soothing / sync-practice / companion-tree (跨业务不同语义)
 *
 * 设计要点:
 *   - 3 张表 (questions + sets + answers)
 *   - set.questionIds JSON 数组关联 question (避免 JOIN, 大厂 standard 简化读)
 *   - Service 持有 Fisher-Yates shuffle (跟前端 InMemory 模式一致)
 */
@Module({
  imports: [TypeOrmModule.forFeature([DualPuzzleQuestion, DualPuzzleSet, DualPuzzleAnswer]), UserModule],
  controllers: [DualPuzzleController],
  providers: [DualPuzzleService],
  exports: [DualPuzzleService],
})
export class DualPuzzleModule {}
