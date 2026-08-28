import { Module } from '@nestjs/common';

import { UserModule } from '../user/user.module';

import { LifeMapController } from './controllers/life-map.controller';
import { LifeMapService } from './providers/life-map.service';

/**
 * 人生地图模块 — V2.0 §Tab4 「我的数据」人生轨迹心理地图.
 *
 * V2.0 范围: 仅入口页面 (overview + timeline), 全 sample.
 * V3 接 LifeStageProgress / KeyEventRecord 表后扩展.
 */
@Module({
  imports: [UserModule],
  controllers: [LifeMapController],
  providers: [LifeMapService],
  exports: [LifeMapService],
})
export class LifeMapModule {}
