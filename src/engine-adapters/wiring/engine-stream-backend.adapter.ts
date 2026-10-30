// V2026-10-29 治本 (WP8-B · B 层 · 引擎 → voice 对话后端适配):
//   职责: 实现 voice 侧的窄接口 `VoiceTurnBackend` —— 把新引擎的"决策 → 流式渲染"
//         翻译成语音链路熟悉的三态 chunk (content / done / error), 并维护
//         逐字稿副本 (供督导报告).
//   边界: 装配层 (src/engine-adapters/wiring/); 只做**翻译与记账**, 不写决策、
//         不拼 prompt、不碰 TTS/ASR/帧协议.
//
//   为什么这个适配器住在 wiring 而不是 rendering:
//     它依赖 `EngineTurnService` (wiring 层的东西), 而 wiring 又依赖 rendering ——
//     若把适配器放在 rendering, 就成了 rendering → wiring → rendering 的**目录环**.
//     它的职责本来就是"装配": 把一个子系统 (引擎) 的形状翻译成另一个子系统
//     (语音) 的形状, 这正是 wiring 层的定义.
//
//   为什么"翻译点只有一处":
//     语音消费器 (`VoiceService.consumeLlmStream`) 只认三态 chunk, 且**零改动**
//     (成熟资产). 于是所有"引擎语义 → 语音语义"的转换必须收敛在本文件:
//       增量文本 → content chunk;
//       本轮结束 → done chunk (带 usage);
//       引擎侧失败 → error chunk (带 code / message / retryable).
//     若在 voice 层里写"如果是新引擎就怎样", 语音层就得知道引擎的内部语义 ——
//     那是把两个子系统的知识搅在一起, 灰度一关就全是死代码.
//
//   为什么"降级兜底句"也要出声 (而不是静默 done):
//     任务单 §2.4 要求全挂时"仍正常返回收尾结果, 让上层能发 done, TTS 不悬挂".
//     若降级时一个字都不吐, 前端会看到"开始了 → 结束了, 但没有任何话", 用户
//     以为程序卡了. 兜底句本身就是为这一刻准备的 (中性、不越界).
//
//   反双胞胎:
//     - 不在 voice 层判断"这是不是新引擎": 本文件已经把一切翻译成三态 chunk,
//       voice 层拿到的两条链路**形状完全一样**, 于是"选哪条"只剩灰度开关一个决定.
//     - 不自己写逐字稿格式: 直接复用 `TranscriptTurn` (agent/supervisor 的既有类型),
//       督导报告那条链路的解析口径不用改.
//     - 不在失败时把半句写进逐字稿: 与旧链路对齐 —— 旧链路在早退时回滚 user 消息,
//       净效果是"这一轮不落逐字稿". 这里只在整轮成功时落, 语义一致.
//     - 不吞引擎侧的内核错误: 内核错误 (SESSION_NOT_FOUND / ABORTED) 转成 error chunk
//       交给既有消费器处理, 与旧链路"LLM 流错误 → error 帧"同形.
//     - V2026-10-29 (WP9-A): 角色解析**失败不抛**, 只 warn + 回退中性基线.
//       角色是**可选增强**, 不是会话的前置条件 —— 抛错会把"没有角色"升级成
//       "会话开不起来", 那是一个可选能力不该有的失败半径.
//
//   V2026-10-29 治本 (WP9-A · B 层 · 角色解析注入):
//   职责: 开场时把"角色定义"解析成内核 `CharacterProfile` 并注入内核, 让人格基线
//         (信念 / 阻抗 / 情绪 / 信任) 在**第一轮之前**就位; 解析不到就走中性基线.
//   边界: 只做"解析 → 注入 → 快照命名"; 角色语义 (种子/映射口径) 全在
//         `wiring/character/`, 本文件**不认识**任何具体角色.
//
//   为什么解析点收敛在这一个文件:
//     翻译点只有一处是 WP8-B 立下的纪律 —— 引擎语义 → 语音语义必须收敛.
//     角色解析同属"引擎语义": 窄接口只透传"角色 key + 临场参数"这**原始事实**,
//     "这个 key 意味着什么样的阻抗与信念"是引擎侧的事. voice 层若自己去解析角色,
//     voice 层就得知道角色语义, 灰度一关就全是死代码.
//
//   反双胞胎 (WP9-A):
//     - 不用 @nestjs 的 useClass 装配 resolver: 它的构造参数带默认值, Nest 会把
//       Object 当成待注入依赖而报错 —— 走 useFactory 显式 new (与仓库既有做法一致).
//     - 不把"查不到角色"当错误: DB 角色池未接时这是**常态**, warn 即可.
//     - 不手改内核快照: 初始快照由内核 `buildInitialSnapshot` 装配 (含 label 重算),
//       适配层只交出纯对象, 不在外部拼快照.
//
//   V2026-10-30 治本 (WP10 · B 层 · 轨迹剧本注入):
//   职责: 开场时把"剧本 id"解析成内核 `TrajectoryScript` 并注入内核的 `trajectory`
//         字段, 让伦理盲盒剧本在**第一轮之前**就位; 解析不到就走 BDI 自由运行.
//   边界: 只做"解析 → 注入"; 剧本内容 (10 个伦理盲盒) 全在 `wiring/trajectory/`,
//         本文件**不认识**任何具体剧本, 也不判断"这次会谈该不该有剧本".
//
//   为什么解析点与角色解析收敛在同一个文件:
//     翻译点只有一处是 WP8-B 立下的纪律 —— 引擎语义 → 语音语义必须收敛.
//     剧本解析同属"引擎语义": 窄接口只透传"剧本 key"这个**原始事实**,
//     "这个 key 意味着什么样的伦理事件"是引擎侧的事. voice 层若自己去解析剧本,
//     voice 层就得知道剧本语义, 灰度一关就全是死代码.
//
//   反双胞胎 (WP10):
//     - 不在 voice 层判断"有没有剧本": 它只透传 scriptId 字符串.
//     - 不在本文件写剧本内容: 只调 resolver, 拿到什么注入什么.
//     - 不因为"查不到剧本"抛错: 剧本是可选增强 (与角色解析同款语义),
//       查不到 = warn + 回退自由运行, 会话照常开.
//     - 不给旧 VisitorService 加剧本支持: 它不接新引擎剧本, 天然 undefined.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/voice/wp8b-grayscale.spec.ts 覆盖 delta → content / 结束 → done / 失败 → error
//     3. test/engine-adapters/wp9a-open-profile.spec.ts 覆盖角色注入 / 中性回退 / 快照一致性
//     4. test/engine-adapters/wp10-trajectory-injection.spec.ts 覆盖剧本注入 / 未命中回退 / 零回归
//
//   时间戳: 2026-10-30 GMT+8

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { CHARACTER_PROFILE_RESOLVER, type CharacterProfileResolver, type ResolvedCharacter } from './character';
import type { EngineTurnService } from './engine-turn.service';
import { TRAJECTORY_SCRIPT_RESOLVER, type TrajectoryScriptResolver } from './trajectory';
import type { LlmStream, LlmStreamChunk } from '../../agent/llm/llm.types';
import type { TranscriptTurn } from '../../agent/supervisor/supervisor.types';
import type { OpenEngineSessionInput, TrajectoryScript } from '../../engine-core';
import { VoiceFrameRegistry } from '../../voice/voice-frame-registry';
import type {
  VoiceTurnBackend,
  VoiceTurnBackendCloseResult,
  VoiceTurnBackendOpenOptions,
  VoiceTurnBackendTurnOptions,
} from '../../voice/voice-turn-backend.port';
import type { VoiceSessionPersona } from '../../voice/voice.types';
import type { SessionCloseoutService } from '../persistence/session-closeout.service';
import { isCrisisCategory } from '../rendering/render-risk';
import type { TurnRenderResult } from '../rendering/turn-render-orchestrator';

