// V2026-11-09 治本 (Phase2.5 WP-B · 推理环境指纹):
//   职责: 会话创建时生成完整的推理环境指纹 —— 模型名 / 角色 semver / 审议模式 /
//         场景类型 / 引擎版本 / 逻辑种子. 落库后, 任何一场历史对练都能追溯
//         "当时用的什么环境跑的".
//
//   为什么需要这个:
//     ① 版本不是事后补记, 会话开始就注入 —— 避免"改了角色版本但新场次还记旧版本";
//     ② 考核场景硬隔离 exam → rule_only, 不依赖全局开关;
//     ③ WP-E 评测时能按版本聚合, 对比角色 1.0.0 vs 1.1.0 的数据漂移.
//
//   反双胞胎:
//     - 不做 LLM seed 回放 —— MiniMax API 不保证 seed 生效, 专业系统不靠这个.
//     - 不做逐字复现 —— 接受 LLM 概率性, 规则层确定性才是重点.
//     - engine-core 零改动 —— 本服务在适配层.

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CharacterVersionRegistry } from '../voice/character-version-slot.js';

/** 场景类型 (决定审议模式是否硬隔离). */
export type ScenarioType = 'exam' | 'freeform' | 'full_simulation';

/** 审议生效模式. */
export type DeliberationMode = 'rule_only' | 'shadow' | 'llm_active';

/** 推理环境指纹 (会话级, 每场一份). */
export interface InferenceFingerprint {
  /** LLM 模型名 (如 "MiniMax-M3.1-Flash"). */
  readonly model: string;
  /** 角色 slug. */
  readonly characterSlug: string;
  /** 角色 semver 版本号 (如 "1.0.0"); null = 查不到版本. */
  readonly characterVersion: string | null;
  /** 咨询师模式 id. */
  readonly counselorModeId: string;
  /** 本场审议模式. */
  readonly deliberationMode: DeliberationMode;
  /** 场景类型. */
  readonly scenarioType: ScenarioType;
  /** 后端代码版本 (git sha 或 build id; 缺省 "dev"). */
  readonly engineVersion: string;
  /** 逻辑种子 (批次+会话的确定性标识, 不是 LLM seed). */
  readonly sessionSeed: string;
}

@Injectable()
export class InferenceFingerprintService {
  constructor(
    private readonly config: ConfigService,
    private readonly characterVersionRegistry: CharacterVersionRegistry,
  ) {}

  /**
   * 生成会话级推理环境指纹.
   *
   * @param characterSlug 角色 slug
   * @param counselorModeId 咨询师模式 id
   * @param scenarioType 场景类型 (缺省 full_simulation)
   * @param batchId 批次 id (可选, 用于生成逻辑种子)
   * @param sessionId 场次 id
   */
  async build(
    characterSlug: string,
    counselorModeId: string,
    scenarioType: ScenarioType = 'full_simulation',
    batchId: string | null,
    sessionId: string,
  ): Promise<InferenceFingerprint> {
    // 角色版本: 建会话时读实时值, 不缓存.
    const characterVersion = await this.characterVersionRegistry.resolve(characterSlug);

    // 审议模式: 考核场景硬隔离 rule_only, 其他场景读全局配置 (缺省 rule_only).
    const deliberationMode: DeliberationMode = scenarioType === 'exam'
      ? 'rule_only'
      : this.resolveGlobalDeliberationMode();

    // 逻辑种子: batchId + sessionId 的确定性 hash (不是真随机, 是可复现标识).
    const sessionSeed = this.buildSessionSeed(batchId, sessionId);

    return {
      model: this.config.get<string>('MINIMAX_LLM_MODEL') ?? 'MiniMax-M3.1-Flash',
      characterSlug,
      characterVersion,
      counselorModeId,
      deliberationMode,
      scenarioType,
      engineVersion: this.config.get<string>('ENGINE_VERSION') ?? 'dev',
      sessionSeed,
    };
  }

  /**
   * 读全局审议模式配置 (考核场景不走这里).
   *
   * 缺省 = rule_only: 与生产现状一致 (总开关关着时全 rule_only).
   */
  private resolveGlobalDeliberationMode(): DeliberationMode {
    const enabled = this.config.get<string>('ENGINE_DELIBERATION_ENABLED');
    if (enabled !== 'true') {
      return 'rule_only';
    }
    const mode = this.config.get<string>('ENGINE_DELIBERATION_EFFECTIVE_MODE');
    if (mode === 'shadow' || mode === 'llm_active') {
      return mode;
    }
    return 'rule_only';
  }

  /**
   * 生成逻辑种子: batchId + sessionId 的确定性标识.
   *
   * 不是 LLM seed (那个不可靠), 是用于"这场属于哪一批/哪一场"的溯源标识.
   */
  private buildSessionSeed(batchId: string | null, sessionId: string): string {
    if (batchId) {
      return `${batchId}/${sessionId}`;
    }
    return `single/${sessionId}`;
  }
}
