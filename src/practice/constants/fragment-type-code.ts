/**
 * V2026-09-14 治本 (Stage C 后端契约): FragmentType 5 个 code 严格枚举.
 *
 * 跟前端 lib/features/inner_world/domain/entities/fragment_type.dart 的
 * FragmentType 5 个 enum value (calm/thinking/starlight/warmth/courage) 1:1.
 * 跟 brand_colors.dart 的 5 个辅助色 token 1:1 (color hex 也对齐).
 *
 * 反双胞胎:
 *   - 不在 enum 里加 V2.1 计划的"新碎片类型" (e.g. insight, gratitude), 仍走 §4 启动期 assert.
 *   - 命名跟前端 FragmentType.code 严格一致.
 */

/** 5 种碎片 code — 跟前端 FragmentType 1:1. */
export const FRAGMENT_TYPE_CODES = [
  'calm', // 平静气泡, color = auxMintCyan
  'thinking', // 思维镜片, color = auxSoftBlue
  'starlight', // 星光粒子, color = auxMistyPink
  'warmth', // 温暖碎片, color = warning
  'courage', // 勇气结晶, color = primary
] as const;

export type FragmentTypeCode = (typeof FRAGMENT_TYPE_CODES)[number];

/** V2026-09-14 治本: 启动期一致性 assert. */
export function assertFragmentTypeContract(): void {
  if (FRAGMENT_TYPE_CODES.length !== 5) {
    throw new Error(
      `[contract] FragmentType expected 5 codes, got ${String(FRAGMENT_TYPE_CODES.length)}. ` +
        '跟前端 lib/features/inner_world/domain/entities/fragment_type.dart FragmentType enum ' +
        '必须保持 1:1 同步.',
    );
  }
}