/**
 * 中性基线来访者身份 (无角色时的回落形态).
 *
 * 为什么是中性基线而不是"读 persona 实体":
 *   角色资产 (5Ps / 难度 / 情绪基线) 的解析由 `CharacterProfileResolver` 负责
 *   (WP9-A: 内置种子; WP9-B: DB 角色池). 解析不到时给一个**不越界**的中性身份:
 *   它不承诺任何角色特征, 也不伪造一个看起来很像角色的假身份 (那会让报告里的
 *   人名与真实设定对不上). 中性基线 = WP8-B 的现状行为, 逐字不变.
 */
const NEUTRAL_PERSONA: VoiceSessionPersona = {
  id: 'voice_visitor',
  name: '来访者',
  voiceId: '',
  difficulty: 'L1',
};

/**
 * 引擎版对话后端 (实现 voice 侧窄接口).
 */
@Injectable()
export class EngineStreamBackend implements VoiceTurnBackend {
  private readonly logger = new Logger(EngineStreamBackend.name);
  /** 语音会话 id → 内核句柄 id. */
  private readonly handles = new Map<string, string>();
  /** 语音会话 id → 逐字稿 (一问一答两条). */
  private readonly transcripts = new Map<string, TranscriptTurn[]>();
  /**
   * 语音会话 id → 稳定落库 id (training_sessions.id).
   *
   * V2026-10-29 治本 (WP9-C): 督导轻提示帧按**稳定落库 id** 路由 (voice 侧的
   * `VoiceFrameRegistry` 就是按它登记出口的), 而窄接口给的是 WS 会话 id ——
   * 两者不是一回事, 所以这里显式存一份.
   */
  private readonly dbSessionIds = new Map<string, string>();
  /**
   * 语音会话 id → 长时记忆的归属上下文 (WP12).
   *
   * 为什么单独存: 收尾时要拿**同一个**作用域去写长时记忆, 而内核召回也是按这个
   * 作用域查的 —— 写与读必须是同一把键, 否则摘要写进去了却永远召不回.
   */
  private readonly sessionContexts = new Map<string, SessionContext>();

