import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CompanionBinding } from '../../profile/entities/companion-binding.entity';
import { CompanionRecord as ProfileCompanionRecord } from '../../profile/entities/companion-record.entity';
import {
  AiGuideTipDto,
  CompanionPersonDto,
  CompanionPersonsDto,
  CompanionRecordDto,
  DualExerciseDto,
  DualSessionDto,
  DualSessionStatusKey,
  RehabItemDto,
  RelationEntryDto,
  SoothingCardDto,
  SyncPracticeDto,
} from '../dto/companion.dto';
import { DualExercise } from '../entities/dual-exercise.entity';
import { DualSession } from '../entities/dual-session.entity';
import { RehabItem } from '../entities/rehab-item.entity';
import { SoothingCard } from '../entities/soothing-card.entity';
import { SyncPractice } from '../entities/sync-practice.entity';

// ════════════════════════════════════════════════════════════════
// 1. CompanionPersonsService — 顶部陪伴对象切换
// ════════════════════════════════════════════════════════════════

@Injectable()
export class CompanionPersonsService {
  /**
   * V2026-09-01 治本 (TS6133):
   *   大厂 strict 模式 (`noUnusedLocals`) 不接受声明了不用的 logger.
   *   V2.0 阶段服务内零业务日志需求, 直接删 Logger 字段,
   *   不加 underscore 前缀骗 lint (这会污染搜索 + 误导后续 maintainer).
   *   V3 接真实事件总线 / BullMQ 后, 业务日志需求出现时再加回 Logger.
   */

  constructor(
    @InjectRepository(CompanionBinding)
    private readonly bindingRepo: Repository<CompanionBinding>,
  ) {}

  /**
   * 拉当前陪伴者所有 active 绑定关系 + 元信息 (前端用 nickname / avatarEmoji / relation).
   *
   * V2.0 占位: 后端 users 表没存 nickname 时, 走 binding id 当昵称兜底.
   * V3 接 user profile 后从 UserRepository 拿 nickname + avatar.
   */
  async listPersons(uid: string): Promise<CompanionPersonsDto> {
    const bindings = await this.bindingRepo.find({
      where: { ownerUid: uid, status: 'active' },
      order: { boundAt: 'DESC' },
    });

    const persons: CompanionPersonDto[] = bindings.length ? bindings.map((_b, i) => this.toPersonDto(i)) : this.samplePersons();

    return {
      persons,
      activePersonId: persons[0]?.id ?? 'person-1',
    };
  }

  async switchPerson(uid: string, personId: string): Promise<CompanionPersonsDto> {
    // V2.0 占位: 不真改 binding 表 (binding 不能改), 只把切换结果返回前端.
    // 真实语义是改 user session 中的 "active_person_id", V3 接 user_session 表实现.
    const all = await this.listPersons(uid);
    const exists = all.persons.some((p) => p.id === personId);
    if (!exists) {
      // 大厂做法: 静默 fallback 到第一个人, 不报错 (避免 UI 错误)
      return all;
    }
    return { ...all, activePersonId: personId };
  }

  private toPersonDto(i: number): CompanionPersonDto {
    // V2026-09-01 治本 (TS6133): 原参数 `b: CompanionBinding` 未用, 直接删.
    // V2.0 sample 数据走 samplePersons() 拿, 不依赖 binding 字段 (V3 接 profile 后
    // 再从 binding.companionUid 关联 User 表拿 nickname / avatar).
    const samples = this.samplePersons();
    return samples[i % samples.length];
  }

  private samplePersons(): CompanionPersonDto[] {
    return [
      {
        id: 'person-1',
        nickname: '小雨',
        avatarKey: 'avatar-rain',
        relationLabel: '伴侣',
        accentColorToken: 'mistyPink',
        permissionLevel: 'L3',
        lastSyncAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      },
      {
        id: 'person-2',
        nickname: '妈妈',
        avatarKey: 'avatar-mom',
        relationLabel: '家属',
        accentColorToken: 'softBlue',
        permissionLevel: 'L2',
        lastSyncAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 'person-3',
        nickname: '阿哲',
        avatarKey: 'avatar-ze',
        relationLabel: '挚友',
        accentColorToken: 'mintCyan',
        permissionLevel: 'L1',
        lastSyncAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      },
    ];
  }
}

