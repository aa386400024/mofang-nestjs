// V2026-10-20 治本 (专项技能 Hero 显示偏好 — 实体):
//   原因: 设计规格 §14-2 拍板「Hero 可由用户关闭」. PRD v1.0 §2.4-7「千人千面, 用户可控」
//     要求个性化偏好可跨设备生效, 只存本地无法满足「永久云端加密 + 多设备同步」
//     (PRD §9.3 会员权益). 同时用户明确要求「勾选不显示后需能从设置入口恢复」,
//     因此该偏好必须有服务端单一事实源.
//   修复: counselor_ui_preferences 一人一行 (user_id 唯一), prefs JSONB 存白名单键值.
//   反双胞胎:
//     - 不建 key-value 宽表 (偏好项会持续增加, 宽表每加一项就要 DDL)
//     - 不加 JSONB 索引 (当前按 user_id 主键点查, 无人按偏好值检索)
//     - 不存隐私/安全类偏好 (那些走独立 entity, 见 profile 模块通知设置)
//   验证:
//     1. SHOW CREATE TABLE counselor_ui_preferences → user_id 唯一索引存在
//     2. PATCH 两次 → 仍为 1 行 (upsert 语义)
//   时间戳: 2026-10-20
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('counselor_ui_preferences')
export class CounselorUiPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'user_id', unique: true })
  userId!: string;

  @Column({ type: 'json' })
  // V2026-10-21 治本 (V1.2 VS-C — 值类型放宽为 boolean | string):
  //   原因: 新增的 liveSupervisionHintTier 是 2 值档位 (字符串 'light' / 'off'),
  //     与已有的布尔偏好 (Hero 可见 / 上帝视角) 共存于同一列.
  //   反双胞胎: 不拆成"2 个布尔" (liveSupervisionHintEnabled + liveSupervisionHintLight):
  //     那样表达不了档位语义, 且将来加第 3 档要再加 1 列; 也不单开一张表 (偏好单一事实源)
  //   验证: 无需 migration (列本身是 JSON, 值类型只存在于 TS 层)
  prefs!: Record<string, boolean | string>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
