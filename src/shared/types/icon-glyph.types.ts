/**
 * 前端图标注册表枚举名 —「emoji 清零」兼容契约.
 *
 * 背景:
 *   Flutter 端把 emoji 图标切换为 AppIcons 四族
 *   (AppIcons / AppIconsGrowth / AppIconsPractice / AppIconsPeople) 的 SVG 枚举.
 *   后端不再只下发 emoji 字符串, 而是同版本追加枚举名字段:
 *     - avatarGlyph: 陪伴对象 / 伙伴列表 / 首页支撑关系
 *     - coverGlyph:  guide 课程封面
 *     - glyph:       首页工具卡 / 微干预工具卡 / 咨询师端入口卡
 *
 * 约定:
 *   - 值只能是本文件白名单内的枚举名, 不得是 emoji / Unicode 码点.
 *   - 字段可空; 未知或空值由前端兜底 `personUser`.
 *   - 同一响应对象内, 旧 emoji 字段与新 glyph 字段指向同一图形语义.
 *   - 旧字段至少保留一个版本, 迁移完成后单独提删旧字段的 PR.
 *
 * 单一事实源:
 *   白名单只在此处声明, DTO 的 `enum` 与测试都从这里引用, 避免多处复制漂移.
 */
export const ICON_GLYPHS = [
  'personUser',
  'personSupport',
  'personFriend',
  'personFamily',
  'personCompanion',
  'personVerified',
  'statusCare',
  'statusSuccess',
  'statusWarning',
  'moodNature',
  'moodGreat',
  'moodGood',
  'moodNeutral',
  'moodLow',
  'moodCrisis',
  'growthTarget',
  'growthStar',
  'growthBadgeCompanion',
  'actionMail',
  'actionShare',
  'actionArchive',
  'systemHandbook',
  'practiceBreathing',
] as const;

export type IconGlyph = (typeof ICON_GLYPHS)[number];

/** 前端未知值兜底枚举 — 仅作为契约说明, 后端不强制回填. */
export const DEFAULT_ICON_GLYPH: IconGlyph = 'personUser';

/** 运行时白名单判定 (供种子校验 / 测试断言使用). */
export function isIconGlyph(value: unknown): value is IconGlyph {
  return typeof value === 'string' && (ICON_GLYPHS as readonly string[]).includes(value);
}