// ════════════════════════════════════════════════════════════════
// 2. SoothingService — 安抚卡片
// ════════════════════════════════════════════════════════════════

@Injectable()
export class SoothingService {
  private readonly logger = new Logger(SoothingService.name);

  constructor(
    @InjectRepository(SoothingCard)
    private readonly cardRepo: Repository<SoothingCard>,
  ) {}

  async listCards(uid: string, direction: 'sent' | 'received', activePersonId: string): Promise<SoothingCardDto[]> {
    const where = direction === 'sent' ? { fromUid: uid, toUid: activePersonId } : { fromUid: activePersonId, toUid: uid };
    const rows = await this.cardRepo.find({ where, order: { sentAt: 'DESC' }, take: 30 });
    return rows.length ? rows.map((r) => this.toDto(r)) : this.sampleCards(uid, activePersonId, direction);
  }

  async sendCard(uid: string, templateKey: string, toPersonId: string, body: string): Promise<SoothingCardDto> {
    const row = this.cardRepo.create({
      fromUid: uid,
      toUid: toPersonId,
      templateKey,
      title: this.titleForTemplate(templateKey),
      body,
      accentColorToken: 'primary',
      direction: 'sent',
      readAt: null,
    });
    const saved = await this.cardRepo.save(row);
    this.logger.log(`uid=${uid} send soothing card ${saved.id} to ${toPersonId}`);
    return this.toDto(saved);
  }

  async markRead(uid: string, cardId: string): Promise<{ ok: true }> {
    const row = await this.cardRepo.findOne({ where: { id: cardId, toUid: uid } });
    if (!row) return { ok: true };
    row.readAt = new Date();
    await this.cardRepo.save(row);
    return { ok: true };
  }

  private toDto(r: SoothingCard): SoothingCardDto {
    return {
      id: r.id,
      fromPersonId: r.fromUid,
      toPersonId: r.toUid,
      templateKey: r.templateKey as SoothingCardDto['templateKey'],
      title: r.title,
      body: r.body,
      accentColorToken: r.accentColorToken as SoothingCardDto['accentColorToken'],
      sentAt: r.sentAt.toISOString(),
      direction: r.direction,
      readAt: r.readAt ? r.readAt.toISOString() : null,
    };
  }

  private titleForTemplate(key: string): string {
    return (
      {
        gentle: '我在这里',
        breathing: '一起呼吸',
        grounding: '一起回到当下',
        warmth: '一杯温水',
        listening: '在听',
        space: '留给你',
      }[key] ?? '来自你的陪伴'
    );
  }

  private sampleCards(uid: string, activePersonId: string, direction: 'sent' | 'received'): SoothingCardDto[] {
    const now = Date.now();
    const samples: SoothingCardDto[] = [
      {
        id: 'card-s-1',
        fromPersonId: direction === 'sent' ? uid : activePersonId,
        toPersonId: direction === 'sent' ? activePersonId : uid,
        templateKey: 'gentle',
        title: '我在这里',
        body: '不需要说什么，我陪着你。',
        accentColorToken: 'mistyPink',
        sentAt: new Date(now - 4 * 3600 * 1000).toISOString(),
        direction,
        readAt: new Date(now - 3.8 * 3600 * 1000).toISOString(),
      },
      {
        id: 'card-s-2',
        fromPersonId: direction === 'sent' ? uid : activePersonId,
        toPersonId: direction === 'sent' ? activePersonId : uid,
        templateKey: 'breathing',
        title: '一起呼吸',
        body: '跟我一起：吸气 4 秒，屏息 4 秒，呼气 8 秒。',
        accentColorToken: 'mintCyan',
        sentAt: new Date(now - 24 * 3600 * 1000).toISOString(),
        direction,
        readAt: null,
      },
      {
        id: 'card-s-3',
        fromPersonId: direction === 'sent' ? uid : activePersonId,
        toPersonId: direction === 'sent' ? activePersonId : uid,
        templateKey: 'warmth',
        title: '一杯温水',
        body: '先去倒杯温水，握在手心，让温度传过来。',
        accentColorToken: 'primary',
        sentAt: new Date(now - 2 * 24 * 3600 * 1000).toISOString(),
        direction,
        readAt: new Date(now - 2 * 24 * 3600 * 1000).toISOString(),
      },
    ];
    return samples;
  }
}

