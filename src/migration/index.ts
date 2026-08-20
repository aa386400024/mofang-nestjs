/**
 * Migration barrel — 集中导出所有迁移类.
 *
 * 用法 (供 bin/ormconfig.ts 或手动 import):
 *   import * as migrations from '../src/migration';
 *   const list = Object.values(migrations).filter(m => m.name && typeof m.up === 'function');
 */
export * from './1700000000000-InitUser';
export * from './1700000001000-AddUserV2Fields';
export * from './1700000002000-AddSessionV2Fields';
export * from './1700000003000-AddPasswordHistory';
export * from './1700000004000-AddOAuthIdentity';
export * from './1700000005000-AddUserEmailIndex';
export * from './1700000006000-AddUserConsent';
