import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module';

import { DriftBottleController } from './controllers/drift-bottle.controller';
import { LifeMapController } from './controllers/life-map.controller';
import { DriftBottleEntry, GenomeDimensionEntity, KeyEventEntity, LifeStageProgressEntity } from './entities';

import { DriftBottleRepository } from './providers/drift-bottle.repository';
import { DriftBottleService } from './providers/drift-bottle.service';
import { LifeMapService } from './providers/life-map.service';

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
    DriftBottleRepository,
  ],
  exports: [LifeMapService, DriftBottleService, DriftBottleRepository],
})
export class LifeMapModule {}