// ════════════════════════════════════════════════════════════════
// 3. SyncPracticeService — 同步练习
// ════════════════════════════════════════════════════════════════

@Injectable()
export class SyncPracticeService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 CompanionPersonsService 同上 — 删未用 logger.
   */

  constructor(
    @InjectRepository(SyncPractice)
    private readonly repo: Repository<SyncPractice>,
  ) {}

  async listPractices(_uid: string): Promise<SyncPracticeDto[]> {
    const rows = await this.repo.find({ order: { updatedAt: 'DESC' } });
    return rows.length ? rows.map((r) => this.toDto(r)) : this.samplePractices();
  }

  /** 发起同步练习 — V2.0 占位仅返回 ok, V3 接 WS 推送 + 状态机. */
  async initiate(_uid: string, _syncId: string): Promise<{ ok: true }> {
    return { ok: true };
  }

  private toDto(r: SyncPractice): SyncPracticeDto {
    return {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle ?? '',
      durationMinutes: r.durationMinutes,
      relation: r.relation,
      accentColorToken: r.accentColorToken as SyncPracticeDto['accentColorToken'],
      steps: r.steps,
      iconKey: r.iconKey ?? 'self_improvement_outlined',
    };
  }

  private samplePractices(): SyncPracticeDto[] {
    return [
      {
        id: 'sync.box-breathing',
        title: '方形呼吸同步',
        subtitle: '4-4-4-4 一起呼吸',
        durationMinutes: 5,
        relation: 'partner',
        accentColorToken: 'mintCyan',
        steps: ['我方：描述节奏, 4 拍吸气 / 4 拍屏息 / 4 拍呼气 / 4 拍屏息', '对方：跟随节奏调整呼吸, 不评判'],
        iconKey: 'crop_square_outlined',
      },
      {
        id: 'sync.thought-record',
        title: '思维落叶同步',
        subtitle: '一起写下脑子里的想法',
        durationMinutes: 15,
        relation: 'partner',
        accentColorToken: 'softBlue',
        steps: ['我方：在草稿写下对方最近的烦恼', '对方：选择一片叶子, 描述想漂走还是捞起来'],
        iconKey: 'eco_outlined',
      },
      {
        id: 'sync.values-card',
        title: '共同价值澄清',
        subtitle: '找出关系里都看重的事',
        durationMinutes: 20,
        relation: 'partner',
        accentColorToken: 'mistyPink',
        steps: ['我方：从 7 个生活领域中各选 3 个', '对方：选出交集最大的 3 个, 讨论共识'],
        iconKey: 'style_outlined',
      },
      {
        id: 'sync.safe-place',
        title: '安全岛同步构建',
        subtitle: '一起想象一个安全的地方',
        durationMinutes: 12,
        relation: 'family',
        accentColorToken: 'mintCyan',
        steps: ['我方：用语音引导对方构建画面', '对方：闭眼跟随, 不必描述具体内容'],
        iconKey: 'house_outlined',
      },
      {
        id: 'sync.boundary',
        title: '边界力同步演练',
        subtitle: 'DEAR MAN 共同练习',
        durationMinutes: 15,
        relation: 'friend',
        accentColorToken: 'softBlue',
        steps: ['我方：扮演「需要被拒绝」的一方', '对方：用 DEAR MAN 框架练习温和拒绝'],
        iconKey: 'shield_outlined',
      },
    ];
  }
}

// ════════════════════════════════════════════════════════════════
// 4. DualExerciseService — 双人协同成长 (V3.0 新增)
// ════════════════════════════════════════════════════════════════

@Injectable()
export class DualExerciseService {
  private readonly logger = new Logger(DualExerciseService.name);

  constructor(
    @InjectRepository(DualExercise)
    private readonly exerciseRepo: Repository<DualExercise>,
    @InjectRepository(DualSession)
    private readonly sessionRepo: Repository<DualSession>,
  ) {}

  async listExercises(_uid: string, relationScope?: string[]): Promise<DualExerciseDto[]> {
    const rows = await this.exerciseRepo.find({ order: { updatedAt: 'DESC' } });
    let list = rows.map((r) => this.toDto(r));
    if (relationScope && relationScope.length > 0) {
      list = list.filter((e) => e.relation.some((r) => relationScope.includes(r)));
    }
    return list.length
      ? list
      : this.sampleExercises().filter((e) => {
          if (!relationScope || relationScope.length === 0) return true;
          return e.relation.some((r) => relationScope.includes(r));
        });
  }

