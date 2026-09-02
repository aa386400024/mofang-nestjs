/**
 * Consent module barrel export.
 *
 * 按项目示例规范 (README §Index Exporting):
 *   - 从文件夹而不是单文件 import
 *   - 路径最后只放一个文件名
 */
export type * from './entities/user-consent.entity';
export * from './entities/user-consent.entity';
export type * from './dto/record-consent.dto';
export * from './dto/record-consent.dto';
export type * from './dto/consent-status.dto';
export * from './dto/consent-status.dto';
export type * from './dto/bind-to-user.dto';
export * from './dto/bind-to-user.dto';
export * from './providers/consent.service';
export * from './consent.module';
