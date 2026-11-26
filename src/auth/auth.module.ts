import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AuthService } from './auth.service.js';
import { LoginCodeService } from './login-code.service.js';
import { JwtStrategy } from './strategies/index.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwtSecret'),
        signOptions: { expiresIn: '1d', algorithm: 'HS256' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, LoginCodeService, JwtStrategy],
  exports: [AuthService, LoginCodeService],
})
export class AuthModule {}