  constructor(
    private readonly engine: EngineTurnService,
    /**
     * 角色解析器 (WP9-A).
     *
     * 为什么 @Optional: 角色是**可选增强**. 装配缺失 (旧装配 / 独立单测) 时必须
     * 仍然能开会话 —— 等同"无角色 → 中性基线", 而不是 500.
     */
    @Optional() @Inject(CHARACTER_PROFILE_RESOLVER) private readonly resolver?: CharacterProfileResolver,
    /**
     * WS 帧出口注册表 (WP9-C).
     *
     * 为什么 @Optional: 它由 voice 侧的 `VoiceSessionModule` (@Global) 提供.
     * 装配缺失时**只影响危机提示帧**, 不影响会话本身 —— 不能让"没有出口"变成
     * "开不了会话".
     */
    @Optional() private readonly frames?: VoiceFrameRegistry,
    /**
     * 轨迹剧本解析器 (WP10).
     *
     * 为什么 @Optional: 剧本是**可选增强**, 与角色解析同款语义 —— 装配缺失 (旧装配 /
     * 独立单测) 时必须仍然能开会话, 等同"本场无剧本 → BDI 自由运行", 而不是 500.
     *
     * 位置说明: 本参数排在 `traceRecorder` 之前 —— `traceRecorder` 至今没有装配入口
     * (后端走工厂构造, Nest 不读它的 design:paramtypes), 把它挪到最后一位是为了
     * 让工厂能用**位置参数**把剧本解析器装进来, 不必在中间插一个 undefined 占位.
     */
    @Optional() @Inject(TRAJECTORY_SCRIPT_RESOLVER) private readonly scriptResolver?: TrajectoryScriptResolver,
    /**
     * 会话收尾服务 (WP12): 逐字稿全量落库 + 会话摘要晋升长时记忆.
     *
     * 为什么 @Optional: 收尾是**增强** —— 装配缺席时本场会谈照常结束, 只是
     * "逐字稿没全量落库" + "没有长时记忆". 不能让"没有收尾服务"变成"开不了会话".
     */
    @Optional() private readonly closeout?: SessionCloseoutService,
    /**
     * 调试快照记录器 (WP19).
     *
     * 为什么 @Optional: 它由 AdminDebugModule 提供. 装配缺失时
     * 会话照常进行, 只是没有调试 trace 落库 —— 不能让"没有调试器"变成
     * "开不了会话".
     */
    @Optional() private readonly traceRecorder?: import('../../admin-debug/trace-recorder.service').TraceRecorder,
  ) {}

