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
import { execFileSync } from 'node:child_process';

import { CharacterVersionRegistry } from '../voice/character-version-slot.js';

/**
 * 版本号兜底值: **取不到任何版本信息**时的唯一答案.
 *
 * 为什么不是 'dev': 'dev' 看着像"开发环境的版本号", 会被误读成"这是一个可复现的版本".
 * 'unknown' 的含义明确 —— 这场数据的来源版本**不明**, 不能拿它做跨版本对比.
 */
export const ENGINE_VERSION_UNKNOWN = 'unknown';

/**
 * 取 git 描述 (纯函数, 便于单测; git 不可用时回落 unknown, 不抛错).
 *
 * 用 `git describe --always --dirty`:
 *   · `--always`  —— 没有 tag 也能给出短 sha (否则在没打 tag 的仓库里直接失败);
 *   · `--dirty`   —— 工作区有未提交改动时加 '-dirty' 后缀.
 *
 * `-dirty` 后缀是关键: 让"这批数据来自未提交代码"这件事**在数据里可见**.
 *   第一波金丝雀就是这么翻车的 —— 跑的是旧 dist 产物, 而库里的版本号写着 'dev',
 *   谁都看不出那批数据到底是哪份代码跑出来的.
 *
 * 生产容器里通常**没有 .git** —— 那时 git 命令非零退出, 回落 'unknown', 不抛错
 * (抛错会让整场对练失败, 那比版本号不明严重得多).
 *
 * @param cwd 执行目录 (默认进程工作目录)
 * @returns git 描述字符串; 取不到时返回 'unknown'
 */
export function gitDescribeDirty(cwd: string = process.cwd()): string {
  try {
    // sonarjs/no-os-command-from-path 豁免: 命令与参数都是**硬编码常量**
    //   (不接任何外部输入), 且用 execFileSync 走参数数组 (不经 shell) —— 没有 PATH 注入面.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const output = execFileSync('git', ['describe', '--always', '--dirty'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    return output.length > 0 ? output : ENGINE_VERSION_UNKNOWN;
  } catch {
    return ENGINE_VERSION_UNKNOWN;
  }
}

/**
 * 解析引擎版本号 (纯函数).
 *
 * 口径 (优先级从高到低):
 *   ① ENGINE_VERSION env (显式覆盖 —— 部署方知道自己发的是哪版);
 *   ② `git describe --always --dirty` 的结果;
 *   ③ 'unknown'.
 *
 * @param envValue ENGINE_VERSION 的 env 原值
 * @param describe 取 git 描述的函数 (注入, 便于单测)
 * @returns 引擎版本号
 */
export function resolveEngineVersion(envValue: string | undefined, describe: () => string): string {
  const trimmed = (envValue ?? '').trim();
  if (trimmed.length > 0) return trimmed;
  const described = describe().trim();
  return described.length > 0 ? described : ENGINE_VERSION_UNKNOWN;
}

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
  /** 引擎版本描述缓存 (null = 还没算过). */
  private cachedEngineVersion: string | null = null;

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
    const deliberationMode: DeliberationMode = scenarioType === 'exam' ? 'rule_only' : this.resolveGlobalDeliberationMode();

    // 逻辑种子: batchId + sessionId 的确定性 hash (不是真随机, 是可复现标识).
    const sessionSeed = this.buildSessionSeed(batchId, sessionId);

    return {
      model: this.config.get<string>('MINIMAX_LLM_MODEL') ?? 'MiniMax-M3.1-Flash',
      characterSlug,
      characterVersion,
      counselorModeId,
      deliberationMode,
      scenarioType,
      engineVersion: resolveEngineVersion(this.config.get<string>('ENGINE_VERSION'), () => this.describeEngineVersion()),
      sessionSeed,
    };
  }

  /**
   * 取引擎版本描述 (进程内**只算一次**).
   *
   * 为什么缓存: `git describe` 要起一个子进程 —— 一场对练建一次指纹就起一次的话,
   *   100 场批次 = 100 次子进程, 白白拖慢. 版本在一次进程生命周期里不会变, 算一次就够.
   */
  private describeEngineVersion(): string {
    this.cachedEngineVersion ??= gitDescribeDirty();
    return this.cachedEngineVersion;
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
