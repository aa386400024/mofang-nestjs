import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import * as controllers from './controllers';
import { UserModule } from '../user/user.module';

/**
 * Base module — V1.1 升级: 接入真 UserService (V2 enterprise).
 *
 * 之前 BaseModule 只 import TerminusModule + HttpModule, auth controller
 * 走的是 shared/user mock. V1.1 改用 V2 enterprise UserService:
 *   - bcrypt hash (10 rounds)
 *   - TypeORM Repository<User>
 *   - 完整风控 (账户锁定/邮箱验证/改密周期/审计日志)
 *
 * 依赖:
 *   - UserModule (提供 UserService + JwtModule + User entity)
 *   - TerminusModule (健康检查)
 *   - HttpModule (HTTP client, 给 auth controller 后续 OAuth 准备)
 */
@Module({
  imports: [TerminusModule, HttpModule, UserModule],
  controllers: Object.values(controllers),
})
export class BaseModule {}
