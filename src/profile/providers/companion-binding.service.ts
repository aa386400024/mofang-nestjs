import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { Repository } from 'typeorm';

import { User } from '../../user/entities/user.entity';
import {
  AcceptInviteDto,
  CompanionBindingDto,
  CreateInviteDto,
  InviteCodeResponseDto,
  ListCompanionBindingsResponseDto,
  UpdatePermissionDto,
} from '../dto/companion-binding.dto';
import { CompanionBinding } from '../entities/companion-binding.entity';

/**
 * CompanionBinding service — 心塑「我的」Tab 关系绑定核心服务 (双角色共用).
 *
 * 职责 (V3):
 *   - createInvite(uid, dto): 成长用户生成 6 位邀请码 + 24h 过期
 *   - acceptInvite(uid, dto): 陪伴者用码接受邀请, 双向绑定
 *   - updatePermission(uid, id, dto): 成长用户改权限等级 (L1/L2/L3)
 *   - terminateBinding(uid, id, dto): 成长用户 / 陪伴者 解除绑定
 *   - listBindings(uid): 列出当前用户作为 owner 的所有绑定
 *   - 角色区分: 双端共用表, 通过 owner_uid / companion_uid 区分
 *
 * 大厂做法:
 *   - 邀请码: 6 位数字 + 24h TTL (reused verification-code 风格)
 *   - 解码查 owner_uid (非 companion_uid) — 防越权
 *   - 解除是软状态 (status=terminated), 不真删
 *   - 双向权限检查 (大厂 standard): 验证 owner 当前登录态才能改权限
 *
 * V2.0 简化:
 *   - 邀请码直接 = inviteCode 字段 (没走 Redis, V2.0 简化)
 *   - V3: inviteCode 存 Redis + inviteCode 字段双写 (FK 引用)
 */
