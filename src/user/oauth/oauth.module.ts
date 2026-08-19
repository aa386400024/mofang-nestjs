import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OAuthService } from './oauth.service';
import { OAuthController } from './oauth.controller';
import { OAuthIdentity } from '../entities/oauth-identity.entity';
import { User } from '../entities/user.entity';
import { UserModule } from '../user.module';

/**
 * OAuth module — 第三方登录 (微信/Google/Apple).
 *
 * 依赖 UserModule (拿 UserService 用于 buildAuthResponse).
 * 不依赖 passport strategies (V2 直接验 id_token, 简化流程).
 *
 * V3 加 passport strategies (passport-google-oauth20 / passport-apple / passport-wechat):
 *   - 完整 OAuth 2.0 redirect 流程 (适合 PC 浏览器)
 *   - 当前 V2 适合 H5/移动 (前端拿 id_token 后调后端)
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, OAuthIdentity]), UserModule],
  providers: [OAuthService],
  controllers: [OAuthController],
  exports: [OAuthService],
})
export class OAuthModule {}