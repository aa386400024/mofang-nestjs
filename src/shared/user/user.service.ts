import { Injectable } from '@nestjs/common';

import type { User } from './user.interface';

/**
 * User service — shared (legacy compat).
 *
 * V1.0 mock 保留, V1.1 代码已迁到 `src/user/providers/user.service.ts`
 * (完整 V2 enterprise: bcrypt + TypeORM + 账户锁定 + 密码历史 + session 管理).
 *
 * 这里仅保留 fetch() 给老 AuthService.validateUser() 兜底用 (Passport-Local 演示路径).
 * 实际新流程 (心塑前端 V1.1) 走 `src/user/providers/user.service.ts` 的真 UserService.
 */
@Injectable()
export class UserService {
  public async fetch(username: string): Promise<User & { password: string }> {
    return await Promise.resolve({
      id: 'test',
      password: 'crypto',
      name: username,
      email: `${username}@test.com`,
      roles: ['test'],
    });
  }
}
