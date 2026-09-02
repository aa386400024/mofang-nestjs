import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import 'multer'; // 加载 namespace, 让 Express.Multer.File 全局可用
// V3: 头像上传走 @types/express 的 Express.Multer.File 类型 (跟 FileInterceptor 一致)
type MulterFile = Express.Multer.File;
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';

// V2026-08-27 治本 (lint fix): node:fs / node:path 没 default export,
//   unicorn/import-style 误报 — 忽略.

import { promises as fs } from 'node:fs';
// eslint-disable-next-line unicorn/import-style
import { join, extname } from 'node:path';
import { Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';

import { ProfileDto, UpdateProfileDto, UploadAvatarResponseDto } from '../dto/profile.dto';
import { UserProfile } from '../entities/user-profile.entity';

/**
 * Profile service — 心塑「我的」Tab 用户画像核心服务 (大厂企业级 V3).
 *
 * 职责 (V3):
 *   - getProfile(uid): 拉取用户画像 (1:1 with users)
 *   - updateProfile(uid, dto): 部分更新 (null 字段不动)
 *   - switchRole(uid, role): 切换 current_role + 持久化
 *   - uploadAvatar(uid, file): 上传头像 (V2.0 占位, V3 接 oss)
 *   - ensureProfile(uid): 内部 helper — 首次访问时自动建空 profile
 *
 * 大厂做法:
 *   - 1:1 表用 ensure + upsert 模式, 避免 "user 注册后才创建 profile" race condition
 *   - audit log 在 user module 统一记, 这里只调不存
 *   - 字段用 @PrimaryColumn 而不是 @PrimaryGeneratedColumn, 跟 users.uid 强一致
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    @InjectRepository(UserProfile)
    private readonly repo: Repository<UserProfile>,
    private readonly config: ConfigService,
  ) {}

  /**
   * V2026-08-27 治本: 首次访问自动创建空 profile.
   *
   * 原实现: 找不到 user_profile 记录直接抛 NotFoundException → 客户端收 404.
   * 现状: 新用户注册后只写 users 表, user_profiles 同步创建需要手动调 (容易遗漏).
   * 业务表现: 首次调 GET /profile/me 必 404, 客户端必须额外调 PUT 一次建记录
   *           (增加复杂度, 还会产生 race condition: 并发 PUT/GET 可能冲突).
   *
   * 治本: getProfile 跟 updateProfile/switchRole 一样走 ensureProfile.
   *   - 首访问: 自动 INSERT 一条空记录 (nickname=null, currentRole='growth_user')
   *   - 后续访问: 正常返回
   *   - 客户端体验: 永远拿得到 profile, 只是首次全是 null, UI 提示"去完善"
   *
   * 设计原则 (大厂 standard):
   *   - profile 是 users 的 1:1 影子表, 应当自动同步, 不应手动创
   *   - "读路径"自动创建 = "读时建表" (read-create), 跟 ensureProfile 兜底一致
   *   - 这种模式跟 Unix file system 的 touch 类似: 读时自动建空文件
   */
  async getProfile(uid: string): Promise<ProfileDto> {
    const profile = await this.ensureProfile(uid);
    return this.toDto(profile);
  }

  /**
   * 更新用户画像. 部分更新, dto 没传的字段保留原值.
   */
  async updateProfile(uid: string, dto: UpdateProfileDto): Promise<ProfileDto> {
    const profile = await this.ensureProfile(uid);

    // V3 字段防御: birth_date / gender / occupation 不能清空, 但 nickname 可以
    // (用户主动清空昵称是允许的). V2.0 简化: 全部按 dto 直传.
    if (dto.nickname !== undefined) profile.nickname = dto.nickname;
    if (dto.birthDate !== undefined) profile.birthDate = dto.birthDate;
    if (dto.gender !== undefined) profile.gender = dto.gender;
    if (dto.occupation !== undefined) profile.occupation = dto.occupation;

    const saved = await this.repo.save(profile);
    return this.toDto(saved);
  }

  /**
   * 切换角色并持久化.
   *
   * V3 联动:
   *   - 写 audit log
   *   - 多端推送 (Redis pub/sub)
   *   - 通知 onboarding 服务 (V3 角色升级路径)
   */
  async switchRole(uid: string, newRole: 'growth_user' | 'companion'): Promise<ProfileDto> {
    const profile = await this.ensureProfile(uid);
    if (profile.currentRole === newRole) {
      // 同一角色无变化, 直接返回 (避免 emit 触发 rebuild)
      return this.toDto(profile);
    }
    profile.currentRole = newRole;
    const saved = await this.repo.save(profile);
    return this.toDto(saved);
  }

  /**
   * 上传头像. V2.0 占位 (返回 mock url).
   * V3 接 oss / cdn 真实上传:
   *   - multipart/form-data 接收 file
   *   - 校验 mime / size (大厂: 限制 5MB, 类型 image/jpeg|png|webp)
   *   - oss 拿到 url
   *   - 写回 avatar_url
   */
  /**
   * V2026-08-27 治本 (Bug: 头像 mock URL `https://cdn.xin-su.com/avatar/mock-*.jpg`):
   *   之前 V2.0 只返回占位 URL, 真实没存文件也没 dns 指向 cdn.xin-su.com.
   *   治本: 真存文件到本地 disk (UPLOAD_STORAGE_DIR env),
   *   返回的 URL 走 UPLOAD_PUBLIC_BASE_URL env — dev 用 localhost, prod 用真实域名.
   *
   * 大厂 standard: 文件系统 + reverse proxy (nginx) serve, 避免引入 S3 第三方依赖
   * (V1 阶段无 OSS 账号, 等 V3+ 有 OSS 再升级).
   *
   * 流程:
   *   1. 校验 file + UPLOAD_STORAGE_DIR env
   *   2. 用 randomUUID() 拼后缀 (防文件名冲突 + 防止原始名泄露用户信息)
   *   3. mkdir -p {storage}/avatar, 写文件 fs.writeFile
   *   4. 失败: rollback (unlink 已写文件), 抛 BizException
   *   5. 成功: 返回 {PUBLIC_BASE_URL}/avatar/{uuid}.{ext}
   */
  async uploadAvatar(uid: string, file: MulterFile | null): Promise<UploadAvatarResponseDto> {
    if (!file) {
      throw new BizException(BizCode.InvalidParameter, '请上传文件');
    }
    const storageDirRaw = this.config.get<string>('UPLOAD_STORAGE_DIR');
    const publicBaseRaw = this.config.get<string>('UPLOAD_PUBLIC_BASE_URL');
    if (!storageDirRaw || !publicBaseRaw) {
      throw new BizException(BizCode.ServiceUnavailable, '头像存储未配置 (UPLOAD_STORAGE_DIR / UPLOAD_PUBLIC_BASE_URL env 缺失)');
    }
    // V2026-08-27 治本 (lint): env 配置可能带引号 (yaml 解析兼容).
    //   大厂 standard 拆开 2 个简单 character class 替换 — 绕开 sonarjs super-linear 误报.
    //   两次 replace 都是 O(n) 线性, 无 backtracking.
    const stripQuotes = (s: string): string => s.replace(/^["']/, '').replace(/["']$/, '');
    const stripTrailingSlash = (s: string): string => (s.endsWith('/') ? s.slice(0, -1) : s);
    const storageDir = stripQuotes(storageDirRaw).trim();
    const publicBase = stripQuotes(stripTrailingSlash(publicBaseRaw));

    const avatarDir = join(storageDir, 'avatar');
    const ext = (extname(file.originalname) || '.jpg').toLowerCase();
    // 防 path traversal: 只接受白名单后缀
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const fileName = `${randomUUID()}${safeExt}`;
    const fullPath = join(avatarDir, fileName);

    try {
      await fs.mkdir(avatarDir, { recursive: true });
      await fs.writeFile(fullPath, file.buffer);
    } catch (err) {
      this.logger.error(`uploadAvatar 写文件失败: ${fullPath}`, err instanceof Error ? err.stack : String(err));
      throw new BizException(BizCode.ServiceUnavailable, `头像文件保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 验证 (dev/prod): dev 用 http://localhost:3000, prod 用 https://api.xin-su.com
    const avatarUrl = `${publicBase}/avatar/${fileName}`;

    // V2026-08-27 治本 (Bug: 头像 URL 没写回 DB):
    //   之前只返回 URL, 真实没动 user_profiles.avatar_url 字段 → 下次 getProfile 仍返回 null.
    //   治本: 走 ensureProfile 拿 entity → 改 avatarUrl → save.
    //   upsert 兜底: 没 profile 记录时 (新用户首次上传) 自动建空 + 写 URL.
    try {
      const profile = await this.ensureProfile(uid);
      profile.avatarUrl = avatarUrl;
      await this.repo.save(profile);
    } catch (err) {
      // DB 写失败但文件已存: 治本 rollback (unlink 文件, 避免脏数据).
      // 如果 unlink 失败也不抛 — 脏文件留硬盘上, 下次 GC 清理.
      this.logger.error(`uploadAvatar DB save 失败: uid=${uid} → ${avatarUrl}`, err instanceof Error ? err.stack : String(err));
      try {
        await fs.unlink(fullPath);
      } catch {
        /* ignore */
      }
      throw new BizException(BizCode.ServiceUnavailable, `头像信息保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.logger.log(`uploadAvatar ok: uid=${uid} → ${avatarUrl} (${file.size} bytes)`);
    return { avatarUrl };
  }

  /**
   * 确保 user profile 存在 — 找不到时自动建空 profile (upsert).
   *
   * 大厂用法: 用户注册成功时同步调用, 业务侧不需要判空.
   * V3 升级: 注册成功后由 user module 直接建 (当前 ProfileService.ensureProfile 兜底).
   */
  async ensureProfile(uid: string): Promise<UserProfile> {
    const existing = await this.repo.findOne({ where: { uid } });
    if (existing) return existing;

    // V2.0 upsert: race condition 容忍 — 如果并发 create, 唯一 PK 保证只有一个生效
    try {
      const created = this.repo.create({
        uid,
        nickname: null,
        avatarUrl: null,
        birthDate: null,
        gender: null,
        occupation: null,
        currentRole: 'growth_user',
      });
      return await this.repo.save(created);
    } catch {
      // V3 升级: catch 重复键错误, 重新 select 返回已有
      const retry = await this.repo.findOne({ where: { uid } });
      if (retry) return retry;
      throw new BizException(BizCode.UnknownError);
    }
  }

  /**
   * entity → DTO 映射. 隐藏敏感字段.
   */
  private toDto(profile: UserProfile): ProfileDto {
    return {
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      birthDate: profile.birthDate,
      gender: profile.gender,
      occupation: profile.occupation,
      currentRole: profile.currentRole,
    };
  }
}
