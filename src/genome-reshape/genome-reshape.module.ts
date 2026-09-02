import { Module } from '@nestjs/common';

import { UserModule } from '../user/user.module';

import { GenomeReshapeController } from './controllers/genome-reshape.controller';
import { GenomeReshapeService } from './providers/genome-reshape.service';

/**
 * 心理基因靶向重塑模块 — V3.0 §3 Tab3 评估子模块 + 心理健身房共用.
 *
 * V3.0 范围:
 *   - 卡点库 (静态 5 个)
 *   - 4 周重塑任务 (静态模板)
 *   - 用户进度 (内存态)
 *   - 松动度上报
 *
 * V3.0 治本:
 *   - 不依赖 TypeORM, 全部内存态, V3.1 接持久化
 *   - 模块独立: 跟 LifeMapModule / PracticeModule 解耦
 *   - 渐进解锁条件走 query string 传入, 避免 service 间耦合
 */
@Module({
  imports: [UserModule],
  controllers: [GenomeReshapeController],
  providers: [GenomeReshapeService],
  exports: [GenomeReshapeService],
})
export class GenomeReshapeModule {}
