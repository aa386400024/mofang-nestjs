// V2026-11-06 治本 (WP38 · 角色历史版本表实体):
//   职责: 承载 `character_profile_versions` 表 —— 角色每次改版留一份**完整快照**, 可回溯.
//   边界: 只描述表结构与列语义; 零业务逻辑、零 IO.
//
//   为什么要有这张表 (character_profiles 只留最新一版, 改坏了找不回来):
//     角色基线是**临床内容资产** —— 信任基线 0.3 改回 0.28 还是 0.32, 影响每一次对练的
//     阻抗曲线. 覆盖式更新 (= 只留最新) 意味着"改错了只能凭记忆改回去", 没人记得.
//     留快照 = 每个版本号对应一份"当时是怎么配的", 回溯得到的是**事实**而不是记忆.
//
//   快照为什么要**独立于 character_profiles 的形状**:
//     快照是**某个时刻**的内容. 若快照类型直接引用实体字段, 实体以后加一列,
//     老快照的形状就跟着变 —— 那份快照记的就不再是"当时的样子"了.
//     所以快照是**独立的一份形状** (CharacterProfileSnapshot): 冻结、只增不改.
//
//   反双胞胎:
//     - **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验.
//     - **不落 tenant_id**: system 级资产, 跟 character_profiles 同款.
//     - **不做软删**: 历史版本是**审计事实** —— 删掉它等于让"改坏了找不回来"成立.
//     - **不落更新人 id 的外键**: changed_by 只记"谁改的"这一事实字符串.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. DESCRIBE character_profile_versions;   # 9 列
//     2. SHOW INDEX FROM character_profile_versions;  # UNIQUE(template_id, 三版本号) + 索引
//
//   时间戳: 2026-11-06

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import type {
  CharacterAuditStatus,
  CharacterExpressionTone,
  CharacterFivePs,
  CharacterNarrativeStyle,
} from './character-profile.entity.js';
import type { CharacterVersionChangeType } from './character-version.js';
import type { AttachmentStyle, CoreBelief, PersonalityTraits, UnderlyingDesireSeed } from '../../../engine-core/index.js';

/**
 * 角色某一版的**完整内容快照** (冻结形状).
 *
 * 字段口径与 `character_profiles` 的内容列一一对应 (不含时间戳 / 软删位 / int 计数列).
 * 刻意**不含** createdAt / updatedAt: 快照的"时间"由本表的 created_at 表达,
 * 再抄一份时间戳进 JSON = 两个时间源, 迟早对不上.
 */
export interface CharacterProfileSnapshot {
  readonly templateId: string;
  readonly displayName: string;
  readonly attachmentStyle: AttachmentStyle;
  readonly fivePs: CharacterFivePs;
  readonly personalityTraits: PersonalityTraits | null;
  readonly baselineTrust: number;
  readonly baselineResistanceVerbal: number;
  readonly baselineResistanceDepth: number;
  readonly baselineResistanceStyle: number;
  readonly baselineEmotionValence: number;
  readonly baselineEmotionArousal: number;
  readonly baselineSafety: number;
  readonly baselineBond: number;
  readonly speechVolumeBaseline: number;
  readonly narrativeStyle: CharacterNarrativeStyle;
  readonly expressionTone: CharacterExpressionTone;
  readonly verbalVoice: string | null;
  readonly coreBeliefs: CoreBelief[];
  readonly underlyingDesires: UnderlyingDesireSeed[];
  readonly forbiddenBehaviors: string[];
  readonly sensitiveTopics: string[];
  readonly auditStatus: CharacterAuditStatus;
  readonly enabled: boolean;
  /** 快照自身的版本号 (哪一版). */
  readonly versionMajor: number;
  readonly versionMinor: number;
  readonly versionPatch: number;
}

/**
 * `character_profile_versions` 表 —— 角色历史版本快照 (append-only).
 *
 * 一行 = 角色 (template_id) 的某一个版本号 (major.minor.patch) 的完整内容快照.
 */
@Entity('character_profile_versions')
// 唯一键: 同一角色的同一版本号只有一份快照 (重复写入 → 幂等覆盖, 不产生第二行).
@Index('uniq_cpv_template_version', ['templateId', 'versionMajor', 'versionMinor', 'versionPatch'], { unique: true })
// 回溯列表的主查询路径: 按角色取全部版本 (按创建时间倒序).
@Index('idx_cpv_template_created', ['templateId', 'createdAt'])
export class CharacterProfileVersionEntity {
  /** 内部主键 (由 template_id + 版本号内容派生, 稳定可重放). */
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  /** 关联的公共模板 id (`vpt_*` slug); 逻辑外键, 不加 DB FK. */
  @Column({ type: 'varchar', length: 64, name: 'template_id' })
  templateId!: string;

  /** 主版本号. */
  @Column({ type: 'int', name: 'version_major' })
  versionMajor!: number;

  /** 次版本号. */
  @Column({ type: 'int', name: 'version_minor' })
  versionMinor!: number;

  /** 修订号. */
  @Column({ type: 'int', name: 'version_patch' })
  versionPatch!: number;

  /** 变更类型: create (首版) / major / minor / patch. */
  @Column({ type: 'varchar', length: 16, name: 'change_type' })
  changeType!: CharacterVersionChangeType;

  /** 该版本的内容快照 (完整行). */
  @Column({ type: 'json', name: 'snapshot' })
  snapshot!: CharacterProfileSnapshot;

  /** 变更人 id (users.id; 未知时为 null —— 不因为"查不到是谁改的"就不留痕). */
  @Column({ type: 'varchar', length: 64, name: 'changed_by', nullable: true })
  changedBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
