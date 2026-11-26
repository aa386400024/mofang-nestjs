import { createParamDecorator, InternalServerErrorException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * @CurrentUser('userId') — 从 JWT payload 取 uid (或其他字段).
 *
 * 用法:
 *   @Get('me')
 *   @UseGuards(JwtAuthGuard)
 *   me(@CurrentUser('userId') uid: string) { ... }
 *
 *   @Get('me')
 *   @UseGuards(JwtAuthGuard)
 *   me(@CurrentUser() payload: JwtPayload) { ... }  // 不传字段名取整个 payload
 *
 * AF-537 P0-5: 未知字段不再静默返回 undefined —— 之前 `@CurrentUser('sub')`
 * 在 guard 只注入 userId 时全链路拿到 undefined，登出/解绑/consent 绑定静默失效。
 * 现在字段不存在直接 500（编程错误，必须暴露），不把身份缺失带进业务。
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
    return;
  }
  if (!field) {
    return user;
  }
  if (!Object.prototype.hasOwnProperty.call(user, field)) {
    throw new InternalServerErrorException(`CurrentUser('${field}') 字段未被 JwtAuthGuard 注入`);
  }
  return user[field];
});