  async getSession(_uid: string, sessionId: string): Promise<DualSessionDto | null> {
    const row = await this.sessionRepo.findOne({ where: { id: sessionId } });
    return row ? this.sessionToDto(row) : null;
  }

  async startSession(uid: string, exerciseId: string, ownerUid: string): Promise<DualSessionDto> {
    const row = this.sessionRepo.create({
      companionUid: uid,
      ownerUid,
      exerciseId,
      status: 'invited',
      completedSteps: [],
      notes: null,
    });
    const saved = await this.sessionRepo.save(row);
    this.logger.log(`uid=${uid} start dual session ${saved.id}`);
    return this.sessionToDto(saved);
  }

  async updateSession(
    uid: string,
    sessionId: string,
    status: DualSessionStatusKey,
    completedStep?: number | null,
    notes?: string | null,
  ): Promise<DualSessionDto | null> {
    const row = await this.sessionRepo.findOne({ where: { id: sessionId, companionUid: uid } });
    if (!row) return null;
    row.status = status;
    if (completedStep !== undefined && completedStep !== null) {
      const steps = row.completedSteps ?? [];
      if (!steps.includes(completedStep)) steps.push(completedStep);
      row.completedSteps = steps;
    }
    if (notes !== undefined && notes !== null) row.notes = notes;
    if (status === 'completed') row.completedAt = new Date();
    const saved = await this.sessionRepo.save(row);
    return this.sessionToDto(saved);
  }

  private toDto(r: DualExercise): DualExerciseDto {
    return {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle ?? '',
      relation: r.relationScopes,
      modality: r.modality,
      estimatedMinutes: r.estimatedMinutes,
      steps: r.steps,
      guardrails: r.guardrails,
      accentColorToken: r.accentColorToken as DualExerciseDto['accentColorToken'],
      iconKey: r.iconKey ?? 'self_improvement_outlined',
    };
  }

  private sessionToDto(r: DualSession): DualSessionDto {
    return {
      sessionId: r.id,
      exerciseId: r.exerciseId,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      completedSteps: r.completedSteps ?? [],
      notes: r.notes,
    };
  }

  private sampleExercises(): DualExerciseDto[] {
    return [
      // ── 伴侣 ──
      {
        id: 'dual.partner.attach-repair',
        title: '依恋修复五步法',
        subtitle: '重建安全感的结构化练习',
        relation: ['partner'],
        modality: 'narrative',
        estimatedMinutes: 30,
        steps: [
          '我方：描述最近一次情绪触发的场景',
          '对方：复述听到的内容, 不评论',
          '我方：识别自己的核心需求',
          '对方：猜测对方的核心需求',
          '双方：共同写出可执行的下一步',
        ],
        guardrails: ['任何一方感到受伤可暂停', '不做关系评判', '内容仅双方可见'],
        accentColorToken: 'mistyPink',
        iconKey: 'favorite_outline',
      },
      {
        id: 'dual.partner.diff-comm',
        title: '差异沟通练习',
        subtitle: '看到差异本身，不急着解决',
        relation: ['partner'],
        modality: 'communication',
        estimatedMinutes: 20,
        steps: ['我方：说出对方最近一个让自己不舒服的行为', '对方：复述理解, 表达感谢', '我方：说出背后的需求', '对方：回应需求, 不否定'],
        guardrails: ['不评判人格', '不翻旧账', '情绪激动立刻暂停'],
        accentColorToken: 'softBlue',
        iconKey: 'compare_arrows_outlined',
      },
      // ── 亲子 ──
      {
        id: 'dual.family.mirroring',
        title: '镜映练习',
        subtitle: '把孩子当下的情绪「说」给他听',
        relation: ['family'],
        modality: 'narrative',
        estimatedMinutes: 15,
        steps: ['我方：描述孩子最近一次情绪场景', '对方（家长）：用孩子的视角复述一遍', '双方：识别孩子没说出口的需求'],
        guardrails: ['家长不评价孩子', '不纠正感受', '不替孩子说话'],
        accentColorToken: 'mintCyan',
        iconKey: 'face_retouching_natural_outlined',
      },
      {
        id: 'dual.family.emotion-naming',
        title: '情绪命名协同',
        subtitle: '家长与孩子一起给情绪命名',
        relation: ['family'],
        modality: 'narrative',
        estimatedMinutes: 10,
        steps: ['我方：出示 6 张情绪卡', '对方（家长）：示范自己选哪张', '双方：一起选出今天的情绪'],
        guardrails: ['不评价选择', '允许反复修改', '不强迫表达'],
        accentColorToken: 'softBlue',
        iconKey: 'emoji_emotions_outlined',
      },
      // ── 挚友 ──
      {
        id: 'dual.friend.boundary',
        title: '边界校准练习',
        subtitle: '把「可以」和「不可以」说清楚',
        relation: ['friend'],
        modality: 'boundary',
        estimatedMinutes: 20,
        steps: [
          '我方：列出 3 件希望对方以后少做的事',
          '对方：复述并表达感谢, 不解释',
          '我方：列出 3 件希望对方继续做的事',
          '双方：约定下周回顾',
        ],
        guardrails: ['不评判对方人格', '不追溯过去', '不写进聊天记录'],
        accentColorToken: 'mistyPink',
        iconKey: 'shield_moon_outlined',
      },
      {
        id: 'dual.friend.need-express',
        title: '需求表达演练',
        subtitle: '练习把「我需要」说出口',
        relation: ['friend'],
        modality: 'communication',
        estimatedMinutes: 15,
        steps: ['我方：说出一个最近未被满足的需求', '对方：复述理解, 不评判', '双方：一起想 3 种可能的满足方式'],
        guardrails: ['不评判需求', '不打折', '不强求立刻解决'],
        accentColorToken: 'mintCyan',
        iconKey: 'campaign_outlined',
      },
    ];
  }
}

