import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';

import type { MicroInterventionDto, MicroInterventionActiveResponseDto, MicroInterventionSettingsDto } from '../dto/home-overview.dto';
import { MicroInterventionConfig } from '../entities/micro-intervention-config.entity';
import { MicroInterventionHistory } from '../entities/micro-intervention-history.entity';
import type { HomeEmotionLevel } from '../home.constants';

/**
 * 心塑「场景化微干预」核心服务 — V2.0 §3 + §6 (DESIGN).
 *
 * 职责:
 *   - getActive(uid, emotionLevel, now): 决定当前是否触发微干预
 *   - getSettings(uid) / upsertSettings(uid, dto)
 *   - start(uid, interventionId): 写 history, 返回 sessionId + routePath
 *   - complete(uid, interventionId, sessionId, durationSeconds)
 *   - dismiss(uid, interventionId, sessionId)
 *
 * V2.0 算法 (治本版):
 *   - 决策树: emotion=crisis AND time in [22:00, 02:00) → 推「睡前 30 秒平稳」
 *   - 决策树: emotion=low AND time in [08:00, 10:00) → 推「晨起 30 秒接地」
 *   - 默认 pending: 「会议前 30 秒平稳」(放到「今日推荐」下方, 用户可手动展开)
 *
 * V3 升级计划:
 *   - 接日程权限 / 位置权限 / 使用行为识别 — 服务端 + 端侧联合决策
 *   - 1 分钟内同 trigger 去重 — 防刷屏
 *
 * 大厂做法:
 *   - 频控: 全局 1 分钟内同 trigger 不重复弹 (前端 + 后端双控)
 *   - 配置 (master_enabled / sensitivity / enabled_triggers) 在 MicroInterventionConfig 表
 *   - 1:1 影子表 + 自动 upsert (跟 UserProfile 模式一致)
 */
@Injectable()
export class HomeMicroInterventionService {
  private readonly logger = new Logger(HomeMicroInterventionService.name);

  constructor(
    @InjectRepository(MicroInterventionConfig)
    private readonly configRepo: Repository<MicroInterventionConfig>,
    @InjectRepository(MicroInterventionHistory)
    private readonly historyRepo: Repository<MicroInterventionHistory>,
  ) {}

  /**
   * 决策当前激活 / 待触发的微干预.
   *
   * 返回结构:
   *   - active: 顶部置顶展示 (高优先级)
   *   - pending: 默认卡 (低优先级, 用户可手动展开)
   */
  async getActive(uid: string, emotionLevel: HomeEmotionLevel | null, now: Date): Promise<MicroInterventionActiveResponseDto> {
    const cfg = await this.ensureConfig(uid);

    // 总开关关闭 → 都返回 null
    if (!cfg.masterEnabled) {
      return { active: null, pending: null };
    }

    const hour = now.getHours();
    const triggers = cfg.enabledTriggers ?? this.defaultTriggers();

    // 静默时段检查 (e.g. 22:00 - 08:00)
    // 静默时段下, 只在 crisis 时才激活 (V2.0 例外)
    if (this.isInQuietHours(hour, cfg.quietStart, cfg.quietEnd) && emotionLevel !== 'crisis') {
      return { active: null, pending: this.defaultPending() };
    }

    // ─── 决策树 ─────────────────────────────────────────────
    // 1. crisis + late-night → 顶部激活「睡前 30 秒平稳」
    if (emotionLevel === 'crisis' && (hour >= 22 || hour < 2) && (triggers.includes('late_night') || triggers.includes('before_sleep'))) {
      return { active: this.build('mi-night-anchor', 'late_night'), pending: this.defaultPending() };
    }

    // 2. crisis 白天 → 顶部激活「2 分钟平稳呼吸」(高频救命, 不分时段)
    if (emotionLevel === 'crisis') {
      return { active: this.build('mi-crisis-breath', 'before_social'), pending: this.defaultPending() };
    }

    // 3. low + 早上 → 顶部激活「晨起 30 秒接地」
    if (emotionLevel === 'low' && hour >= 7 && hour < 11 && triggers.includes('waking_up_anxious')) {
      return { active: this.build('mi-morning-ground', 'waking_up_anxious'), pending: this.defaultPending() };
    }

    // 4. 默认: 只挂 pending 「会议前 30 秒平稳」
    return { active: null, pending: this.defaultPending() };
  }

  /**
   * 读取配置 (1:1, 不存在则自动创建默认).
   */
  async getSettings(uid: string): Promise<MicroInterventionSettingsDto> {
    const cfg = await this.ensureConfig(uid);
    return this.toSettingsDto(cfg);
  }