  /**
   * 开场: 内核开会话 (有角色 → 注入角色基线; 无角色 → 中性基线).
   *
   * 重复开会话 → 先关掉旧句柄再开新的 (与旧 visitor "覆盖 memory" 的行为对齐;
   * 不对齐的话, 第二条 `user_text` 之前的一次 startSession 重连就会撞上
   * `SESSION_ALREADY_OPEN`, 而那本该是无感的重连).
   */
  async openSession(opts: VoiceTurnBackendOpenOptions): Promise<VoiceSessionPersona> {
    const previous = this.handles.get(opts.sessionId);
    if (previous) {
      this.handles.delete(opts.sessionId);
      this.engine.close(previous);
    }

    const characterId = resolveCharacterId(opts);
    const character = await this.resolveCharacter(opts);
    const script = this.resolveTrajectoryScript(opts);
    // V2026-10-30 治本 (WP12): 长时记忆的归属作用域 = **(学员, 角色)**.
    //   见 buildMemoryScope 的说明 —— 这一步不做, 学员之间会互相读到对方的咨询内容.
    const memoryScope = buildMemoryScope(opts.userId, resolveCharacterKey(opts, characterId));
    // V2026-10-30 治本 (WP12): 跨会话接续来源.
    const resumeFromSessionId = opts.resumeFromSessionId?.trim() ?? '';
    const handle = this.openKernelSession(opts, character, script, memoryScope, resumeFromSessionId);

    this.handles.set(opts.sessionId, handle.handleId);
    this.transcripts.set(opts.sessionId, []);
    this.sessionContexts.set(opts.sessionId, {
      tenantId: opts.tenantId,
      visitorId: memoryScope,
      userId: opts.userId?.trim() ?? '',
      // 有没有学员身份: 没有的话长时记忆**不写** (见 buildMemoryScope 的说明).
      studentScoped: (opts.userId?.trim() ?? '').length > 0,
    });
    const dbSessionId = opts.dbSessionId?.trim() ?? '';
    if (dbSessionId.length > 0) {
      this.dbSessionIds.set(opts.sessionId, dbSessionId);
    }
    this.logger.log(
      `[openSession] session=${opts.sessionId} handle=${handle.handleId} visitor=${memoryScope} ` +
        `character=${character?.displayName ?? 'neutral'} script=${script?.scriptId ?? 'none'} ` +
        `resume=${resumeFromSessionId || 'none'}`,
    );
    // 对外仍然回 personaId (身份键不因角色而变 —— WP9-A 既有口径).
    return character ? { ...NEUTRAL_PERSONA, id: characterId, name: character.displayName } : { ...NEUTRAL_PERSONA, id: characterId };
  }

  /**
   * 调内核开会话 (带接续兜底).
   *
   * 接续失败**不阻断** (任务单 §1.5.5): 上一场不存在 / 已过期 / 状态读失败 →
   *   记 warn, 按**新会话**开. 不抛错、不断连.
   *
   * 抽成独立方法有两个原因:
   *   ① `openSession` 的圈复杂度已到上限, 再塞分支就超 (仓库 eslint 卡 20);
   *   ② "接续失败怎么兜"是一条**独立决策**, 单独成方法后可以被一眼读完.
   *
   * @param opts 开场参数
   * @param character 本场角色 (无 = 中性基线)
   * @param script 本场剧本 (无 = BDI 自由运行)
   * @param memoryScope 长时记忆归属作用域
   * @param resumeFromSessionId 接续来源 (空 = 新会话)
   * @returns 内核句柄
   */
  private openKernelSession(
    opts: VoiceTurnBackendOpenOptions,
    character: ResolvedCharacter | null,
    script: TrajectoryScript | undefined,
    memoryScope: string,
    resumeFromSessionId: string,
  ): { readonly handleId: string; readonly sessionId: string } {
    const openOptions = { characterLabel: character?.displayName ?? '' };
    try {
      return this.engine.open(this.buildOpenInput(opts, character, script, memoryScope, resumeFromSessionId, true), openOptions);
    } catch (error) {
      if (!resumeFromSessionId) throw error;
      this.logger.warn(
        `[openSession] 接续上一场失败, 按新会话开 session=${opts.sessionId} ` + `resumeFrom=${resumeFromSessionId}: ${messageOf(error)}`,
      );
      return this.engine.open(this.buildOpenInput(opts, character, script, memoryScope, resumeFromSessionId, false), openOptions);
    }
  }