// ════════════════════════════════════════════════════════════════
// 5. RehabService — 康复协同 (L3)
// ════════════════════════════════════════════════════════════════

@Injectable()
export class RehabService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 CompanionPersonsService 同上 — 删未用 logger.
   */

  constructor(
    @InjectRepository(RehabItem)
    private readonly repo: Repository<RehabItem>,
  ) {}

  async listItems(uid: string, ownerUid: string): Promise<RehabItemDto[]> {
    const rows = await this.repo.find({
      where: { companionUid: uid, ownerUid },
      order: { dueAt: 'ASC' },
      take: 20,
    });
    return rows.length ? rows.map((r) => this.toDto(r)) : this.sampleItems(uid, ownerUid);
  }

  async completeItem(uid: string, itemId: string): Promise<{ ok: true }> {
    const row = await this.repo.findOne({ where: { id: itemId, companionUid: uid } });
    if (!row) return { ok: true };
    row.completedAt = new Date();
    await this.repo.save(row);
    return { ok: true };
  }

  private toDto(r: RehabItem): RehabItemDto {
    return {
      id: r.id,
      title: r.title,
      kind: r.kind,
      dueAt: r.dueAt.toISOString(),
      relatedPersonId: r.ownerUid,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      note: r.note,
    };
  }

  private sampleItems(_uid: string, ownerUid: string): RehabItemDto[] {
    const now = Date.now();
    return [
      {
        id: 'rehab-1',
        title: '周三复诊提醒 · 上海市精神卫生中心',
        kind: 'appointment',
        dueAt: new Date(now + 2 * 24 * 3600 * 1000 + 4 * 3600 * 1000).toISOString(),
        relatedPersonId: ownerUid,
        completedAt: null,
        note: '提前准备最近一周情绪记录',
      },
      {
        id: 'rehab-2',
        title: '晚间舍曲林 50mg',
        kind: 'medication',
        dueAt: new Date(now + 6 * 3600 * 1000).toISOString(),
        relatedPersonId: ownerUid,
        completedAt: null,
        note: null,
      },
      {
        id: 'rehab-3',
        title: '本周抑郁量表 PHQ-9 复查',
        kind: 'checkin',
        dueAt: new Date(now + 24 * 3600 * 1000).toISOString(),
        relatedPersonId: ownerUid,
        completedAt: null,
        note: null,
      },
      {
        id: 'rehab-4',
        title: '上次危机干预后第 3 天回访',
        kind: 'crisis_followup',
        dueAt: new Date(now - 1 * 3600 * 1000).toISOString(),
        relatedPersonId: ownerUid,
        completedAt: null,
        note: '建议以温和语气询问最近 3 天状态',
      },
    ];
  }
}

