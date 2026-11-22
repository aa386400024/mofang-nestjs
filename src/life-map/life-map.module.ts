import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module.js';

import { DriftBottleController } from './controllers/drift-bottle.controller.js';
import { LifeMapController } from './controllers/life-map.controller.js';
import { DriftBottleRepositoryTypeorm } from './data/drift-bottle.repository.typeorm.js';
import { GenomeDimensionRepositoryTypeorm } from './data/genome-dimension.repository.typeorm.js';
import { KeyEventRepositoryTypeorm } from './data/key-event.repository.typeorm.js';
import { LifeStageProgressRepositoryTypeorm } from './data/life-stage-progress.repository.typeorm.js';
import { DRIFT_BOTTLE_REPOSITORY } from './domain/repositories/drift-bottle.repository.js';
import { GENOME_DIMENSION_REPOSITORY } from './domain/repositories/genome-dimension.repository.js';
import { KEY_EVENT_REPOSITORY } from './domain/repositories/key-event.repository.js';
import { LIFE_STAGE_PROGRESS_REPOSITORY } from './domain/repositories/life-stage-progress.repository.js';
import { DriftBottleEntry, GenomeDimensionEntity, KeyEventEntity, LifeStageProgressEntity } from './entities/index.js';

import { DriftBottleService } from './providers/drift-bottle.service.js';
import { LifeMapService } from './providers/life-map.service.js';

/**
 * 心理地图 / 人生地图 Module — V3.0 §3 + V6.0 §6 心塑 V6.0.
 *
 * V3.0 范围 (§3 人生地图 + 推演 + 报告):
 *   - 人生地图入口 / 时间轴 / 阶段梳理 / 关键事件 / 基因盘点
 *   - 人生剧本推演 + 综合成长报告
 *
 * V6.0 范围 (§6.5 漂流瓶):
 *   - 漂流瓶 (DRIFT / PICKED / RESPONDED 三态机)
 *   - 6 个 REST 端点: 投 / 海面 / 我的 / 收件箱 / 统计 / 回信
 *
 * 反双胞胎 (关键, V6.0 修复):
 *   - V3.0 entity / controller / service 全保留 (叠加, 不覆盖)
 *   - V6.0 漂流瓶文件是新增 (drift-bottle-*.entity/dto/controller/service/repository)
 *   - 唯一对外模块名 LifeMapModule, 跟前端 lib/features/life_map/ 1:1
 *
 * 设计要点:
 *   - TypeOrmModule.forFeature 注入 4 张 entity (3 张 V3.0 + 1 张 V6.0)
 *   - V3.0 / V6.0 service 独立持有, 互不耦合
 *   - 2 个 controller 独立暴露 REST 端点 (V3 / V6 各 1)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      // V3.0 entity (3 张)
      GenomeDimensionEntity,
      KeyEventEntity,
      LifeStageProgressEntity,
      // V6.0 entity (1 张)
      DriftBottleEntry,
    ]),
    UserModule,
  ],
  controllers: [
    // V3.0 controller (心理地图主页 + 评估子模块)
    LifeMapController,
    // V6.0 controller (§6.5 漂流瓶)
    DriftBottleController,
  ],
  providers: [
    // V3.0 service
    LifeMapService,
    // V6.0 service
    DriftBottleService,
    // V2026-11-14 治本 (TD-16 · C1 试点域): 仓储端口接线 —— service 依赖 token,
    //   不依赖 TypeORM 实现类. 4 个端口各一个 TypeORM 实现, typeorm 值符号
    //   只出现在 data/ 实现文件与本装配层.
    //   仓储 token **不 export**: life-map 仓储不被跨模块消费 (外部只消费
    //   LifeMapService / DriftBottleService), 不给外部开第二个入口 (对齐 TD-13 D-4).
    {
      provide: LIFE_STAGE_PROGRESS_REPOSITORY,
      useClass: LifeStageProgressRepositoryTypeorm,
    },
    {
      provide: KEY_EVENT_REPOSITORY,
      useClass: KeyEventRepositoryTypeorm,
    },
    {
      provide: GENOME_DIMENSION_REPOSITORY,
      useClass: GenomeDimensionRepositoryTypeorm,
    },
    {
      provide: DRIFT_BOTTLE_REPOSITORY,
      useClass: DriftBottleRepositoryTypeorm,
    },
  ],
  exports: [LifeMapService, DriftBottleService],
})
export class LifeMapModule {}
