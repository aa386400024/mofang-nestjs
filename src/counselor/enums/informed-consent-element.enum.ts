// V2026-10-21 治本 (V1.2 VS-C — 知情同意 4 要素 enum):
//   原因: v1.2 spec §5.1 内置知情同意流程要求咨询师在对话中向来访说明 4 件事:
//     ① 咨询性质与局限性  → nature
//     ② 保密原则与保密例外 (自伤/伤人/未成年人保护) → confidentiality
//     ③ 会谈时长、频率、设置边界 → logistics
//     ④ 本次会谈是否录音 (仅用于训练复盘) → recording
//     4 要素的判定结果要逐项落库 (covered / visitorResponse / coveredAtTurn),
//     所以需要一个**稳定枚举**做 json 数组的元素类型, 而不是散落的字符串字面量.
//   修法: InformedConsentElement enum, 4 值, 与 spec §5.4 的
//     `element: 'nature' | 'confidentiality' | 'logistics' | 'recording'` 1:1 wire.
//   反双胞胎:
//     - 不用中文做 value: 落库的 json 是接口契约, 前端要按 value 判定, 中文会绑死显示语言
//     - 不加 'none' / 'partial' 档: 覆盖度是**布尔** (covered: true/false), 部分覆盖
//       记为 false + note, 不需要第三态 (spec §5.4 的 schema 就是布尔)
//     - 不加 'other': 4 要素是 spec 拍板的固定清单; 将来要扩, 走 spec 变更 + enum 增补
//   验证: 1. tsc 0 错  2. 判定结果落库后 4 个 element 齐全
//   时间戳: 2026-10-21

/**
 * 知情同意 4 要素 (v1.2 spec §5.1 / §5.4).
 */
export enum InformedConsentElement {
  /** ① 咨询性质与局限性 */
  NATURE = 'nature',
  /** ② 保密原则与保密例外 (自伤/伤人/未成年人保护) */
  CONFIDENTIALITY = 'confidentiality',
  /** ③ 会谈时长、频率、设置边界 */
  LOGISTICS = 'logistics',
  /** ④ 本次会谈是否录音 (仅用于训练复盘) */
  RECORDING = 'recording',
}

/** 取值数组 (给 class-validator 的 @IsIn 用). */
export const INFORMED_CONSENT_ELEMENT_VALUES = [
  InformedConsentElement.NATURE,
  InformedConsentElement.CONFIDENTIALITY,
  InformedConsentElement.LOGISTICS,
  InformedConsentElement.RECORDING,
] as const;

/**
 * 4 要素的中文名 (给 prompt / 督导报告用, 前端展示仍走前端 i18n).
 */
export const INFORMED_CONSENT_ELEMENT_LABELS: Record<InformedConsentElement, string> = {
  [InformedConsentElement.NATURE]: '咨询性质与局限性',
  [InformedConsentElement.CONFIDENTIALITY]: '保密原则与保密例外',
  [InformedConsentElement.LOGISTICS]: '会谈时长、频率与设置边界',
  [InformedConsentElement.RECORDING]: '本次会谈是否录音',
};
