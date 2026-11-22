// V2026-10-15 治本 (VS-4 隐私分级 — PrivacyLevel enum + PrivacyFailure):
//   原因: V0.2 spec §17 / V0.3 spec §11.3 说 "PrivacyFailure class 已实现",
//         实际 V2026-10-15 扫代码 0 命中 PrivacyLevel / PrivacyFailure file.
//         隐私分级 enforcement 完全没做, Q17 V0.2 拍 P2 缺基础设施.
//   修法: enum PrivacyLevel 3 档 (L1_PUBLIC / L2_INTERNAL / L3_CONFIDENTIAL)
//         + class PrivacyFailure extends HttpException, L2 抛 401, L3 抛 403.
//         跟现有 biz-exception.filter.ts 兼容 (filter 看 response body code/message).
//   反双胞胎: 不复用 crisis_detector 3 级 (那是内容检测 HIGH/MEDIUM/LOW,
//             不是访问控制 L1/L2/L3, 不同职责, 不混名避免歧义).
//             不走 BizException + BizCode 体系 (V0.2 culture "大厂 standard",
//             但 V0.3 §11.3 决策 5 写 "NestJS HttpException" 直接抛, 简化;
//             后续 V1.x Phase 9 调优时统一编 32xxx BizCode 范围).
//             不引新依赖 (V0.2 culture "0 disable 注释依赖").
//   验证: 大炮跑 pnpm test 验 guard 行为 + curl 验 L1 放行 + L2 401 + L3 403.
//   时间戳: 2026-10-15

import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 隐私分级 — V0.3 spec §11.3 + Q17 V0.2 拍 P2.
 *
 * L1_PUBLIC: 公开, no auth  (e.g., published KB articles)
 * L2_INTERNAL: 已认证, JWT 鉴权 (e.g., user profile)
 * L3_CONFIDENTIAL: owner-only, JWT + ownership (e.g., diary body, training session)
 *
 * 跟 crisis_detector 的 HIGH/MEDIUM/LOW (内容检测) 是不同维度, 不混名.
 */
export enum PrivacyLevel {
  L1_PUBLIC = 'L1_PUBLIC',
  L2_INTERNAL = 'L2_INTERNAL',
  L3_CONFIDENTIAL = 'L3_CONFIDENTIAL',
}

/**
 * 隐私分级 enforcement 异常.
 *
 * L2 缺 JWT 鉴权 → 401 Unauthorized.
 * L3 缺 ownership 校验 → 403 Forbidden.
 *
 * 走 NestJS HttpException 直接抛 (不绕 BizCode 体系),
 * 跟现有 biz-exception.filter.ts 兼容 (filter 看 response body).
 */
export class PrivacyFailure extends HttpException {
  static unauthorized(message = 'Privacy L2 requires authentication'): PrivacyFailure {
    return new PrivacyFailure({ statusCode: HttpStatus.UNAUTHORIZED, message }, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(message = 'Privacy L3 requires ownership'): PrivacyFailure {
    return new PrivacyFailure({ statusCode: HttpStatus.FORBIDDEN, message }, HttpStatus.FORBIDDEN);
  }
}
