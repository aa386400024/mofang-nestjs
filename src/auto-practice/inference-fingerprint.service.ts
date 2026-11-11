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

import { computePromptVersion, resolvePromptVersion } from './prompt-fingerprint.js';
import type { DeliberationScenarioType } from '../engine-adapters/deliberation/deliberation-mode.config.js';
import { resolveDeliberationModeConfig, resolveSessionEffectiveMode } from '../engine-adapters/deliberation/deliberation-mode.config.js';
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

/**
 * 场景类型 (决定审议模式是否硬隔离).
 *
 * ⚠️ **这是审议侧规范类型的 re-export, 不是第二份定义** (V2026-11-11 G-1):
 *   场景枚举原先在本文件与 `deliberation-mode.config.ts` 各写一份 —— 两份迟早漂移
 *   (加了一个新场景, 忘了改这头 → 判定按旧场景跑, 且**记录与运行时不一致**).
 *   现在唯一的定义在审议侧, 这里只做转发 (消费方 import 路径保持不变).
 */
export type ScenarioType = DeliberationScenarioType;

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
  /**
   * prompt 模板版本 (关键 prompt 模板文件的 sha256 前 16 位; 算不出时 "unknown").
   *
   * 与 `engineVersion` 的分工: engineVersion 答"哪份代码", promptVersion 答
   * "**prompt 文案**是不是同一版" —— 批次对比时后者才是要看的那个数.
   */
  readonly promptVersion: string;
  /** 逻辑种子 (批次+会话的确定性标识, 不是 LLM seed). */
  readonly sessionSeed: string;
}

@Injectable()
export class InferenceFingerprintService {
  /** 引擎版本描述缓存 (null = 还没算过). */
  private cachedEngineVersion: string | null = null;
  /** prompt 模板指纹缓存 (null = 还没算过). */
  private cachedPromptVersion: string | null = null;

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
   * @param sessionId 场次 id (业务口径 —— 用于逻辑种子)
   * @param engineSessionId **引擎侧** session id (可选; 用于审议模式判定).
   *
   *   ⚠️ **为什么必须用引擎侧口径判白名单** (V2026-11-11 G-1):
   *     运行时钩子拿到的 `context.sessionId` 是**引擎侧**会话 id (debugSessionId),
   *     而这里 `sessionId` 是**业务场次 id** (practiceSessionId) —— 两者不同.
   *     白名单 `ENGINE_DELIBERATION_GRAYSCALE_SESSIONS` 匹配的是运行时那一侧的口径,
   *     所以判定必须传同一个 id, 否则会出现"库写着 llm_active, 实际没跑" (或反过来).
   */
  async build(
    characterSlug: string,
    counselorModeId: string,
    scenarioType: ScenarioType = 'full_simulation',
    batchId: string | null,
    sessionId: string,
    engineSessionId?: string,
  ): Promise<InferenceFingerprint> {
    // 角色版本: 建会话时读实时值, 不缓存.
    const characterVersion = await this.characterVersionRegistry.resolve(characterSlug);

    // 审议模式: **调与运行时同一个判定函数** (单一真相源) —— 不再在本文件另抄一份.
    //   考核场景在 resolveSessionEffectiveMode 里首条命中 → 恒 rule_only;
    //   非考核场景走全局模式 + 会话白名单 (与运行时逐字同口径).
    const modeConfig = resolveDeliberationModeConfig(this.config);
    const engineSession = engineSessionId ?? sessionId;
    const deliberationMode: DeliberationMode = resolveSessionEffectiveMode(modeConfig, engineSession, scenarioType);

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
      promptVersion: resolvePromptVersion(this.config.get<string>('PROMPT_VERSION'), () => this.describePromptVersion()),
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
   * 取 prompt 模板指纹 (进程内**只算一次**).
   *
   * 为什么缓存: 指纹要读几个文件做 sha256 —— 一场对练建一次指纹就算一次的话,
   *   100 场批次 = 几百次文件读. 模板在一次进程生命周期里不会变, 算一次就够.
   */
  private describePromptVersion(): string {
    this.cachedPromptVersion ??= computePromptVersion();
    return this.cachedPromptVersion;
  }

  /**
   * 只解析 prompt 模板版本 (引擎无关; fail-closed 回落 'unknown').
   *
   * ⚠️ **为什么单独一个公有方法** (V2026-11-11 G-2):
   *     引擎开不起来的失败场次也要记 `prompt_version` —— 但完整 `build()` 要连角色
   *     版本仓储 (可能抛错) 且会算一堆本场无意义的字段. 而 prompt 模板是**静态文件**,
   *     它的版本与"引擎能不能开起来"**完全无关** —— 所以这个值在失败路径上依然
   *     是真值, 不该因为引擎没开就留空 (留空 = "来源不明", 与实际不符:
   *     prompt 模板其实算得出来).
   *
   * @returns prompt 模板版本号 (env → 模板指纹 → 'unknown'; 永不返 null/undefined)
   */
  resolvePromptVersionOnly(): string {
    return resolvePromptVersion(this.config.get<string>('PROMPT_VERSION'), () => this.describePromptVersion());
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
