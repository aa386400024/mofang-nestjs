import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MembershipBenefitDto, MembershipDto } from '../dto/membership.dto';
import { Membership } from '../entities/membership.entity';

/**
 * Membership service — 心塑会员中心核心服务.
 *
 * V2.0 占位:
  status - 全部返回 inactive, 5 个权益全 locked=false (UI 显示 "即将开通")
 *   - status/tier/expiresAt 实际查 DB, 但 V2.0 默认行不在 — 由 ensureMembership 建空行
 * V3 接订单 + 支付 + 自动续费:
 *   - 状态机: trial → active → expired (跟 UserState 模式一致)
 *   - cron 找 expires_at < now() 且 status=active → 批量 expired
 *   - 退款: 写 refund_events, 业务侧幂等处理
 *
 * 大厂做法:
 *   - 5 个权益是产品设计, 跟技术解耦 — 后端只返回权益数据, UI 控制锁/未锁图标
 */
@Injectable()
export class MembershipService {
  constructor(
    @InjectRepository(Membership)
    private readonly repo: Repository<Membership>,
  ) {}

  async getMembership(uid: string): Promise<MembershipDto> {
    const membership = await this.ensureMembership(uid);
    return {
      status: membership.status,
      tier: membership.tier,
      expiresAt: membership.expiresAt,
      benefits: this.getBenefits(membership),
    };
  }

  /**
   * 5 个 V2.0 权益 — 跟前端 V2.0 §Tab4 会员中心一致.
   * unlocked 跟当前 membership.status 关联 (active / trial → 解锁, 否则锁).
   */
  private getBenefits(membership: Membership): MembershipBenefitDto[] {
    const isActive = membership.status === 'active' || membership.status === 'trial';
    return [
      {
        icon: 'insights_outlined',
        title: '高级成长报告',
        description: '月度深度报告 + 周趋势曲线',
        unlocked: isActive,
      },
      {
        icon: 'psychology_outlined',
        title: '全套循证练习库',
        description: 'CBT / ACT / DBT / 正念全系列解锁',
        unlocked: isActive,
      },
      {
        icon: 'psychology_alt_outlined',
        title: 'AI 心塑助手无限次',
        description: '24 小时在线, 不限对话次数',
        unlocked: isActive,
      },
      {
        icon: 'handshake_outlined',
        title: '高级陪伴权限',
        description: 'L3 互动权限, 含康复进度同步',
        unlocked: isActive,
      },
      {
        icon: 'headset_mic_outlined',
        title: '专家答疑 (每月 2 次)',
        description: '心理咨询师在线文字答疑',
        unlocked: isActive,
      },
    ];
  }

  private async ensureMembership(uid: string): Promise<Membership> {
    const existing = await this.repo.findOne({ where: { uid } });
    if (existing) return existing;
    try {
      return await this.repo.save(
        this.repo.create({
          uid,
          status: 'inactive',
          tier: 'free',
          expiresAt: null,
        }),
      );
    } catch {
      const retry = await this.repo.findOne({ where: { uid } });
      if (retry) return retry;
      throw new Error('ensureMembership race retry failed');
    }
  }
}
