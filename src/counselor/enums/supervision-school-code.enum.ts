// V2026-10-15 治本 (V2.1 — supervision_school.code 4 流派枚举):
//   原因: counselor-mode-v1.0 §4.6 拍板 4 督导流派 (CBT/精神动力学/人本/家庭治疗),
//     V0.3 §8 baseline 单流派 supervisor 6 维度, V1.x 升级 4 流派差异化, 1:1 wire 0
//     破坏 V0.3 §13 baseline (V0.x supervision_schools 表 0, V1.x 新建).
//
//   修法:
//     - 4 流派 code 跟 counselor-mode-v1.0 §4.6 表严格 1:1 (snake_case, 跟 user.state /
//       KB type / LongTermCaseType 同 pattern)
//     - 静态 enum (无 DB 行, 跟 V0.x enum 风格一致), 1:1 wire 跨 server-client
//     - 4 code 跟 supervision-school-presets.ts 4 preset 1:1 配对
//     - 用 snake_case 字符串值 (跟 V0.x enum 风格一致), xin_su_app 端 LongTermCaseSupervisionSchool enum 1:1
//
//   反双胞胎:
//     - 不用 i18n key: V0.x 阶段中文, V1.x 多语言时再加 i18n layer
//     - 不在 enum 加 i18n name: name 字段走 supervision_schools.name json 字段 (DB 存),
//       4 流派固定中文名 V0.x 阶段走 enum
//     - 不用 varchar(50) free-form: 强 enum 约束 (V0.x baseline pattern), 防 drift
//
//   验证:
//     1. SELECT enum: 4 值全在
//     2. 跟 counselor-mode-v1.0 §4.6 表 cross-ref: 4 名称 1:1
//     3. 跟 supervision-school-presets.ts 配对: 4 preset 1:1
//
//   时间戳: 2026-10-15

/**
 * 督导流派 (V1.x counselor-mode §4.6 4 流派).
 *
 * 跟 xin_su_app SupervisionSchoolCode enum 1:1 同步.
 * 跟 src/counselor/config/supervision-school-presets.ts 4 preset 1:1 配对.
 */
export enum SupervisionSchoolCode {
  /** CBT 督导 — 认知扭曲 / 自动思维 / 行为激活 / 家庭作业 */
  CBT = 'cbt',
  /** 精神动力学督导 — 移情 / 反移情 / 防御机制 / 早期关系模式 */
  PSYCHOANALYTIC = 'psychoanalytic',
  /** 人本督导 — 共情一致性 / 无条件积极关注 / 真诚 */
  PERSON_CENTERED = 'person-centered',
  /** 家庭治疗督导 — 家庭结构 / 边界 / 三角关系 / 代际模式 */
  FAMILY_THERAPY = 'family-therapy',
}