@Injectable()
export class CompanionBindingService {
  constructor(
    @InjectRepository(CompanionBinding)
    private readonly repo: Repository<CompanionBinding>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * 列出当前用户作为 owner 的所有绑定.
   * 双角色共用: owner_uid = uid.
   */
  async listBindings(uid: string): Promise<ListCompanionBindingsResponseDto> {
    const bindings = await this.repo.find({
      where: { ownerUid: uid },
      order: { createdAt: 'DESC' },
    });

    // V2.0 简化: companionUid 可能是 pending-{code} 占位 (NULL/placeholder), 跳过.
    // V3 升级: inviteCode 独立 Redis 表, companionUid 总是真实 uid.
    const validCompanionUids = bindings.map((b) => b.companionUid).filter((id): id is string => id !== null && !id.startsWith('pending-'));
    const companions =
      validCompanionUids.length > 0
        ? await this.userRepo.find({
            where: validCompanionUids.map((id) => ({ uid: id })),
          })
        : [];
    const companionMap = new Map<string, User>(companions.map((u) => [u.uid, u]));

    return {
      bindings: bindings.map((b) => this.toDto(b, companionMap)),
    };
  }

  /**
   * 生成邀请码 — 成长用户创建.
   *
   * V2.0 实现:
   *   - 生成 6 位数字
   *   - 24 小时 过期
   *   - 默认 permission_level = L1 (待接受后用户可改)
   *
   * V3 升级:
   *   - 邀请码存 Redis (TTL 24h)
   *   - 同步落 DB invite_code 字段 (供查询/审计)
   *   - rate limit: 每用户每小时最多生成 5 个 (防滥用)
   */
  async createInvite(uid: string, dto: CreateInviteDto): Promise<InviteCodeResponseDto> {
    const inviteCode = this.generateInviteCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // V2.0 简化: companionUid 先填 NULL (V3 接 Redis 后改成 Redis 占位)
    // NULL 通过 FK 约束 (NULL 不触发 FK)
    await this.repo.save(
      this.repo.create({
        ownerUid: uid,
        companionUid: null, // V2.0 占位, 接受时填真实 uid
        inviteCode,
        inviteCodeExpiresAt: expiresAt,
        status: 'pending',
        permissionLevel: dto.permissionLevel ?? 'L1',
        boundAt: null,
      }),
    );

    return {
      inviteCode,
      expiresAt,
      permissionLevel: dto.permissionLevel ?? 'L1',
    };
  }

  /**
   * 接受邀请码 — 陪伴者调用.
   *
   * V2.0 实现:
   *   - 查 invite_code 匹配的 pending binding
   *   - 校验未过期
   *   - 更新 companion_uid (从占位 'pending-{code}' 改成真实 uid)
   *   - status=active, boundAt=now
   *
   * V3 升级:
   *   - 防重复: 同一用户 + 同一 owner 已有 active binding → 直接返回
   *   - 通知双方: 走 Redis pub/sub + push
   */
  async acceptInvite(uid: string, dto: AcceptInviteDto): Promise<CompanionBindingDto> {
    const binding = await this.repo.findOne({
      where: { inviteCode: dto.inviteCode, status: 'pending' },
    });
    if (!binding) {
      throw new NotFoundException('邀请码无效或已使用');
    }
    if (binding.inviteCodeExpiresAt && binding.inviteCodeExpiresAt < new Date()) {
      throw new BadRequestException('邀请码已过期');
    }

    // companionUid 从 NULL 填成真实 uid
    binding.companionUid = uid;
    binding.status = 'active';
    binding.boundAt = new Date();
    binding.inviteCode = null; // V3 用完即清, 防重复使用
    binding.inviteCodeExpiresAt = null;

    const saved = await this.repo.save(binding);

    // 拿对方 user 信息
    const owner = await this.userRepo.findOne({ where: { uid: saved.ownerUid } });

    return this.toDto(saved, new Map<string, User>((owner ? [[owner.uid, owner] as [string, User]] : []).filter(([, u]) => !!u)));
  }

  /**
   * 修改权限等级 — 成长用户对自己创建的 binding 操作.
   */
  async updatePermission(uid: string, bindingId: string, dto: UpdatePermissionDto): Promise<CompanionBindingDto> {
    const binding = await this.repo.findOne({ where: { id: bindingId } });
    if (binding?.ownerUid !== uid) {
      throw new NotFoundException('绑定关系不存在或无权访问');
    }
    if (binding.status !== 'active') {
      throw new BadRequestException('仅生效中的关系可调整权限');
    }
    binding.permissionLevel = dto.permissionLevel;
    const saved = await this.repo.save(binding);

    if (!saved.companionUid) throw new NotFoundException('绑定关系异常, companionUid 为空');
    const companion = await this.userRepo.findOne({ where: { uid: saved.companionUid } });
    return this.toDto(
      saved,
      new Map<string, User>((companion ? [[companion.uid, companion] as [string, User]] : []).filter(([, u]) => !!u)),
    );
  }

  /**
   * 解除绑定.
   */
  async terminateBinding(uid: string, bindingId: string, reason: string | undefined): Promise<void> {
    const binding = await this.repo.findOne({ where: { id: bindingId } });
    if (!binding || (binding.ownerUid !== uid && binding.companionUid !== uid)) {
      throw new NotFoundException('绑定关系不存在或无权访问');
    }
    if (binding.status === 'terminated') {
      return; // 幂等
    }
    binding.status = 'terminated';
    binding.terminatedAt = new Date();
    binding.terminateReason = reason ?? null;
    await this.repo.save(binding);
  }

  /**
   * 6 位数字邀请码生成 — 大厂做法: 用 crypto.randomInt 防伪随机.
   * 范围 100000-999999 (6 位).
   */
  private generateInviteCode(): string {
    // V2026-08-27 治本 (sonarjs/pseudo-random):
    //   邀请码用于绑定关系, 必须是密码学安全 RNG, 否则可能预测.
    //   治本: 用 node:crypto.randomInt(min, max) 替 Math.random — 治本 + 治标.
    //   6 位数字 (100000-999999) 空间 900k, 密码学安全够用.
    return randomInt(100_000, 1_000_000).toString();
  }

  private toDto(binding: CompanionBinding, companionMap: Map<string, User>): CompanionBindingDto {
    const companion = binding.companionUid ? companionMap.get(binding.companionUid) : undefined;
    return {
      id: binding.id,
      ownerUid: binding.ownerUid,
      companionUid: binding.companionUid ?? '',
      status: binding.status,
      permissionLevel: binding.permissionLevel,
      companionNickname: companion?.phone ?? companion?.email?.split('@', 1)[0]?.split('@', 1)[0] ?? null,
      companionAvatarUrl: null, // V3: 走 avatar_url 字段
      boundAt: binding.boundAt,
      terminatedAt: binding.terminatedAt,
    };
  }
}
