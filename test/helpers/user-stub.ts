// V2026-11-13 (TD-10 · T-1): 账号域测试替身工厂 (假 user 表 + UserService 装配).
//
//   为什么要共享:
//     忘记密码重置 (test/base/auth-reset-password.spec.ts) 与 已登录态首次设密码
//     (test/user/set-password-first-set.spec.ts) 各抄了一份**同构**的替身:
//     假 user 表 + UserService 的 10 个依赖替身 (repo / jwt / config / session /
//     audit / blacklist / passwordHistory / email / metrics / verification).
//     两份各 ~45 行 —— 审计事件名或字段一改, 只有一份跟上, 另一份静默过期.
//
//   纯度约定:
//     ① 纯工厂: 每次调用返回新对象 + 新数组; 本文件不持模块级可变状态;
//     ② 不做 Nest 装配注册, 不 import Nest 容器, 不硬编码业务阈值;
//     ③ 替身只**记调用**, 不含业务判定 —— 判定逻辑仍在真 UserService 里.
//
//   两处调用方的差异用**入参**表达, 不各抄一份:
//     · mustChangePassword: 首次设密码场景默认 true, 其余默认 false;
//     · recordPasswordHistory: 是否记录复用检查 / 旧密码入历史.

import { AuditEvent } from '../../src/user/entities/audit-log.entity.js';
import { User } from '../../src/user/entities/user.entity.js';
import { UserService } from '../../src/user/providers/user.service.js';

/** 审计条目 (UserService 交给 AuditLogService.log 的那几个字段). */
export interface UserAuditEntry {
  readonly userId: string | null;
  readonly event: AuditEvent;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly isSuccess?: boolean;
}

/** 假 user 表的固定标识 (两个 spec 共用同一套 uid / 租户 / 邮箱). */
export const STUB_USER_UID = '11111111-1111-1111-1111-111111111111';

/** 假 user 表的固定邮箱. */
export const STUB_USER_EMAIL = 'student@example.com';

/** 造一条假 user 记录 (密码位留空 = 从没设过密码). */
export function buildUserEntityStub(overrides: Partial<User> = {}, mustChangePassword = false): User {
  const user = new User();
  user.uid = STUB_USER_UID;
  user.email = STUB_USER_EMAIL;
  user.phone = null;
  user.passwordHash = '';
  user.state = 'active' as User['state'];
  user.emailVerifiedAt = new Date();
  user.phoneVerifiedAt = null;
  user.lastLoginAt = null;
  user.passwordChangedAt = null;
  user.mustChangePassword = mustChangePassword;
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.deletedAt = null;
  user.tenantId = STUB_USER_UID;
  return Object.assign(user, overrides);
}

/** UserService 替身装配的入参. */
export interface UserServiceStubOptions {
  /** 要反查出来的 user 行 (null = 查不到). */
  readonly row?: User | null;
  /** 假 user 表的 mustChangePassword 初值 (默认 false). */
  readonly mustChangePassword?: boolean;
  /** 是否记录密码复用检查 / 旧密码入历史 (默认 true). */
  readonly recordPasswordHistory?: boolean;
}

/** UserService 替身装配的产物 (全部可断言). */
export interface UserServiceStub {
  readonly service: UserService;
  readonly row: User | null;
  readonly audits: UserAuditEntry[];
  readonly revokedByUid: string[];
  readonly blacklisted: () => number;
  readonly reuseChecks: string[];
  readonly historyWrites: { uid: string; hash: string }[];
}

/** 装配一个被测的 UserService (依赖全 stub, 不连 DB / Redis / 邮件). */
export function buildUserServiceStub(options: UserServiceStubOptions = {}): UserServiceStub {
  const row = options.row === undefined ? buildUserEntityStub({}, options.mustChangePassword ?? false) : options.row;
  const audits: UserAuditEntry[] = [];
  const revokedByUid: string[] = [];
  const reuseChecks: string[] = [];
  const historyWrites: { uid: string; hash: string }[] = [];
  const recordPasswordHistory = options.recordPasswordHistory ?? true;
  let blacklisted = 0;

  const userRepo = {
    findOne: async (): Promise<User | null> => row,
    save: async (user: User): Promise<User> => user,
    create: (partial: Partial<User>): User => Object.assign(new User(), partial),
  };
  const sessionService = {
    revokeAllByUserId: async (uid: string): Promise<{ jti: string; expiresAtMs: number }[]> => {
      revokedByUid.push(uid);
      return [{ jti: 'jti-1', expiresAtMs: 1_800_000_000_000 }];
    },
  };
  const blacklist = {
    revokeMany: async (): Promise<void> => {
      blacklisted += 1;
    },
  };
  const auditLog = {
    log: async (entry: UserAuditEntry): Promise<void> => {
      audits.push(entry);
    },
  };
  const passwordHistory = {
    assertNotReused: async (uid: string): Promise<void> => {
      if (recordPasswordHistory) reuseChecks.push(uid);
    },
    isMinAgeViolation: (): boolean => false,
    recordOldPassword: async (uid: string, hash: string): Promise<void> => {
      if (recordPasswordHistory) historyWrites.push({ uid, hash });
    },
  };

  const service = new UserService(
    userRepo as never,
    { sign: () => 'token' } as never,
    { get: () => 'secret' } as never,
    sessionService as never,
    auditLog as never,
    blacklist as never,
    passwordHistory as never,
    { sendVerification: async () => {} } as never,
    { incAuthLogin: () => {}, incAuthPasswordReset: () => {} } as never,
    { get: async () => null } as never,
  );
  return { service, row, audits, revokedByUid, blacklisted: () => blacklisted, reuseChecks, historyWrites };
}