  /**
   * 构造内核开场入参.
   *
   * 三个"有才带"的字段 (characterProfile+seed / trajectory / resumeFromSessionId):
   *   **不传时键不存在**, 不是"值为 undefined" —— 与现状逐字一致 (WP10 的零回归断言
   *   断言的就是键集合, 键存在即算形状变了).
   *
   * @param opts 开场参数
   * @param character 本场角色
   * @param script 本场剧本
   * @param memoryScope 长时记忆归属作用域
   * @param resumeFromSessionId 接续来源
   * @param withResume 本次是否带接续 (兜底重开时传 false)
   * @returns 内核开场入参
   */
  private buildOpenInput(
    opts: VoiceTurnBackendOpenOptions,
    character: ResolvedCharacter | null,
    script: TrajectoryScript | undefined,
    memoryScope: string,
    resumeFromSessionId: string,
    withResume: boolean,
  ): OpenEngineSessionInput {
    return {
      sessionId: opts.sessionId,
      tenantId: opts.tenantId,
      visitorId: memoryScope,
      // 有角色才带 profile/seed; 无角色时**不传这两个字段** (缺省 = 中性默认基线),
      // 与 WP8-B 的调用形态逐字一致.
      ...(character
        ? {
            characterProfile: character.characterProfile,
            ...(character.seed === undefined ? {} : { seed: character.seed }),
          }
        : {}),
      // V2026-10-30 治本 (WP10): 有剧本才带 trajectory; 没解析到 / 没传 scriptId
      //   时**不传这个字段** (缺省 = 本场无轨迹约束), 与现状逐字一致.
      ...(script ? { trajectory: script } : {}),
      // V2026-10-30 治本 (WP12): 有 resume 才带; 没传时**不传这个字段**
      //   (缺省 = 全新会话), 与现状逐字一致.
      ...(withResume && resumeFromSessionId ? { resumeFromSessionId } : {}),
    };
  }

  /**
   * 解析本场角色 (WP9-A).
   *
   * 三种"没有角色"的口径统一收敛到 null (走中性基线), 且**都不抛错**:
   *   1. resolver 未装配 (@Optional 缺省);
   *   2. 本场没有任何角色参数 (普通 voice session);
   *   3. 角色 key 查不到 (DB 角色池未接时的常态) / 解析过程抛错.
   *
   * @param opts 开场参数
   * @returns 解析结果; 无角色 → null
   */
  private async resolveCharacter(opts: VoiceTurnBackendOpenOptions): Promise<ResolvedCharacter | null> {
    if (!this.resolver) return null;
    try {
      const resolved = await this.resolver.resolve({
        templateId: opts.templateId,
        skillCode: opts.skillCode,
        preset: opts.preset,
      });
      if (!resolved) {
        // 查不到是常态 (角色池未接), 但带了 templateId 仍值得记一笔:
        // 线上排查"为什么这场没上角色"时, 这是唯一的线索.
        if (opts.templateId?.trim()) {
          this.logger.warn(`[openSession] 未解析到角色 templateId=${opts.templateId}, 回退中性基线`);
        }
        return null;
      }
      return resolved;
    } catch (error) {
      this.logger.warn(`[openSession] 角色解析异常, 回退中性基线: ${messageOf(error)}`);
      return null;
    }
  }

  /**
   * 解析本场轨迹剧本 (WP10).
   *
   * 三种"没有剧本"的口径统一收敛到 undefined (走 BDI 自由运行), 且**都不抛错**:
   *   1. 本场没带 scriptId (普通 voice session) —— 连 warn 都不打 (常态);
   *   2. 剧本解析器未装配 (@Optional 缺省);
   *   3. scriptId 查不到 (资产不存在 / Phase2 数据源未接) / 解析过程抛错.
   *
   * 为什么"查不到"必须是 warn 而不是抛错: 剧本是**可选增强**, 抛错会把
   * "客户端传了个不认识的剧本 id"升级成"会话开不起来" —— 那是一个可选能力
   * 不该有的失败半径 (与 WP9-A 角色解析同款语义).
   *
   * @param opts 开场参数
   * @returns 剧本; 无剧本 → undefined
   */
  private resolveTrajectoryScript(opts: VoiceTurnBackendOpenOptions): TrajectoryScript | undefined {
    const scriptId = opts.trajectoryScriptId?.trim() ?? '';
    if (scriptId.length === 0) return undefined;
    if (!this.scriptResolver) {
      this.logger.warn(`[openSession] 剧本解析器未装配, scriptId=${scriptId}, 回退自由运行`);
      return undefined;
    }
    try {
      const script = this.scriptResolver.resolve(scriptId);
      if (!script) {
        this.logger.warn(`[openSession] 未解析到剧本 scriptId=${scriptId}, 回退自由运行`);
        return undefined;
      }
      return script;
    } catch (error) {
      this.logger.warn(`[openSession] 剧本解析异常, 回退自由运行: ${messageOf(error)}`);
      return undefined;
    }
  }

  /**
   * 一轮: 把引擎的流式渲染翻译成三态 chunk.
   */
  async streamTurn(opts: VoiceTurnBackendTurnOptions): Promise<{ readonly stream: LlmStream }> {
    const handleId = this.handles.get(opts.sessionId);
    if (!handleId) {
      // 会话没开 → 直接抛 (调用方负责回落旧链路); 静默返回一个空流会让上层
      // 以为"这一轮正常结束但没话说", 那是最难排查的一种坏.
      throw new Error(`EngineStreamBackend.streamTurn: sessionId=${opts.sessionId} 未开启`);
    }
    return { stream: this.buildStream(handleId, opts) };
  }

