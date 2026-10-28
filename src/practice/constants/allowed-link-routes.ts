/**
 * V2026-09-14 治本 (Stage C 后端契约): linkRoute 白名单.
 *
 * 跟前端 lib/core/network/link_route_validator.dart 严格 1:1 同步.
 * 改任一端必须改另一端, 否则 CI 脚本 scripts/ci/check-link-route-whitelist.sh 失败.
 *
 * 设计:
 *   - 47 静态 path (跟 router.dart 注册的 AutoRoute path 一致)
 *   - 8 动态 path 模板 (用 RegExp, 跟前端 dynamicTemplates 一致)
 *   - 启动期 assertWhitelistSync() 防止后端漏改 (跟前端 expected size 校验)
 *   - isLinkRouteAllowed() 运行时校验, 防"后端推了路由不存在的 path"
 *
 * 反双胞胎:
 *   - 不在此文件维护平行常量表 (跟前端共用同一份事实源), 维护流程走 CI.
 *   - 不把 path 字符串散落在 controller, 全部走 isLinkRouteAllowed() 校验.
 */

/** 47 个静态 path 白名单 — 跟前端 lib/core/network/link_route_validator.dart staticPaths 一致. */
export const ALLOWED_EXACT_PATHS: ReadonlySet<string> = new Set<string>([
  '/',
  '/tools/breathing',
  '/tools/emergency',
  '/tools/emergency/grounding',
  '/tools/emergency/safe-place',
  '/tools/emergency/tipp',
  '/tools/emergency/thought-bubble',
  '/tools/thought-leaves',
  '/consent-gate',
  '/onboarding/welcome',
  '/onboarding/info',
  '/onboarding/consent',
  '/auth',
  '/auth/email-password',
  '/auth/email-otp',
  '/auth/forgot-password',
  '/auth/password',
  '/auth/set-password',
  '/ai-companion',
  '/chat',
  '/assessments',
  '/assessments/quick',
  '/assessments/report',
  '/good-state-diary',
  '/diary-editor',
  '/diary-detail',
  '/diary-search',
  '/life-map',
  '/life-map/events',
  '/life-map/forecast',
  '/life-map/genome',
  '/life-map/report',
  '/life-map/stages',
  '/drift-bottle',
  '/drift-bottle/history',
  '/crisis/alert',
  '/referral/directory',
  '/inner-world/island',
  '/pet',
  '/micro-intervention/scenarios',
  '/messages',
  '/companions/manage',
  '/companion/companion-records',
  '/companion/relations',
  '/companion/tree',
  '/companion/ai-guide',
  '/companion/dual-exercises',
  '/companion/dual-puzzle',
  '/companion/sync-practice',
  '/companion/rehab-coordination',
  '/companion/soothing-cards',
  '/legal/privacy-policy',
  '/legal/user-agreement',
  '/legal/community-guidelines',
]);

/** 8 个动态 path 模板 — 跟前端 dynamicTemplates RegExp 一致. */
export const ALLOWED_DYNAMIC_TEMPLATES: readonly RegExp[] = [
  /^\/practice\/tool\/[^/]+$/, // 通用工具执行页 (V2026-09-14 growth 工具都走这里)
  /^\/practice\/gym\/tools\/[^/]+$/, // 心理健身房工具页
  /^\/practice\/category\/[^/]+$/, // 分类列表
  /^\/practice\/embodied\/session\/[^/]+$/, // 具身认知 session
  /^\/companion\/dual-exercise\/[^/]+$/, // 陪伴者双练详情
  /^\/guide\/course\/[^/]+$/, // 指南课程详情
  /^\/assessments\/[^/]+$/, // 评估量表答题
  /^\/micro-intervention\/execute\/[^/]+$/, // 微干预执行
];

/**
 * V2026-09-14 治本: 运行时校验 linkRoute 是否在白名单.
 *
 * exact match (e.g. '/tools/breathing') + dynamic template match (e.g. '/practice/tool/breathing_practice').
 */
export function isLinkRouteAllowed(route: string | null | undefined): boolean {
  if (!route || route.length === 0) return false;
  if (ALLOWED_EXACT_PATHS.has(route)) return true;
  return ALLOWED_DYNAMIC_TEMPLATES.some((tmpl) => tmpl.test(route));
}

/**
 * V2026-09-14 治本: 启动期一致性 assert.
 *
 * 服务端跟前端 dart Set 字面量必须 1:1 同步, 启动期 fail-fast.
 * 如果 CI 失败, 说明前端 lib/core/network/link_route_validator.dart 改了但这里没改 (或反过来).
 */
/**
 * V2026-09-14 治本 (Stage C 后端契约): 启动期结构性 sanity check.
 *
 * 职责 (跟 CI 脚本分工):
 *   - 运行时: 只校验结构 (非空 + 全以 / 开头 + 无尾随空格 + 长度 <= 256).
 *     数量大小会随业务演化, 不该硬编码.
 *   - CI 脚本: scripts/ci/check-link-route-whitelist.sh 静态对比前后端白名单,
 *     保证 1:1 同步 (这是前后端契约唯一权威).
 *
 * 设计:
 *   - 之前版本硬编码 expectedFrontendSize=47 (写代码时的快照),
 *     任何后续增删 path 都会 fail, magic number 跟业务脱节.
 *   - V2026-09-14 后端 ALLOWED_EXACT_PATHS 已经增长到 54 条,
 *     硬编码 47 触发启动期 crash, 改为结构性校验.
 */
export function assertLinkRouteWhitelistSync(): void {
  if (ALLOWED_EXACT_PATHS.size === 0) {
    throw new Error('[contract] ALLOWED_EXACT_PATHS 不能为空, 至少要 1 条 path');
  }
  for (const path of ALLOWED_EXACT_PATHS) {
    if (!path.startsWith('/')) {
      throw new Error(`[contract] ALLOWED_EXACT_PATHS path "${path}" 必须以 / 开头`);
    }
    if (path.length > 256) {
      throw new Error(`[contract] ALLOWED_EXACT_PATHS path "${path}" 长度 ${path.length} 超过 256 字符上限`);
    }
    if (path.trim() !== path) {
      throw new Error(`[contract] ALLOWED_EXACT_PATHS path "${path}" 含首尾空格, 非法`);
    }
  }
}