  /**
   * 更新配置 — 大厂 standard: 全部字段必填, 直传.
   *
   * 大厂做法: enabledTriggers 在 DTO 是 string[] (宽松接收),
   * 落库前用类型守卫 narrow 到 entity 的 union 范围, 未知值丢掉 (不报错,
   * 跟前端允许任意顺序调整触发场景的 UX 一致).
   *
   * 之前加 `if (dto.x !== undefined)` 是踩坑 — DTO 字段是 `!` 必填,
   * `!== undefined` 永远是 true, sonarjs/different-types-comparison 报错.
   * 直接赋值的语义清晰: dto.x 一定存在 (类型上保证), 不需要空检查.
   */
  async updateSettings(uid: string, dto: MicroInterventionSettingsDto): Promise<MicroInterventionSettingsDto> {
    const cfg = await this.ensureConfig(uid);
    cfg.masterEnabled = dto.masterEnabled;
    cfg.sensitivity = dto.sensitivity;
    cfg.enabledTriggers = dto.enabledTriggers.filter(
      (t): t is NonNullable<typeof cfg.enabledTriggers>[number] =>
        t === 'before_meeting' ||
        t === 'before_social' ||
        t === 'before_sleep' ||
        t === 'after_argument' ||
        t === 'scrolling_anxiety' ||
        t === 'late_night' ||
        t === 'waking_up_anxious',
    );
    cfg.quietStart = dto.quietStart;
    cfg.quietEnd = dto.quietEnd;
    const saved = await this.configRepo.save(cfg);
    this.logger.log(`updateSettings uid=${uid} master=${saved.masterEnabled} sens=${saved.sensitivity}`);
    return this.toSettingsDto(saved);
  }

  /**
   * 开始执行微干预 — 写 history + 返回 sessionId.
   *
   * 大厂做法: sessionId 用 randomUUID (密码学安全), 不依赖外部传 (防止伪造).
   */
  async start(
    uid: string,
    interventionId: string,
  ): Promise<{ sessionId: string; interventionId: string; startedAt: Date; routePath: string }> {
    const def = this.definitionById(interventionId);
    if (!def) {
      throw new BizException(BizCode.InvalidParameter, `未知的微干预: ${interventionId}`);
    }
    const sessionId = randomUUID();
    const startedAt = new Date();
    await this.historyRepo.save(
      this.historyRepo.create({
        uid,
        interventionId,
        status: 'started',
        startedAt,
      }),
    );
    return {
      sessionId,
      interventionId,
      startedAt,
      routePath: def.routePath,
    };
  }

  /**
   * 完成执行 — 写 completed_at + duration.
   *
   * V2.0: feedbackCopy 由 duration 简单生成 (无评判).
   * V3: 接 LLM 个性化.
   */
  async complete(
    uid: string,
    interventionId: string,
    completed: boolean,
    durationSeconds: number,
  ): Promise<{ sessionId: string; completed: boolean; completedAt: Date; durationSeconds: number; feedbackCopy: string }> {
    const def = this.definitionById(interventionId);
    if (!def) {
      throw new BizException(BizCode.InvalidParameter, `未知的微干预: ${interventionId}`);
    }
    const completedAt = new Date();
    // 找最近一条 started → completed / dismissed 转换
    const history = await this.historyRepo.findOne({
      where: { uid, interventionId, status: 'started' },
      order: { createdAt: 'DESC' },
    });
    if (!history) {
      throw new BizException(BizCode.ResourceNotFound, '找不到本次微干预的开始记录');
    }
    history.status = completed ? 'completed' : 'dismissed';
    history.completedAt = completed ? completedAt : null;
    history.dismissedAt = completed ? null : completedAt;
    history.durationSeconds = durationSeconds;
    await this.historyRepo.save(history);

    const feedbackCopy = completed ? '这次微干预已记录, 你可以随时再来一次' : '中途退出也是可以的, 任何时候都可以重新开始';

    return {
      sessionId: history.id,
      completed,
      completedAt,
      durationSeconds,
      feedbackCopy,
    };
  }

  /**
   * 标记未读 / 关闭微干预.
   *
   * V2.0 实现: 给当前激活的微干预写 dismissed 状态, 让 active 计算时跳过.
   * V3 升级: 接 trigger fingerprint 去重.
   */
  async dismiss(uid: string, interventionId: string): Promise<{ dismissedAt: Date }> {
    const history = await this.historyRepo.findOne({
      where: { uid, interventionId, status: 'started' },
      order: { createdAt: 'DESC' },
    });
    const dismissedAt = new Date();
    if (history) {
      history.status = 'dismissed';
      history.dismissedAt = dismissedAt;
      await this.historyRepo.save(history);
    }
    return { dismissedAt };
  }

  // ════════════════════════════════════════════════════════════════
  // 内部 helpers
  // ════════════════════════════════════════════════════════════════

  /**
   * 自动 upsert 配置 (跟 UserProfile.ensureProfile 同模式).
   */
  private async ensureConfig(uid: string): Promise<MicroInterventionConfig> {
    const existing = await this.configRepo.findOne({ where: { uid } });
    if (existing) return existing;
    try {
      return await this.configRepo.save(
        this.configRepo.create({
          uid,
          masterEnabled: true,
          sensitivity: 'medium',
          enabledTriggers: this.defaultTriggers(),
          quietStart: '22:00',
          quietEnd: '08:00',
        }),
      );
    } catch {
      // 并发 upsert 兜底: race condition 后重 select
      const retry = await this.configRepo.findOne({ where: { uid } });
      if (retry) return retry;
      throw new BizException(BizCode.UnknownError, '微干预配置初始化失败');
    }
  }