  /**
   * 收尾: 关内核句柄 + 清逐字稿, 返回本场统计.
   */
  closeSession(sessionId: string): VoiceTurnBackendCloseResult {
    const turns = this.transcripts.get(sessionId) ?? [];
    const result: VoiceTurnBackendCloseResult = {
      finalTurnCount: turns.filter((turn) => turn.role === 'assistant').length,
      finalMessageCount: turns.length,
    };

    // V2026-10-29 治本 (WP19 · flush 调试快照):
    //   会话关闭时把内存缓冲的 trace 写回 DB. fire-and-forget, 不阻塞 close.
    const dbSid = this.dbSessionIds.get(sessionId);
    if (dbSid && this.traceRecorder) {
      void this.traceRecorder.flush(dbSid);
    }

    const context = this.sessionContexts.get(sessionId);
    const handleId = this.handles.get(sessionId);

    this.transcripts.delete(sessionId);
    this.dbSessionIds.delete(sessionId);
    this.sessionContexts.delete(sessionId);
    if (handleId) {
      this.handles.delete(sessionId);
      this.engine.close(handleId);
    }

    // V2026-10-30 治本 (WP12 · 会话收尾):
    //   逐字稿全量落库 + 本场摘要晋升长时记忆. fire-and-forget (与上面的 trace flush 同款):
    //   收尾是 I/O, 不能反过来阻塞 `session_ended` 帧 (前端在等这个帧收页面).
    //
    //   ⚠️ **只在会话真的开着时触发** (按句柄判定):
    //     voice 侧的关闭路径会把"当前后端"与"引擎后端"**各关一次** —— 引擎链路下
    //     这两个是同一个对象, 于是 closeSession 会被调两次. 第二次调用时句柄已经被
    //     清掉了, 若不按句柄判定, 第二次就会拿**空逐字稿**去覆盖写库 ——
    //     把刚落库的逐字稿抹掉 (而且不留任何痕迹).
    if (handleId && this.closeout) {
      void this.closeout
        .finalize({
          tenantId: context?.tenantId ?? '',
          sessionId,
          // 没有学员身份 → **不晋升**长时记忆 (见 buildMemoryScope 的说明).
          ...(context?.studentScoped ? { visitorId: context.visitorId } : {}),
          ...(context?.userId ? { userId: context.userId } : {}),
          ...(dbSid ? { dbSessionId: dbSid } : {}),
          transcript: turns,
        })
        .catch((error: unknown) => {
          this.logger.warn(`[closeSession] 会话收尾异常 session=${sessionId}: ${messageOf(error)}`);
        });
    }

    this.logger.log(
      `[closeSession] session=${sessionId} turns=${result.finalTurnCount} msgs=${result.finalMessageCount} ` +
        `closeout=${handleId && this.closeout ? 'yes' : 'no'}`,
    );
    return result;
  }

  /**
   * 逐字稿副本 (督导报告用).
   */
  transcript(sessionId: string): readonly TranscriptTurn[] {
    return this.transcripts.get(sessionId) ?? [];
  }

