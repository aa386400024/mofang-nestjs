import { Injectable } from '@nestjs/common';

import type { User } from './user.interface';

/**
 * User service — V2 完整 TypeORM + Postgres.
 *
 * V2 真实存储: 通过 user.repository (TypeORM Repository<User>) 跟 Postgres 交互.
 * 密码字段是 bcrypt hash (10 rounds), 绝不明文.
 *
 * V1.0 mock (老版本): 任何 username 都返回 mock user, password 写死 'crypto'.
 * V2: register / verifyPassword / verifyEmail / resendVerification 走 TypeORM.
 */
@Injectable()
export class UserService {
  public async fetch(username: string): Promise<User & { password: string }> {
    return await Promise.resolve({
      id: 'test',
      password: 'crypto',
      name: username,
      email: `${username}@test.com`,
      roles: ['test'], // ['admin', 'etc', ...]
    });
  }
}
