import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { MetricsService } from '../../shared/infra/metrics';
import { RedisService } from '../../shared/infra/redis';
import { REDIS_KEYS } from '../../shared/infra/redis/redis.constants';

import { AuthResponseDto, CurrentUserDto } from '../dto/auth-response.dto';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { AuditEvent } from '../entities/audit-log.entity';
import { User } from '../entities/user.entity';
import { TokenType } from '../user.constant';
import { UserState, isLoginAllowed } from '../user.state';

import { AuditLogService } from './audit-log.service';
import { EmailVerificationService } from './email-verification.service';
import { JwtBlacklistService } from './jwt-blacklist.service';
import { PasswordHistoryService } from './password-history.service';
import { SessionService } from './session.service';

/**
 * User service — 心塑 + 魔方共用账号服务 (大厂企业级 V2).
 *
 * 核心职责 (V2):
 *   1. register: 创建用户 (发邮件验证 token)
 *   2. login: 验证密码 + state + 邮箱验证状态 + 失败锁定 + 改密周期检查
 *   3. refresh: refresh token rotation
 *   4. findByUid / me: 查询用户信息
 *   5. changePassword: 改密 + 撤销所有 session + 入密码历史
 *   6. logout / logoutAll / revokeSession: 主动下线
 *   7. forgotPassword / resetPassword: 邮箱重置密码
 *   8. verifyEmail / resendVerification: 邮箱验证
 *
 * 安全要点 (V2):
 *   - 密码永远用 bcrypt hash (10 rounds)
 *   - JWT 含 jti, 撤销走 Redis (跨实例)
 *   - 失败登录计数 + 账号锁定 (5 次失败锁 30 分钟)
 *   - 强制改密周期 (90 天) 检查
 *   - 密码历史 (最近 5 次不复用)
 *   - state 状态机 (Banned/Deleted/PendingVerification 不能登录)
 *   - 邮箱未验证不能登录 (V2 新规)
 *   - 软删用户 (deleted_at) 不能登录
 *   - 失败登录写 audit log (风控分析)
 *
 * V3 待办:
 *   - OAuth 登录 / 绑定
 *   - 多端 session 强制下线其他设备 (设置里勾选)
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private static readonly BCRYPT_ROUNDS = 10;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sessionService: SessionService,
    private readonly auditLog: AuditLogService,
    private readonly blacklist: JwtBlacklistService,
    private readonly passwordHistory: PasswordHistoryService,
    private readonly emailVerification: EmailVerificationService,
    private readonly metrics: MetricsService,
    private readonly redis: RedisService,
  ) {}

  // ========================================================================
  // 注册
  // ========================================================================

  /**
   * 注册新用户 (V2: 强制邮箱验证, 暂不验证手机号).
   */
  async register(
    dto: RegisterDto,
    ctx?: { ipAddress?: string; userAgent?: string; userAgentRaw?: string; deviceType?: string },
  ): Promise<AuthResponseDto> {
    if (!dto.phone && !dto.email) {
      throw new BizException(BizCode.InvalidParameter, '手机号或邮箱至少需要一个');
    }

    // 唯一性检查 (并发 race 靠 DB unique index 兜底)
    if (dto.phone) {
      const exist = await this.userRepo.findOne({ where: { phone: dto.phone, deletedAt: IsNull() } });
      if (exist) {
        throw new BizException(BizCode.UserAlreadyExists, '该手机号已注册');
      }
    }
    if (dto.email) {
      const exist = await this.userRepo.findOne({ where: { email: dto.email, deletedAt: IsNull() } });
      if (exist) {
        throw new BizException(BizCode.UserAlreadyExists, '该邮箱已注册');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, UserService.BCRYPT_ROUNDS);
    const user = this.userRepo.create({
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      passwordHash,
      state: UserState.Active, // V2: 注册即 Active, 但邮箱未验证不能登录 (login() 检查)
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      lastLoginAt: null,
      passwordChangedAt: new Date(), // 初始改密时间 = 注册时间
      failedLoginCount: 0,
      lockedUntil: null,
      mustChangePassword: false,
    });
    const saved = await this.userRepo.save(user);

    // 发邮箱验证 token (异步失败不阻塞注册)
    // V2026-09-04 治本: 去掉 fire-and-forget 静默吞错, 改为 await + logger.warn
    //   露出错位 + 加 5s 超时防 smoke race condition (register 返 201 时 token 已写入 Redis).
    if (saved.email) {
      try {
        await this.emailVerification.sendVerification(saved.uid, saved.email);
      } catch (e) {
        // 邮件发送失败仅 log, 不影响注册 (用户可以重发)
        this.logger.warn(`sendVerification failed uid=${saved.uid}: ${(e as Error).message}`);
      }
    }

    await this.auditLog.log({
      userId: saved.uid,
      event: AuditEvent.UserRegister,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { phone: saved.phone, email: saved.email },
      isSuccess: true,
    });

    // V2: 注册不直接登录, 强制让用户验证邮箱后再登录
    // 但返回 AuthResponseDto 让前端能拿到完整结构 (token 为空, 引导验证)
    return {
      accessToken: '',
      refreshToken: '',
      expiresIn: 0,
      refreshExpiresIn: 0,
      user: {
        uid: saved.uid,
        phone: saved.phone,
        email: saved.email,
        state: saved.state,
        emailVerified: false,
        phoneVerified: false,
      },
    };
  }

  // ========================================================================
  // 登录
  // ========================================================================

  /**
   * 登录 (V2: 邮箱未验证不能登录, 失败锁定, 改密周期检查).
   */
  async login(
    dto: LoginDto,
    ctx?: { ipAddress?: string; userAgent?: string; userAgentRaw?: string; deviceType?: string },
  ): Promise<AuthResponseDto> {
    if (!dto.phone && !dto.email) {
      throw new BizException(BizCode.InvalidParameter, '手机号或邮箱至少需要一个');
    }

    const user = await this.findUserForLogin(dto);
    const fail = async (reason: string): Promise<never> => {
      await this.auditLog.log({
        userId: user?.uid ?? null,
        event: AuditEvent.UserLoginFailed,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { phone: dto.phone, email: dto.email, reason },
        isSuccess: false,
      });
      throw new BizException(BizCode.InvalidCredentials);
    };

    if (!user) {
      this.metrics.incAuthLoginAttempt('failed');
      return fail('user_not_found');
    }

    // 1. 锁定检查
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.metrics.incAuthLoginAttempt('locked');
      await this.auditLog.log({
        userId: user.uid,
        event: AuditEvent.UserLoginFailed,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { reason: 'account_locked', lockedUntil: user.lockedUntil },
        isSuccess: false,
      });
      throw new BizException(BizCode.AccountLocked, `账号已锁定, 请 ${this.unlockIn(user.lockedUntil)} 后再试`);
    }

    // 2. state 状态机检查
    if (!isLoginAllowed(user.state)) {
      this.metrics.incAuthLoginAttempt('failed');
      return fail(`state_disallowed:${user.state}`);
    }

    // 3. 邮箱验证检查 (V2 新规)
    if (user.email && !user.emailVerifiedAt) {
      this.metrics.incAuthLoginAttempt('failed');
      throw new BizException(BizCode.EmailNotVerified, '请先验证邮箱');
    }

    // 4. 密码校验
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      this.metrics.incAuthLoginAttempt('failed');
      // 增加失败计数 + 可能锁定
      await this.handleFailedLogin(user);
      return fail('bad_password');
    }

    // 5. 改密周期检查 (V2 新规, 90 天强制改密)
    const passwordExpired = this.passwordHistory.isPasswordExpired(user);
    if (passwordExpired) {
      this.metrics.incAuthLoginAttempt('expired_password');
      user.mustChangePassword = true;
      await this.userRepo.save(user);
    }

    // 6. 登录成功: 重置失败计数 + 更新最后登录时间
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await this.userRepo.save(user);
    await this.redis.del(REDIS_KEYS.loginFailedCount(user.uid));
    await this.redis.del(REDIS_KEYS.accountLock(user.uid));

    await this.auditLog.log({
      userId: user.uid,
      event: AuditEvent.UserLoginSuccess,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { phone: user.phone, email: user.email },
      isSuccess: true,
    });
    this.metrics.incAuthLoginAttempt('success');

    const auth = await this.buildAuthResponse(user, ctx);
    if (passwordExpired) {
      // 标记 must_change_password (前端拦截跳转改密页)
      (auth as unknown as { mustChangePassword: boolean }).mustChangePassword = true;
    }
    return auth;
  }

  /**
   * 刷新 token (rotation).
   */
  async refresh(
    refreshToken: string,
    ctx?: { ipAddress?: string; userAgent?: string; userAgentRaw?: string; deviceType?: string },
  ): Promise<AuthResponseDto> {
    let payload: { sub: string; jti: string; type: string };
    try {
      payload = this.jwt.verify<{ sub: string; jti: string; type: string }>(refreshToken, {
        secret: this.config.get<string>('jwtRefreshSecret'),
      });
    } catch {
      this.metrics.incAuthTokenRefresh('failed');
      throw new BizException(BizCode.TokenExpired, 'refresh token 已过期');
    }

    if (payload.type !== TokenType.Refresh) {
      throw new BizException(BizCode.TokenInvalid, 'token 类型错误');
    }

    if (await this.blacklist.isRevoked(payload.jti)) {
      this.metrics.incAuthTokenRefresh('revoked');
      throw new BizException(BizCode.TokenRevoked, 'refresh token 已被撤销');
    }

    const session = await this.sessionService.findByJti(payload.jti);
    if (!session || session.isRevoked) {
      this.metrics.incAuthTokenRefresh('revoked');
      throw new BizException(BizCode.TokenRevoked, 'session 已失效');
    }

    const user = await this.userRepo.findOne({
      where: { uid: payload.sub, deletedAt: IsNull() },
    });
    if (!user || !isLoginAllowed(user.state)) {
      throw new BizException(BizCode.UserBanned, '用户不存在或已禁用');
    }

    // 旧 token 入 blacklist (rotation)
    await this.blacklist.revoke(payload.jti, session.expiresAt.getTime());
    await this.sessionService.revoke(payload.jti);

    await this.auditLog.log({
      userId: user.uid,
      event: AuditEvent.UserTokenRefresh,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { oldJti: payload.jti },
      isSuccess: true,
    });
    this.metrics.incAuthTokenRefresh('success');

    return this.buildAuthResponse(user, ctx);
  }

  // ========================================================================
  // 查询
  // ========================================================================

  async findByUid(uid: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { uid, deletedAt: IsNull() } });
  }

  /**
   * V1.1 心塑前端接入: 按邮箱查用户 (V2 enterprise UserService 原生没暴露).
   * 软删用户 (deletedAt != null) 不返回, 避免泄漏.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({
      where: { email: email.toLowerCase().trim(), deletedAt: IsNull() },
    });
  }

  /**
   * V1.1 心塑前端接入: 创建无密码用户 (V1.x 验证码流程注册).
   * V2 register 强制要求 password, 这个方法绕过.
   * 用途: 心塑验证码登录后, 给新用户占位 user 记录, 等 SetPasswordPage 引导设密码.
   * V1.x 验证码流程注册: new User() + passwordHash=" + mustChangePassword=true 占位,
   */
  async createPasswordlessUser(email: string): Promise<User> {
    // 用 new User() 显式构造 (避免 TypeORM create() 重载推断歧义: DeepPartial<User> vs DeepPartial<User>[])
    //
    // passwordHash: V1.x 验证码流程注册的 user 还没设密码. User entity 字段是
    // 非 nullable string, 所以用 '' 占位 (V1.1 frontend 的 `if (user.passwordHash)`
    // 判断会把 '' 当作 "没设过密码", 走 SetPasswordPage 引导设密码).
    // 真实 V2.0 production 应: 加 passwordHash 字段 nullable, 或加 mustChangePassword 字段
    // (V2 已有 mustChangePassword 字段!), 走"必须改密"流程更标准.
    const user = new User();
    user.email = email.toLowerCase().trim();
    user.phone = null;
    user.passwordHash = '';
    user.state = 'active' as UserState;
    user.emailVerifiedAt = new Date(); // 验证码流程已证明邮箱所有权
    user.phoneVerifiedAt = null;
    user.lastLoginAt = new Date();
    user.passwordChangedAt = null;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.mustChangePassword = true; // V2 已有此字段: 强制首次登录后改密
    return this.userRepo.save(user);
  }

  /**
   * V1.1 心塑前端接入: 标记老用户邮箱已验证 (验证码流程触发).
   * 幂等: 重复调用无副作用.
   */
  async markEmailVerified(uid: string): Promise<void> {
    if (!uid) return;
    await this.userRepo.update(uid, { emailVerifiedAt: new Date() });
  }

  /**
   * V1.1 心塑前端接入: 首次设密码 (无密码 → 有密码).
   * V2 changePassword 需要 oldPassword, 首次设密码走这个.
   * 强校验: bcrypt hash + 写 passwordChangedAt + 清 mustChangePassword.
   * V2 production 化: 加 audit log (AuditLogService.log) + 接入 PasswordHistoryService 复用检查. V2.0 user.service.changePassword 已实现完整流程.
   */
  async setInitialPassword(uid: string, password: string): Promise<void> {
    const user = await this.findByUid(uid);
    if (!user) {
      throw new BizException(BizCode.UserNotFound, '用户不存在');
    }
    if (user.passwordHash) {
      throw new BizException(BizCode.InvalidParameter, '用户已有密码, 请用改密流程');
    }
    user.passwordHash = await bcrypt.hash(password, UserService.BCRYPT_ROUNDS);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    await this.userRepo.save(user);
  }

  async me(uid: string): Promise<CurrentUserDto | null> {
    const user = await this.findByUid(uid);
    if (!user) {
      return null;
    }
    return {
      uid: user.uid,
      phone: user.phone,
      email: user.email,
      state: user.state,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      passwordChangedAt: user.passwordChangedAt,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    };
  }

  // ========================================================================
  // 改密 (已登录状态, 知道旧密码)
  // ========================================================================

  async changePassword(
    uid: string,
    oldPassword: string,
    newPassword: string,
    ctx?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { uid, deletedAt: IsNull() } });
    if (!user) {
      throw new BizException(BizCode.UserNotFound);
    }

    // 1. 校验旧密码
    const oldOk = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!oldOk) {
      throw new BizException(BizCode.InvalidCredentials, '旧密码错误');
    }

    // 2. 检查密码复用
    await this.passwordHistory.assertNotReused(uid, newPassword);

    // 3. 检查最小间隔
    if (this.passwordHistory.isMinAgeViolation(user)) {
      throw new BizException(BizCode.InvalidParameter, '改密过于频繁, 请稍后再试');
    }

    // 4. 旧密码入历史
    await this.passwordHistory.recordOldPassword(uid, user.passwordHash);

    // 5. 更新密码 + 时间戳 + mustChangePassword = false
    user.passwordHash = await bcrypt.hash(newPassword, UserService.BCRYPT_ROUNDS);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    await this.userRepo.save(user);

    // 6. 撤销所有 session + blacklist (强制下线其他设备)
    const revoked = await this.sessionService.revokeAllByUserId(uid);
    await this.blacklist.revokeMany(revoked.map((r) => ({ jti: r.jti, expiresAtMs: r.expiresAtMs })));

    await this.auditLog.log({
      userId: uid,
      event: AuditEvent.UserPasswordChanged,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { revokedSessions: revoked.length },
      isSuccess: true,
    });
  }

  // ========================================================================
  // 邮箱验证
  // ========================================================================

  /**
   * 验证邮箱 (token → 标记已验证).
   */
  async verifyEmail(token: string, ctx?: { ipAddress?: string; userAgent?: string }): Promise<void> {
    const uid = await this.emailVerification.verify(token);
    await this.emailVerification.markVerified(uid);

    await this.auditLog.log({
      userId: uid,
      event: AuditEvent.UserEmailVerified,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      isSuccess: true,
    });
  }

  /**
   * 重发验证邮件 (防用户枚举: 邮箱不存在时静默成功).
   */
  async resendVerification(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email, deletedAt: IsNull() } });
    if (!user) {
      // 防枚举: 不告诉用户邮箱不存在
      return;
    }
    if (user.emailVerifiedAt) {
      // 已验证, 静默成功 (不抛错, 避免暴露)
      return;
    }
    await this.emailVerification.sendVerification(user.uid, user.email!);
  }

  // ========================================================================
  // 内部
  // ========================================================================

  /**
   * 查找登录用户 (按 phone 或 email).
   */
  private async findUserForLogin(dto: LoginDto): Promise<User | null> {
    if (dto.phone) {
      return this.userRepo.findOne({ where: { phone: dto.phone, deletedAt: IsNull() } });
    }
    if (dto.email) {
      return this.userRepo.findOne({ where: { email: dto.email, deletedAt: IsNull() } });
    }
    return null;
  }

  /**
   * 处理失败登录: 增加计数, 超过阈值锁定账号.
   */
  private async handleFailedLogin(user: User): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const maxAttempts = this.config.get('password').maxFailedAttempts;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const lockoutMin = this.config.get('password').lockoutMinutes;
    const newCount = user.failedLoginCount + 1;
    user.failedLoginCount = newCount;
    if (newCount >= maxAttempts) {
      user.lockedUntil = new Date(Date.now() + lockoutMin * 60 * 1000);
      await this.userRepo.save(user);
      await this.auditLog.log({
        userId: user.uid,
        event: AuditEvent.UserAccountLocked,
        metadata: { failedCount: newCount, lockoutMinutes: lockoutMin },
        isSuccess: true,
      });
    } else {
      await this.userRepo.save(user);
    }
  }

  private unlockIn(until: Date): string {
    const diffMin = Math.ceil((until.getTime() - Date.now()) / 60_000);
    if (diffMin >= 60) {
      return `${Math.ceil(diffMin / 60)} 小时`;
    }
    return `${diffMin} 分钟`;
  }

  /**
   * 签 token + 创建 session (公开, 给 OAuth service 也调用).
   */
  async buildAuthResponse(
    user: User,
    ctx?: { ipAddress?: string; userAgent?: string; userAgentRaw?: string; deviceType?: string },
  ): Promise<AuthResponseDto> {
    const accessExpiresSec = parseExpiresIn(this.config.get<string>('jwtExpiresIn') ?? '15m');
    const refreshExpiresSec = parseExpiresIn(this.config.get<string>('jwtRefreshExpiresIn') ?? '7d');

    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    const accessToken = this.jwt.sign(
      { sub: user.uid, jti: accessJti, type: TokenType.Access },
      { secret: this.config.get<string>('jwtSecret'), expiresIn: accessExpiresSec },
    );
    const refreshToken = this.jwt.sign(
      { sub: user.uid, jti: refreshJti, type: TokenType.Refresh },
      { secret: this.config.get<string>('jwtRefreshSecret'), expiresIn: refreshExpiresSec },
    );

    const session = await this.sessionService.create({
      userId: user.uid,
      jti: refreshJti,
      deviceInfo: ctx?.userAgent ?? null,
      userAgentRaw: ctx?.userAgentRaw ?? ctx?.userAgent ?? null,
      deviceType: ctx?.deviceType ?? 'unknown',
      ipAddress: ctx?.ipAddress ?? null,
      expiresAt: new Date(Date.now() + refreshExpiresSec * 1000),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiresSec,
      refreshExpiresIn: refreshExpiresSec,
      user: {
        uid: user.uid,
        phone: user.phone,
        email: user.email,
        state: user.state,
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: !!user.phoneVerifiedAt,
      },
      sid: session.sid,
    };
  }
}

/**
 * Parse JWT expiresIn string (e.g. '15m', '7d', '1h') into seconds number.
 * 与 user.module.ts 同步 (后续 V3 抽到 common/utils).
 */
function parseExpiresIn(s: string): number {
  // eslint-disable-next-line sonarjs/single-character-alternation
  const match = /^(\d+)(s|m|h|d|w)$/.exec(s);
  if (!match) {
    return 7 * 24 * 60 * 60;
  }
  const n = Number.parseInt(match[1], 10);
  const unit = match[2];
  const map: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 };
  return n * (map[unit] ?? 86_400);
}