  /**
   * 引擎流 → 三态 chunk 的翻译体.
   */
  private async *buildStream(handleId: string, opts: VoiceTurnBackendTurnOptions): AsyncIterable<LlmStreamChunk> {
    const queue = new DeltaQueue();
    const pending = this.engine
      .turnStream(
        handleId,
        { userText: opts.userText, traceId: opts.traceId, ...(opts.signal ? { signal: opts.signal } : {}) },
        { onDelta: (delta) => queue.push(delta), ...(opts.signal ? { signal: opts.signal } : {}) },
      )
      .then((result) => {
        queue.close();
        return { ok: true as const, result };
      })
      .catch((error: unknown) => {
        queue.close();
        return { ok: false as const, error };
      });

    const spoken: string[] = [];
    for await (const delta of queue) {
      spoken.push(delta);
      yield { type: 'content', content: delta };
    }

    const settled = await pending;
    if (!settled.ok) {
      this.logger.warn(`[streamTurn] session=${opts.sessionId} 引擎流失败: ${messageOf(settled.error)}`);
      yield {
        type: 'error',
        error: { code: 'engine_stream_error', message: messageOf(settled.error), retryable: true },
      };
      return;
    }

    const reply = settled.result.reply;
    if (spoken.length === 0 && reply.length > 0) {
      // 一个增量都没吐但有正文 → 降级兜底句 (引擎全挂时走这条路).
      // 把它当 content 吐出去, 否则前端会看到"开始了 → 结束了, 却没有任何话".
      spoken.push(reply);
      yield { type: 'content', content: reply };
    }

    const degraded = settled.result.render.providerHint === 'degraded';
    if (!degraded) {
      this.appendTurn(opts.sessionId, opts.userText, spoken.join(''));
    }

    // V2026-10-29 治本 (WP9-C · 同步危机提示):
    //   危机轮次**不等异步 worker** —— 督导提示如果靠队列 worker, 就会错过"这一轮"
    //   的窗口 (人已经说完下一句了, 提示才到). 所以在**本轮结算的当场**推帧.
    this.publishCrisisHint(opts.sessionId, settled.result);

    const usage = settled.result.render.usage;

    // WP19: 调试快照留痕 (抽成私有方法降复杂度).
    this.recordTrace(opts.sessionId, settled.result, usage);

    yield {
      type: 'done',
      usage: {
        promptTokens: 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        ...(usage?.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
      },
    };
  }

  /**
   * WP19: 每轮完成时写调试快照到内存缓冲 (会话关闭时 flush).
   *
   * 抽成独立方法: ①降 buildStream 圈复杂度; ②调试逻辑不污染主链路阅读.
   */
  private recordTrace(sessionId: string, result: TurnRenderResult, usage: TurnRenderResult['render']['usage']): void {
    if (!this.traceRecorder) return;
    const dbSid = this.dbSessionIds.get(sessionId);
    if (!dbSid) return;
    const snap = result.snapshot;
    this.traceRecorder.record(dbSid, {
      turnIndex: result.turnIndex,
      bdi: {
        trust: snap.trust,
        valence: snap.emotion.valence,
        arousal: snap.emotion.arousal,
        resistance: snap.resistance.verbal,
        attachmentType: snap.emotion.label,
      },
      usage: {
        completionTokens: usage?.completionTokens ?? 0,
        reasoningTokens: usage?.reasoningTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
      },
      crisis: {
        detected: result.safety !== undefined,
        category: result.safety?.categories?.[0] ?? null,
      },
      ts: new Date().toISOString(),
    });
  }

  /**
   * 危机轮次 → 同步推 `supervision_hint` 帧.
   *
   * 判定口径与渲染路由**同一份** (isCrisisCategory): 内核判出来的 warn 里,
   * 只有"危机类别"才推提示 —— 咨询师的专业性提示 (过早给建议 / 价值审判) 属于
   * 事后复盘项, 不该在对话中途打断督导的注意力.
   *
   * 正文只给**方向**, 不含可照念的话术 (仓库硬约束 1): 提示是给督导看的,
   * 不是给学员念的.
   *
   * @param sessionId 语音会话 id
   * @param result 本轮结算结果
   */
  private publishCrisisHint(sessionId: string, result: TurnRenderResult): void {
    const safety = result.safety;
    if (!safety || safety.level === 'pass') return;
    const categories = safety.categories.filter((category) => isCrisisCategory(category));
    if (categories.length === 0) return;

    const dbSessionId = this.dbSessionIds.get(sessionId);
    if (!dbSessionId || !this.frames) {
      this.logger.warn(`[streamTurn] 危机轮次未推督导提示 (session=${sessionId} 无落库 id 或无帧出口)`);
      return;
    }

    const published = this.frames.publish(dbSessionId, {
      type: 'supervision_hint',
      turnIndex: result.turnIndex,
      category: categories.join(','),
      hintText: '检测到明确的危机信号，建议督导在本轮后介入评估安全风险。',
      tier: 'light',
    });
    this.logger.warn(
      `[streamTurn] 危机轮次已推督导提示 session=${sessionId} turn=${result.turnIndex} ` +
        `level=${safety.level} categories=${categories.join(',')} published=${published}`,
    );
  }

  /**
   * 追加一问一答到逐字稿 (只记**完整跑完**的轮次, 与旧链路同口径).
   */
  private appendTurn(sessionId: string, counselorText: string, visitorText: string): void {
    const turns = this.transcripts.get(sessionId) ?? [];
    const at = Date.now();
    turns.push({ role: 'user', content: counselorText, at }, { role: 'assistant', content: visitorText, at });
    this.transcripts.set(sessionId, turns);
  }
}

/**
 * 会话归属上下文 (WP12): 收尾时要用的那把"记忆作用域键".
 */
interface SessionContext {
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 长时记忆的归属作用域 (= 内核入参的 visitorId). */
  readonly visitorId: string;
  /** 归属学员 id (逐字稿写库的归属校验用). */
  readonly userId: string;
  /** 是否带学员身份 (没带 → 不写长时记忆). */
  readonly studentScoped: boolean;
}

/**
 * 本场的角色 id (对外身份键): personaId 优先, 缺省 = 中性基线 id.
 *
 * @param opts 开场参数
 * @returns 角色 id
 */
function resolveCharacterId(opts: VoiceTurnBackendOpenOptions): string {
  const trimmed = opts.personaId?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : NEUTRAL_PERSONA.id;
}

/**
 * 本场的**角色 key** (记忆归属作用域用): 公共人物模板 id 优先, 否则 personaId.
 *
 * 为什么模板 id 优先: 同一份"角色资产"在 vpt 场里 personaId 常常是空的, 只有
 * 模板 id 能区分"晚晴"和"小满" —— 用 personaId 当 key 会把所有无 persona 的角色
 * 归成同一份记忆.
 *
 * @param opts 开场参数
 * @param characterId 角色 id (模板 id 缺省时的回落)
 * @returns 角色 key
 */
function resolveCharacterKey(opts: VoiceTurnBackendOpenOptions, characterId: string): string {
  const templateId = opts.templateId?.trim() ?? '';
  return templateId.length > 0 ? templateId : characterId;
}

/**
 * 构造长时记忆的归属作用域 (WP12).
 *
 * 口径: **`学员 id : 角色 key`**.
 *
 * 为什么不能只用角色 key (这是本单最容易踩的坑):
 *   内核的 `visitorId` 是长时记忆**跨会话归属键** —— 写入用一把键, 召回也用同一把键.
 *   而这个产品的"来访者"是 **AI 扮演的角色** (晚晴/小满…), 角色 key 对所有学员都相同.
 *   若直接拿角色 key 当归属键, 学员 A 的咨询摘要会被学员 B 召回去 ——
 *   那不是"体验更好", 是**把甲学员的私密内容念给乙学员听**.
 *   归属键必须包含**学员身份**, 才等于"我的这个角色的上次".
 *
 * 为什么不用"学员 id"单独做键: 同一学员练不同角色时不该互相污染 (角色基线不同),
 *   所以键里必须带角色.
 *
 * 学员 id 缺失时 (理论上不该发生 —— 语音链路有 JWT 鉴权): 退化为纯角色 key,
 *   并由调用方据此**不写**长时记忆 (没有归属就没有隔离).
 *
 * @param userId 学员 id (可空)
 * @param characterKey 角色 key (公共人物模板 id 优先, 否则 personaId)
 * @returns 归属作用域
 */
function buildMemoryScope(userId: string | undefined, characterKey: string): string {
  const user = (userId ?? '').trim();
  return user.length > 0 ? `${user}:${characterKey}` : characterKey;
}

/**
 * 极简异步队列 —— 把「push 型 onDelta 回调」翻译成「pull 型 AsyncIterable」.
 *
 * 为什么需要它: 引擎的流式接口是**回调**形态 (`onDelta`), 而 voice 的消费接口是
 * **拉取**形态 (AsyncIterable). 两边形态不同, 中间必须有一座转换. 放在这里而不是
 * 引擎侧, 是因为"推 → 拉"的转换是**消费侧**的责任 (谁在消费, 谁决定怎么拉).
 *
 * 反双胞胎: 不引第三方队列库 (为一个几十行的需求加依赖不划算), 也不复用 TTS 的
 * 事件队列 (那是 bidi 协议专用, 语义与生命周期都不同).
 */
class DeltaQueue {
  private readonly buffer: string[] = [];
  private notify: (() => void) | null = null;
  private closed = false;

  /** 推入一段增量. */
  push(delta: string): void {
    if (this.closed || delta.length === 0) return;
    this.buffer.push(delta);
    this.notify?.();
  }

  /** 关闭队列 (生产者结束). */
  close(): void {
    this.closed = true;
    this.notify?.();
  }

  /** 拉取增量 (直到队列关闭). */
  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    for (;;) {
      while (this.buffer.length > 0) {
        yield this.buffer.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.notify = resolve;
      });
      this.notify = null;
    }
  }
}

/**
 * 错误转可读文案.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
