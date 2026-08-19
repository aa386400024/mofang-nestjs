import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * @CurrentUser('uid') — 从 JWT payload 取 uid (或其他字段).
 *
 * 用法:
 *   @Get('me')
 *   @UseGuards(JwtAuthGuard)
 *   me(@CurrentUser('uid') uid: string) { ... }
 *
 *   @Get('me')
 *   @UseGuards(JwtAuthGuard)
 *   me(@CurrentUser() payload: JwtPayload) { ... }  // 不传字段名取整个 payload
 *
 * 区别于 common/decorators/req-user.decorator.ts (@ReqUser):
 *   - @ReqUser 从 passport 注入的 request.user 取 (auth 示例用)
 *   - @CurrentUser 从我们自己的 JwtAuthGuard 注入的 request.user 取
 *   - 两个不能混用, 取决于你用哪个 guard
 */
export const CurrentUser = createParamDecorator((field: string | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: Record<string, unknown> }>();
  const user = request.user;
  if (!user) {
    return undefined;
  }
  return field ? user[field] : user;
});
