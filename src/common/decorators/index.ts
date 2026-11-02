export * from './public.decorator';
export * from './req-user.decorator';
export * from './roles.decorator';
// V2026-10-08: tenant-id.decorator 是 TenantId / UserId 两个 param decorator
//  源头, 之前漏导出导致 @TenantId() / @UserId() 报 TS2305.
export * from './tenant-id.decorator';
// V2026-10-15 治本 (VS-4 应用 — privacy-level.decorator 漏 export, 跟 V2026-10-08 tenant-id.decorator 同 pattern):
//   原因: V2026-10-15 5 段治本建 src/common/decorators/privacy-level.decorator.ts (@RequirePrivacyLevel SetMetadata),
//     common/decorators/index.ts 漏 export, controller import `RequirePrivacyLevel` 报 TS2304 "Cannot find name".
//     跟 V2026-10-08 tenant-id.decorator 漏 export 治本同 pattern, 当时治本 V0.5 写漏没补完整.
//   修法: 1 行 export *, barrel re-export 装饰器供 controller 集中 import (跟 other decorator 风格 1:1).
//   反双胞胎:
//     - 不在 controller 逐个 import (重复 boilerplate, 跟 barrel 模式冲突),
//     - 不在 privacy-level.decorator.ts 加 export (单文件不该暴露 barrel 责任).
//   验证: 大炮跑 npx tsc -p tsconfig.json --noEmit 0 错 (VS-4 应用范围, 3 controller 0 错).
//   时间戳: 2026-10-15.
export * from './privacy-level.decorator';
