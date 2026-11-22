/**
 * User module barrel export.
 *
 * 按项目示例规范 (README §Index Exporting):
 *   - 从文件夹而不是单文件 import
 *   - 路径最后只放一个文件名
 */
export type * from './user.constant.js';
export * from './user.constant.js';
export type * from './user.state.js';
export * from './user.state.js';
export type * from './entities/user.entity.js';
export * from './entities/user.entity.js';
export type * from './entities/audit-log.entity.js';
export * from './entities/audit-log.entity.js';
export type * from './entities/oauth-identity.entity.js';
export * from './entities/oauth-identity.entity.js';
export type * from './enums/audit-event.enum.js';
export * from './enums/audit-event.enum.js';
export type * from './enums/oauth-provider.enum.js';
export * from './enums/oauth-provider.enum.js';
export type * from './dto/register.dto.js';
export * from './dto/register.dto.js';
export type * from './dto/login.dto.js';
export * from './dto/login.dto.js';
export type * from './dto/refresh-token.dto.js';
export * from './dto/refresh-token.dto.js';
export type * from './dto/auth-response.dto.js';
export * from './dto/auth-response.dto.js';
export * from './providers/user.service.js';
export * from './controllers/user.controller.js';
export * from './guards/jwt-auth.guard.js';
export * from './decorators/current-user.decorator.js';
export * from './user.module.js';