// ════════════════════════════════════════════════════════════════
// 6. CompanionRecordService — 陪伴记录 (复用 profile/CompanionRecord)
// ════════════════════════════════════════════════════════════════

@Injectable()
export class CompanionRecordService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 CompanionPersonsService 同上 — 删未用 logger.
   */

  constructor(
    @InjectRepository(ProfileCompanionRecord)
    private readonly recordRepo: Repository<ProfileCompanionRecord>,
  ) {}

  async listRecords(uid: string, activePersonId: string, since?: Date): Promise<CompanionRecordDto[]> {
    const qb = this.recordRepo.createQueryBuilder('r').where('r.companionUid = :uid', { uid }).orderBy('r.date', 'DESC').limit(20);
    if (activePersonId) qb.andWhere('r.relatedPersonId = :pid', { pid: activePersonId });
    if (since) qb.andWhere('r.date >= :since', { since });
    const rows = await qb.getMany();
    return rows.length ? rows.map((r) => this.toDto(r)) : this.sampleRecords(activePersonId, since);
  }

  private toDto(r: ProfileCompanionRecord): CompanionRecordDto {
    return {
      id: r.id,
      relatedPersonId: r.relatedPersonId ?? '',
      eventType: r.tag as CompanionRecordDto['eventType'],
      summary: r.summary ?? '',
      occurredAt: r.date,
      toolId: r.toolId ?? null,
      dualExerciseId: r.dualExerciseId ?? null,
      rehabItemId: r.rehabItemId ?? null,
    };
  }

  private sampleRecords(activePersonId: string, since?: Date): CompanionRecordDto[] {
    const types: CompanionRecordDto['eventType'][] = ['status_change', 'exercise', 'dual', 'rehab', 'soothing'];
    const summaries = [
      '小雨本周状态从「需关注」调整为「稳定」',
      '小雨完成 1 次「身体扫描」练习',
      '共同完成「依恋修复五步法」第 2 周',
      '周三复诊已完成, 医生反馈良好',
      '发送安抚卡片「我在这里」, 已读',
    ];
    const sinceTs = since ? since.getTime() : 0;
    const out: CompanionRecordDto[] = [];
    for (let i = 0; i < 10; i++) {
      const ts = Date.now() - i * 24 * 3600 * 1000;
      if (ts < sinceTs) break;
      out.push({
        id: `record-${i}`,
        relatedPersonId: activePersonId,
        eventType: types[i % types.length],
        summary: summaries[i % summaries.length],
        occurredAt: new Date(ts).toISOString(),
        toolId: null,
        dualExerciseId: null,
        rehabItemId: null,
      });
    }
    return out;
  }
}

// ════════════════════════════════════════════════════════════════
// 7. AiGuideService — AI 辅助指引 (按权限过滤)
// ════════════════════════════════════════════════════════════════

@Injectable()
export class AiGuideService {
  /**
   * V2026-09-01 治本 (TS6133): 参见 CompanionPersonsService 同上 — 删未用 logger.
   */

  async listTips(minLevel: 'L1' | 'L2' | 'L3' = 'L1'): Promise<AiGuideTipDto[]> {
    // V2.0 静态配置 + 等级过滤 (跟前端 minimumLevel 字段 1:1)
    const all = this.sampleTips();
    const order: Record<typeof minLevel, number> = { L1: 0, L2: 1, L3: 2 };
    const userIdx = order[minLevel];
    return all.filter((t) => order[t.minimumLevel] <= userIdx);
  }

