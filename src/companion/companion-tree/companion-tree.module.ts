import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompanionTreeController } from './controllers/companion-tree.controller';
import { CompanionTree } from './entities/companion-tree.entity';
import { TreeWaterLog } from './entities/tree-water-log.entity';

import { CompanionTreeService } from './providers/companion-tree.service';
import { UserModule } from '../../user/user.module';

/**
 * 共种陪伴树子模块 — V2026-09-12 §6.3 心塑 V6.0.
 *
 * 范围 (跟前端 lib/features/companion/view/pages/companion_tree_page 一一对应):
 *   - 5 阶段树 (种子 / 幼苗 / 小树 / 中树 / 大树)
 *   - 双作者共养 (water/fertilize/prune 三动作)
 *   - 里程碑 (50 / 200 / 500 次浇水触发)
 *
 * 反双胞胎:
 *   - 不复用 companion/companion.module.ts (独立业务, 单独模块, 大厂 standard 隔离)
 *   - 不复用 rehab / soothing / sync-practice (无关业务)
 *
 * 设计要点:
 *   - 2 张表 (companion_trees + companion_tree_water_logs), 1:N 关联
 *   - Service 持有 process memory 冷却 Map (跟前端 DriftBottleRepositoryImpl 模式一致)
 *   - Controller 暴露 5 个端点 (active / care / mine / logs + 兼容性占位)
 */
@Module({
  imports: [TypeOrmModule.forFeature([CompanionTree, TreeWaterLog]), UserModule],
  controllers: [CompanionTreeController],
  providers: [CompanionTreeService],
  exports: [CompanionTreeService],
})
export class CompanionTreeModule {}
