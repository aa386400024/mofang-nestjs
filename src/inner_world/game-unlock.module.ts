// V2026-09-04 治本 (V6.0 §6 + §3.3):
//   Inner World 游戏化模块解锁进度模块 — 仅做服务端镜像 + 跨设备同步.
//   游戏模块本身 (companion_tree / pet_cultivation / time_capsule / puzzle_pet)
//   逻辑在端侧, 服务端只读 + 写状态.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module';

import { GameUnlockController } from './controllers/game-unlock.controller';
import { GameUnlockProgressEntity } from './entities/game-unlock-progress.entity';
import { GameUnlockService } from './providers/game-unlock.service';

@Module({
  imports: [TypeOrmModule.forFeature([GameUnlockProgressEntity]), UserModule],
  controllers: [GameUnlockController],
  providers: [GameUnlockService],
  exports: [GameUnlockService],
})
export class GameUnlockModule {}