  private toSettingsDto(cfg: MicroInterventionConfig): MicroInterventionSettingsDto {
    return {
      masterEnabled: cfg.masterEnabled,
      sensitivity: cfg.sensitivity,
      enabledTriggers: cfg.enabledTriggers ?? this.defaultTriggers(),
      quietStart: cfg.quietStart,
      quietEnd: cfg.quietEnd,
    };
  }

  /**
   * 默认触发场景 — 跟 DESIGN §1.5 全开.
   */
  private defaultTriggers(): (
    'before_meeting' | 'before_social' | 'before_sleep' | 'after_argument' | 'scrolling_anxiety' | 'late_night' | 'waking_up_anxious'
  )[] {
    return ['before_meeting', 'before_social', 'before_sleep', 'after_argument', 'scrolling_anxiety', 'late_night', 'waking_up_anxious'];
  }

  /**
   * 静默时段检查 — HH:mm 字符串比较.
   */
  /**
   * 静默时段检查 — HH:mm 字符串比较.
   *
   * 大厂做法: tsconfig 没启用 noUncheckedIndexedAccess, destructure [qsH] 给的是 number
   * (非 number | undefined), `=== undefined` 永远是 false (sonarjs 报).
   * 治本: 改用 `Number.isNaN` 兑底 (Number('') / Number('invalid') = NaN).
   * DB schema 强制 HH:mm, 不会 NaN, 这里是是额外防御性检查.
   */
  private isInQuietHours(hour: number, quietStart: string, quietEnd: string): boolean {
    const qsH = Number(quietStart.split(':', 1)[0]);
    const qeH = Number(quietEnd.split(':', 1)[0]);
    if (Number.isNaN(qsH) || Number.isNaN(qeH)) return false;
    // 跨午夜场景: e.g. 22:00-08:00 → hour >= 22 || hour < 8
    if (qsH > qeH) {
      return hour >= qsH || hour < qeH;
    }
    return hour >= qsH && hour < qeH;
  }

  /**
   * 微干预定义库 — V2.0 写死 (V3 切 DB).
   *
   * 大厂做法: id + title + description + durationSeconds + kind + trigger + routePath
   *   跟前端 MicroIntervention entity 1:1 对齐.
   */
  private readonly definitions: Record<string, Omit<MicroInterventionDto, 'routePath'> & { routePath: string }> = {
    'mi-night-anchor': {
      id: 'mi-night-anchor',
      title: '睡前的 30 秒平稳',
      durationSeconds: 30,
      kind: 'breathing',
      description: '一只手放在胸口, 感受 3 次呼吸起伏',
      cta: '开始 30 秒',
      trigger: 'late_night',
      routePath: '/micro-intervention/execute?interventionId=mi-night-anchor',
    },
    'mi-crisis-breath': {
      id: 'mi-crisis-breath',
      title: '2 分钟平稳呼吸',
      durationSeconds: 120,
      kind: 'breathing',
      description: '4-7-8 节奏, 让心跳慢下来',
      cta: '开始 2 分钟',
      trigger: 'before_social',
      routePath: '/micro-intervention/execute?interventionId=mi-crisis-breath',
    },
    'mi-morning-ground': {
      id: 'mi-morning-ground',
      title: '晨起的 30 秒接地',
      durationSeconds: 30,
      kind: 'grounding',
      description: '感受脚底, 5-4-3-2-1 回到此刻',
      cta: '开始 30 秒',
      trigger: 'waking_up_anxious',
      routePath: '/micro-intervention/execute?interventionId=mi-morning-ground',
    },
    'mi-meeting-prep': {
      id: 'mi-meeting-prep',
      title: '会议前的 30 秒平稳',
      durationSeconds: 30,
      kind: 'breathing',
      description: '打开摄像头前, 用一次深呼吸稳住节奏',
      cta: '开始 30 秒',
      trigger: 'before_meeting',
      routePath: '/micro-intervention/execute?interventionId=mi-meeting-prep',
    },
  };

  private definitionById(id: string): (Omit<MicroInterventionDto, 'routePath'> & { routePath: string }) | undefined {
    return this.definitions[id];
  }

  private build(
    id: string,
    trigger:
      'before_meeting' | 'before_social' | 'before_sleep' | 'after_argument' | 'scrolling_anxiety' | 'late_night' | 'waking_up_anxious',
  ): MicroInterventionDto {
    const def = this.definitions[id];
    if (!def) {
      // V2.0 兜底: 未知 id 走会议前 (最常见), V3 升级时这块要从 DB 读
      return {
        id,
        title: '微干预',
        durationSeconds: 30,
        kind: 'breathing',
        description: '',
        cta: '开始',
        trigger,
        routePath: `/micro-intervention/execute?interventionId=${id}`,
      };
    }
    return def;
  }

  private defaultPending(): MicroInterventionDto {
    return this.build('mi-meeting-prep', 'before_meeting');
  }
}
