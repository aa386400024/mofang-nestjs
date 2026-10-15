// V2026-10-15 治本 (VS-4 隐私分级 — RequirePrivacyLevel 装饰器):
//   原因: spec V0.3 §11.3 标 "完整 enforcement 待做", 缺 @PrivacyLevel 装饰器.
//   修法: 跟现有 public.decorator.ts / roles.decorator.ts 同 pattern,
//         SetMetadata('privacy_level', level) 存元数据.
//         命名 RequirePrivacyLevel 避开 enum PrivacyLevel 同名.
//   反双胞胎: 不复用 @Roles (那是 admin RBAC, 不是访问层级, 不同职责).
//             不写 class decorator (method-only 足够, V0.x 估不需要 class-level).
//   验证: 大炮跑 pnpm test 验 Reflector.get('privacy_level') 返值 + 业务用
//         @UseGuards(JwtAuthGuard, PrivacyGuard) @RequirePrivacyLevel(...)
//         顺序生效.
//   时间戳: 2026-10-15

import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import { type PrivacyLevel } from '../privacy/privacy-level.enum';

/**
 * @RequirePrivacyLevel(PrivacyLevel.L3_CONFIDENTIAL) — 装饰 controller method
 * 标记隐私分级 enforcement. 跟 @UseGuards(JwtAuthGuard, PrivacyGuard) 配套用.
 *
 * JwtAuthGuard 必须**先跑** (在 PrivacyGuard 之前), 拿到 request.user 后
 * PrivacyGuard 才能做 L3 ownership check.
 */
export const RequirePrivacyLevel = (level: PrivacyLevel): CustomDecorator => SetMetadata('privacy_level', level);