  private sampleTips(): AiGuideTipDto[] {
    return [
      {
        id: 'tip-1',
        title: '对方在做 AI 练习时, 我该做什么?',
        subtitle: '陪伴者配合基础',
        body: '给对方一个安静不被打扰的环境；练习结束后用 5 分钟聊聊感受；不评判、不纠正、不追问。',
        iconKey: 'hearing_outlined',
        minimumLevel: 'L1',
      },
      {
        id: 'tip-2',
        title: '情绪波动时的配合话术',
        subtitle: 'DBT 痛苦耐受',
        body: '用「我看到你现在很难受」「我在这里」开场，避免「你应该」「别想太多」。',
        iconKey: 'record_voice_over_outlined',
        minimumLevel: 'L2',
      },
      {
        id: 'tip-3',
        title: '何时引导对方寻求专业帮助',
        subtitle: '边界清晰原则',
        body: '当对方连续 7 天处于「不太好」状态, 或出现自伤/自杀表述, 应主动引导拨打热线或就诊。',
        iconKey: 'medical_services_outlined',
        minimumLevel: 'L2',
      },
      {
        id: 'tip-4',
        title: '如何查看对方的训练进度',
        subtitle: 'L3 权限专属',
        body: '在「训练记录」中可看到本周完成的具体工具与时长；不展示对话原文与情绪原值。',
        iconKey: 'bar_chart_outlined',
        minimumLevel: 'L3',
      },
      {
        id: 'tip-5',
        title: '对方的高阶功能解锁意味着什么',
        subtitle: '隐私边界',
        body: '高阶功能启用 = 对方已具备一定自我调节能力；陪伴者只看到「已开启」标签, 看不到内容。',
        iconKey: 'lock_outline',
        minimumLevel: 'L2',
      },
      {
        id: 'tip-6',
        title: '如何避免共情耗竭',
        subtitle: '陪伴者自我关怀',
        body: '每天给自己留 30 分钟不被打扰的时间；感到疲惫时主动在「我的」页面标记「需要休整」。',
        iconKey: 'spa_outlined',
        minimumLevel: 'L1',
      },
    ];
  }
}

// ════════════════════════════════════════════════════════════════
// 8. RelationsService — 关系管理 (复用 profile/CompanionBinding)
// ════════════════════════════════════════════════════════════════

@Injectable()
export class RelationsService {
  private readonly logger = new Logger(RelationsService.name);

  constructor(
    @InjectRepository(CompanionBinding)
    private readonly bindingRepo: Repository<CompanionBinding>,
  ) {}

  async listRelations(uid: string): Promise<RelationEntryDto[]> {
    const rows = await this.bindingRepo.find({
      where: { ownerUid: uid, status: 'active' },
      order: { boundAt: 'DESC' },
    });
    return rows.length ? rows.map((r) => this.toDto(r)) : this.sampleRelations();
  }

  async adjustPermission(uid: string, relationId: string, level: 'L1' | 'L2' | 'L3'): Promise<{ ok: true }> {
    const row = await this.bindingRepo.findOne({ where: { id: relationId, ownerUid: uid } });
    if (!row) return { ok: true };
    row.permissionLevel = level;
    await this.bindingRepo.save(row);
    return { ok: true };
  }

  async unbind(uid: string, relationId: string): Promise<{ ok: true }> {
    const row = await this.bindingRepo.findOne({ where: { id: relationId, ownerUid: uid } });
    if (!row) return { ok: true };
    // 大厂做法: 软删 (status=terminated), 不真删, 保留审计
    row.status = 'terminated';
    row.terminatedAt = new Date();
    await this.bindingRepo.save(row);
    this.logger.log(`uid=${uid} unbound relation ${relationId}`);
    return { ok: true };
  }

  private toDto(r: CompanionBinding): RelationEntryDto {
    return {
      id: r.id,
      personId: r.companionUid ?? '',
      relation: 'other', // V3 接 profile 后从 person profile 拿
      boundAt: r.boundAt ? r.boundAt.toISOString() : r.createdAt.toISOString(),
      permissionLevel: r.permissionLevel,
      remark: r.terminateReason,
    };
  }

  private sampleRelations(): RelationEntryDto[] {
    const now = Date.now();
    return [
      {
        id: 'rel-1',
        personId: 'person-1',
        relation: 'partner',
        boundAt: new Date(now - 240 * 24 * 3600 * 1000).toISOString(),
        permissionLevel: 'L3',
        remark: 'L3 信任建立 8 个月',
      },
      {
        id: 'rel-2',
        personId: 'person-2',
        relation: 'family',
        boundAt: new Date(now - 90 * 24 * 3600 * 1000).toISOString(),
        permissionLevel: 'L2',
        remark: '每周日家庭复盘',
      },
      {
        id: 'rel-3',
        personId: 'person-3',
        relation: 'friend',
        boundAt: new Date(now - 30 * 24 * 3600 * 1000).toISOString(),
        permissionLevel: 'L1',
        remark: '暂时保持最低权限',
      },
    ];
  }
}
