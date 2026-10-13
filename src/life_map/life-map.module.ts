// V2026-10-13 治本 (Phase 7.10 P0-6 — life-map.module.ts):
//   心塑 心理地图 Tab server module.

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { UserModule } from '../user';

import { LifeMapController } from './controllers/life-map.controller';
import { LifeMapService } from './providers/life-map.service';

/**
 * V2026-10-13 (Phase 7.10 P0-6 — LifeMapModule):
 *   心塑 心理地图 Tab server module.
 *
 *   V0.5: 1 controller (overview), 内存 mock, V1.x 接 life_stages + key_events + genome_dimensions 表.
 */
@Module({
  imports: [UserModule, AuthModule],
  controllers: [LifeMapController],
  providers: [LifeMapService],
  exports: [LifeMapService],
})
export class LifeMapModule {}
