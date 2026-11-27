import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { User } from '../../user/entities/user.entity.js';

import { BurnoutSettings } from '../entities/burnout-settings.entity.js';
import { Certification } from '../entities/certification.entity.js';
import { CompanionBinding } from '../entities/companion-binding.entity.js';
import { CompanionRecord } from '../entities/companion-record.entity.js';
import { ConsentSignature } from '../entities/consent-signature.entity.js';
import { Membership } from '../entities/membership.entity.js';
import { NotificationSettings } from '../entities/notification-settings.entity.js';
import { PrivacyAuthorization } from '../entities/privacy-authorization.entity.js';
import { SelfcareRecord } from '../entities/selfcare-record.entity.js';
import { UserProfile } from '../entities/user-profile.entity.js';

/** 导出文件 schema 版本 —— 字段增删时递增，方便下游解析方识别. */
export const EXPORT_SCHEMA_VERSION = '1.0';

/** 本次纵切实际覆盖的域（写在文件里，避免把局部导出误读成全量导出）. */
export const EXPORT_INCLUDED_DOMAINS = [
  'account',
  'profile',
  'notificationSettings',
  'membership',
  'certification',
  'companionBindings',
  'companionRecords',
  'selfcareRecords',
  'burnoutSettings',
  'consentSignatures',
  'privacyAuthorizations',
] as const;

/**
 * 尚未纳入本次导出的域 —— 明确写在文件里，不假装已经全量.
 *
 * 对话原文 / 记忆 / 练习记录等心理内容需要单独的脱敏与分级策略（Phase4
 * WP29 后续批次），不能在本纵切里顺手塞进来.
 */
export const EXPORT_PENDING_DOMAINS = ['conversations', 'memories', 'practiceSessions', 'voiceTranscripts'] as const;

/** 账号侧可导出字段白名单：只给用户能理解的身份与时间，不给密码哈希 / 内部风控计数. */
interface ExportableAccount {
  uid: string;
  phone: string | null;
  email: string | null;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  deletedAt: Date | null;
}

/** 导出载荷（JSON 序列化前的结构）. */
export interface UserDataExportPayload {
  schemaVersion: string;
  exportedAt: string;
  scope: {
    includedDomains: readonly string[];
    pendingDomains: readonly string[];
  };
  account: ExportableAccount | null;
  profile: UserProfile | null;
  notificationSettings: NotificationSettings | null;
  membership: Membership | null;
  certification: Certification | null;
  companionBindings: CompanionBinding[];
  companionRecords: CompanionRecord[];
  selfcareRecords: SelfcareRecord[];
  burnoutSettings: BurnoutSettings | null;
  consentSignatures: ConsentSignature[];
  privacyAuthorizations: PrivacyAuthorization[];
}

/**
 * 用户数据导出采集器 (Phase4 WP29 纵切).
 *
 * 职责: 从各 profile 域仓储读取**属于该 uid** 的行，拼成一份可序列化载荷.
 * 边界: 只读、不落库、不生成文件；文件与任务状态由 ExportService 管.
 *
 * 为什么要独立 provider: ExportService 已经承担删除账户与限流，再塞 10 个仓储
 * 依赖会把构造函数和测试桩拖成一片；采集逻辑独立后可用 DataSource 统一取仓储，
 * 测试只需替换 DataSource 的 getRepository.
 */
@Injectable()
export class UserDataExportCollector {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 采集某用户当前可见的数据.
   *
   * @param uid 用户 id
   * @returns 导出载荷
   */
  async collect(uid: string): Promise<UserDataExportPayload> {
    const [user, profile, notificationSettings, membership, certification, burnoutSettings] = await Promise.all([
      this.dataSource.getRepository(User).findOne({ where: { uid } }),
      this.dataSource.getRepository(UserProfile).findOne({ where: { uid } }),
      this.dataSource.getRepository(NotificationSettings).findOne({ where: { uid } }),
      this.dataSource.getRepository(Membership).findOne({ where: { uid } }),
      this.dataSource.getRepository(Certification).findOne({ where: { uid } }),
      this.dataSource.getRepository(BurnoutSettings).findOne({ where: { uid } }),
    ]);

    const [companionBindings, companionRecords, selfcareRecords, consentSignatures, privacyAuthorizations] = await Promise.all([
      this.dataSource.getRepository(CompanionBinding).find({ where: [{ ownerUid: uid }, { companionUid: uid }] }),
      this.dataSource.getRepository(CompanionRecord).find({ where: [{ companionUid: uid }, { companionToUid: uid }] }),
      this.dataSource.getRepository(SelfcareRecord).find({ where: { uid } }),
      this.dataSource.getRepository(ConsentSignature).find({ where: { uid } }),
      this.dataSource.getRepository(PrivacyAuthorization).find({ where: { uid } }),
    ]);

    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      scope: {
        includedDomains: EXPORT_INCLUDED_DOMAINS,
        pendingDomains: EXPORT_PENDING_DOMAINS,
      },
      account: user ? UserDataExportCollector.toAccount(user) : null,
      profile,
      notificationSettings,
      membership,
      certification,
      companionBindings,
      companionRecords,
      selfcareRecords,
      burnoutSettings,
      consentSignatures,
      privacyAuthorizations,
    };
  }

  private static toAccount(user: User): ExportableAccount {
    return {
      uid: user.uid,
      phone: user.phone,
      email: user.email,
      state: user.state,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      emailVerifiedAt: user.emailVerifiedAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
      deletedAt: user.deletedAt,
    };
  }
}
