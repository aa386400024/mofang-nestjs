/**
 * V2026-09-11 治本 (好状态日记 · 标签语义):
 *   原因: 4 个标签覆盖「积极心理学」核心维度 (好事 = savoring, 洞察 = insight,
 *         挑战 = coping, 感恩 = gratitude), 严格遵循 Seligman 积极心理学框架.
 *         改这里必须同步改前端 DiaryTag 枚举.
 *   修复: TS enum 镜像前端, 编译期防拼写错误 (User 想加新维度必须改这里,
 *         不会在多处游离).
 *   如何验证: 编辑器 chip 列表显示 4 个标签, 切换选中态走 Set<DiaryTag> 唯一性,
 *             列表页用 setEquality 比对.
 */

/**
 * 好状态日记标签 — 4 选多.
 *
 * 心理学映射 (Seligman 积极心理学 PERMA 模型):
 *   - goodMoment → savoring (品味积极瞬间)
 *   - insight    → cognitive insight (认知洞察)
 *   - challenge  → coping (应对挑战)
 *   - gratitude  → gratitude (感恩)
 *
 * 跟前端 `lib/features/good_state_diary/domain/entities/diary_tag.dart`
 * 的 DiaryTag 1:1 镜像.
 */
export enum DiaryTag {
  /** 好事 — 想记住的一个好瞬间 (品味, savoring). */
  GoodMoment = 'goodMoment',

  /** 洞察 — 想明白的一点小事 (认知洞察, insight). */
  Insight = 'insight',

  /** 挑战 — 今天有点难的时刻 (应对, coping). */
  Challenge = 'challenge',

  /** 感恩 — 想要感谢的人或事 (感恩, gratitude). */
  Gratitude = 'gratitude',
}

export const DIARY_TAG_VALUES: DiaryTag[] = [DiaryTag.GoodMoment, DiaryTag.Insight, DiaryTag.Challenge, DiaryTag.Gratitude];

/** 字符串解析 — 非法值返回 null (调用方 .filter 兜底). */
export function parseDiaryTag(value: string | null | undefined): DiaryTag | null {
  if (!value) return null;
  for (const tag of DIARY_TAG_VALUES) {
    if (tag === value) return tag;
  }
  return null;
}

/**
 * 解析字符串数组为合法 DiaryTag 列表 — 容错: 非法值静默丢弃 (单条脏数据不能阻塞列表渲染).
 * 大厂 spec: 输入层 1:1 防御, 不让前端 bug 拉崩整个列表接口.
 */
export function parseDiaryTagList(raw: readonly string[] | null | undefined): DiaryTag[] {
  if (!raw) return [];
  const result: DiaryTag[] = [];
  for (const s of raw) {
    const tag = parseDiaryTag(s);
    if (tag !== null) result.push(tag);
  }
  return result;
}

/** 序列化为字符串数组 (DB 存储 / API 响应). */
export function stringifyDiaryTagList(tags: readonly DiaryTag[]): string[] {
  return tags.map((t) => t as string);
}

/**
 * DB 存储的字符串 (comma-separated tag names) — 给 VARCHAR 列直接存.
 *
 * 大厂 spec: DB 列名 + 序列化方式集中在一处维护. 这里跟前端 DiaryTag.encode 1:1.
 */
export function encodeDiaryTags(tags: readonly DiaryTag[]): string {
  return tags.map((t) => t as string).join(',');
}

/** 由 comma-separated 字符串解析回 DiaryTag 列表. */
export function decodeDiaryTags(raw: string | null | undefined): DiaryTag[] {
  if (!raw) return [];
  return parseDiaryTagList(raw.split(',').map((s) => s.trim()));
}
