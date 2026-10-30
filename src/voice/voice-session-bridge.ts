// V2026-10-26 治本 (vpt 会话落库插槽 — 依赖倒置, spec 任务 1):
//   原因: vpt 会话要从"纯内存、结束即清"升级成"落 training_sessions 表" —— 督导报告要有
//     稳定落库 id 可挂、每轮分析要有 transcript 可读、4 流派反馈要有 sessionId 可指.
//     但落库表 (`training_sessions`) 属 **counselor 业务域**, 而 WS 网关在 voice (agent) 侧.
//     若 voice 直接注入 counselor 的 Repository → agent → business 反向依赖, 将来 counselor
//     改表结构会连带炸语音链路, 且极易形成循环依赖 (仓库硬约束 14).
//   修法: 跟仓库既有的 `VoiceTemplateRegistry` / `VoiceCatalogRegistry` 同一套范式 ——
//     **插槽 + 全局注册表**:
//     - voice 侧只声明"我需要一个能落库的会话桥"这个接口 (VoiceSessionBridge)
//     - counselor 侧实现该接口 (建会话 / 追加一轮 / 结束会话) 并注册进全局注册表
//     - voice 侧调注册表, **不认识** counselor 的任何类型
//   降级契约 (关键):
//     桥未注册 / 桥抛错 → **不阻断会话**: 注册表吞掉异常并返回"未落库", 语音闭环照常.
//     理由: 落库是"复盘闭环"的前置, 不是"能对聊"的前置 —— 为了让用户看不到对方而把
//     整个 WS 打断, 是把可降级故障升级成不可用.
//     但降级**必须可见**: 网关把 `persisted=false` 放进 `ready` 帧, 前端能知道"本场不落库".
//   反双胞胎:
//     - 不在 voice 侧直接注入 Repository: 反向依赖 (见文件头)
//     - 不用 NestJS provider token 直接注入实现: 同名 token 在各 module 里各有一份,
//       消费方拿到的是自己 module 的那份, 业务实现根本到不了消费者
//     - 不让桥的异常冒泡到 WS 层: 一次 DB 抖动不该让整场会谈断连
//   验证:
//     1. tsc 0 错
//     2. 启动日志能看到 "voice session bridge: counselor-vpt" 注册成功
//     3. counselor 未注册桥时 (单测 / agent 独立部署) → 语音闭环行为与改前完全一致
//   时间戳: 2026-10-26
//
// V2026-10-30 治本 (WP12 · 逐字稿全量覆盖写插槽):
//   原因: 逐字稿原本只靠**每轮增量**落库 (`appendTurn`), 进程中途崩了就停在最后一轮 ——
//     而 `EngineStreamBackend.transcripts` 是进程内 Map, 重启即丢, 两边都不够.
//     任务单 §1.4 要求: "close 时必须落库, 不落库就报错", "落库边界写死, 不留模糊".
//     做法: 桥接口加一个**可选**方法 `replaceTranscript?` —— 收尾时把本场完整逐字稿
//     覆盖写回 `training_sessions.transcript` (报告链路的逐字稿表).
//   为什么是**可选**方法而不是必需:
//     桥是"插槽", 实现方可能还没接逐字稿覆盖写 (旧实现 / 第三方实现 / 测试桩).
//     写成必需 → 所有实现方一次性全炸; 写成可选 → 没实现的桥照常跑,
//     只是"收尾时不做全量覆盖" (逐字稿仍靠每轮增量), 降级可见 (注册表返回 false).
//   反双胞胎:
//     - 不新开一张表: 逐字稿归 `training_sessions.transcript` (与 4 流派 / 报告链路同源),
//       另开一张 = 两套逐字稿格式, 必然漂移.
//     - 不在 voice 层直接写库: voice 不认识 ORM (同文件头的依赖倒置理由), 写库仍在 counselor 侧.
//     - 不把"覆盖写"做成"追加写": 覆盖写才是"定稿"语义 (任务单原话"逐字稿快照"),
//       追加写会让同一段话在库里出现两次.
//   验证:
//     1. tsc 0 错
//     2. test/voice/vpt-session.spec.ts: 未实现 replaceTranscript 的桥 → 注册表返回 false, 不抛
//     3. test/engine-adapters/wp12-memory-closeout.spec.ts: 覆盖写成功 → 逐字稿落库
//   时间戳: 2026-10-30

import { Injectable, Logger } from '@nestjs/common';

import type { VoiceSessionPreset, VoiceSkillCode, VoiceVisitorCard } from './voice-session.types';
import type { VoiceSessionReportStatus } from './voice.types';
import type { TranscriptTurn } from '../agent/supervisor/supervisor.types';

/**
 * 建连输入 (WS 握手成功、准备落库时).
 */
export interface VoiceSessionOpenInput {
  /** WS 会话 id (客户端提供, 内存态) */
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  /** 公共人物模板 id; null = 兜底人设通道 (专项兜底 / 自定义人设来源). */
  readonly templateId: string | null;
  /** 来访者速查卡 (可公开的表层字段). */
  readonly visitor: VoiceVisitorCard;
  /** 本场生效的临场参数. */
  readonly preset: VoiceSessionPreset;
  /** 专项训练技巧码; null = 全流程 / 个案. */
  readonly skillCode: VoiceSkillCode | null;
}

/**
 * 建连结果.
 */
export interface VoiceSessionOpenResult {
  /** 是否落库 (false = 降级为纯内存会话, 本场不会有复盘报告). */
  readonly persisted: boolean;
  /**
   * 稳定落库 id (training_sessions.id).
   *
   * null = 未落库. 后续督导反馈 / 实时提示 / 报告**全部**挂这个 id, 不用内存 sessionId.
   */
  readonly dbSessionId: string | null;
}

/**
 * 一轮对话输入 (咨询师发言 + 来访者回应都结束后).
 */
export interface VoiceSessionTurnInput {
  /** WS 会话 id (内存态). */
  readonly sessionId: string;
  /** 稳定落库 id; null = 未落库 (本轮不入库). */
  readonly dbSessionId: string | null;
  readonly userId: string;
  readonly tenantId: string;
  /** 本轮在逐字稿里的序号 (从 0 开始). */
  readonly turnIndex: number;
  /** 咨询师这一轮说的话. */
  readonly counselorText: string;
  /** 来访者这一轮的回应. */
  readonly visitorText: string;
}

/**
 * 结束输入.
 */
export interface VoiceSessionCloseInput {
  readonly sessionId: string;
  readonly dbSessionId: string | null;
  readonly userId: string;
  readonly tenantId: string;
  /** 结束原因. */
  readonly reason: 'user_finish' | 'timeout' | 'error';
  /** 本场轮次数 (咨询师发言轮). */
  readonly turnCount: number;
  /** 本场实际时长 (毫秒). */
  readonly durationMs: number;
}

/**
 * 结束结果 (业务侧收尾后回给 voice 层).
 *
 * V2026-10-27 (spec 任务 B): 业务侧在收尾时就知道"这场会不会有报告" ——
 *   素材不足 (空局) → `reportStatus='no_content'` (报告永远不会生成, 前端不进轮询页).
 * voice 层把它原样带进 `session_ended` 帧; 拿不到结论时为 null (前端按旧行为处理).
 */
export interface VoiceSessionCloseResult {
  /** 本场是否已落库 (false = 降级为纯内存会话). */
  readonly persisted: boolean;
  /** 报告状态 (null = 未给出结论). */
  readonly reportStatus: VoiceSessionReportStatus | null;
}

/**
 * 逐字稿全量覆盖写输入 (WP12).
 *
 * 逐字稿用 `TranscriptTurn` (agent/supervisor 既有类型) —— 与督导报告链路同一口径,
 * 不在这里另造一套格式.
 */
export interface VoiceSessionTranscriptInput {
  /** 稳定落库 id (training_sessions.id). */
  readonly dbSessionId: string;
  /** 归属学员 id (缺省 = 不校验归属). */
  readonly userId?: string;
  /** 本场完整逐字稿 (一问一答两条交替). */
  readonly turns: readonly TranscriptTurn[];
}

/**
 * vpt 会话落库桥 (业务侧实现).
 *
 * 实现方只需回答三个问题: "这场会谈要不要落库" / "这一轮聊了什么" / "这场怎么收尾".
 */
export interface VoiceSessionBridge {
  /** 桥标识 (日志用). */
  readonly name: string;
  /**
   * 建会话 (落一条 training_sessions 记录).
   *
   * @param input 建连输入
   * @returns 落库结果; 未落库 → `{ persisted: false, dbSessionId: null }`
   */
  open(input: VoiceSessionOpenInput): Promise<VoiceSessionOpenResult>;
  /**
   * 追加一轮对话 (逐字稿落库 + 触发该轮分析).
   *
   * @param input 一轮对话
   */
  appendTurn(input: VoiceSessionTurnInput): Promise<void>;
  /**
   * 结束会话 (回写状态 / 时长 / 轮次 + 派发督导).
   *
   * @param input 结束输入
   * @returns 收尾结果 (落库与否 + 报告状态)
   */
  close(input: VoiceSessionCloseInput): Promise<VoiceSessionCloseResult>;
  /**
   * 全量覆盖写逐字稿 (WP12 · **可选**).
   *
   * 收尾时把本场完整逐字稿写回逐字稿表 (覆盖语义 = 定稿).
   * 未实现 = 该桥不支持收尾全量覆盖 (逐字稿仍靠每轮增量) —— 注册表会如实返回 false.
   *
   * @param input 覆盖写输入
   */
  replaceTranscript?(input: VoiceSessionTranscriptInput): Promise<void>;
}

/**
 * vpt 会话落库桥注册表 (@Global 注入, 业务模块在 onModuleInit 注册自己的实现).
 */
@Injectable()
export class VoiceSessionBridgeRegistry {
  private readonly logger = new Logger(VoiceSessionBridgeRegistry.name);
  private readonly bridges = new Map<string, VoiceSessionBridge>();

  /**
   * 注册一个桥 (同 name 覆盖, 便于测试时热替换).
   *
   * @param bridge 桥实现
   */
  register(bridge: VoiceSessionBridge): void {
    this.bridges.set(bridge.name, bridge);
    this.logger.log(`[registered] voice session bridge: ${bridge.name}`);
  }

  /**
   * 注销一个桥.
   *
   * @param name 桥名
   */
  unregister(name: string): void {
    this.bridges.delete(name);
  }

  /**
   * 建会话 (跨桥取第一个成功的).
   *
   * 桥抛错 → 记日志 + 继续下一个桥; 全部失败 / 未注册 → `{ persisted: false }` (**不抛**).
   *
   * @param input 建连输入
   * @returns 落库结果
   */
  async open(input: VoiceSessionOpenInput): Promise<VoiceSessionOpenResult> {
    for (const bridge of this.bridges.values()) {
      try {
        const result = await bridge.open(input);
        if (result.persisted) {
          return result;
        }
      } catch (error) {
        this.logger.warn(
          `[open_failed] bridge=${bridge.name} session=${input.sessionId} ` +
            `err=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { persisted: false, dbSessionId: null };
  }

  /**
   * 追加一轮对话 (跨桥依次调用; 单个桥失败不影响其他).
   *
   * @param input 一轮对话
   */
  async appendTurn(input: VoiceSessionTurnInput): Promise<void> {
    for (const bridge of this.bridges.values()) {
      try {
        await bridge.appendTurn(input);
      } catch (error) {
        this.logger.warn(
          `[append_turn_failed] bridge=${bridge.name} session=${input.sessionId} ` +
            `err=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * 结束会话 (跨桥依次调用; 单个桥失败不影响其他).
   *
   * @param input 结束输入
   * @returns 第一个桥的收尾结果 (无桥 / 全部失败 → null)
   */
  async close(input: VoiceSessionCloseInput): Promise<VoiceSessionCloseResult | null> {
    for (const bridge of this.bridges.values()) {
      try {
        return await bridge.close(input);
      } catch (error) {
        this.logger.warn(
          `[close_failed] bridge=${bridge.name} session=${input.sessionId} ` +
            `err=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return null;
  }

  /**
   * 全量覆盖写逐字稿 (WP12).
   *
   * 语义: **覆盖 = 定稿** —— 把内存里的本场完整逐字稿写回逐字稿表,
   * 补上"每轮增量写入失败的那些轮次", 并把落库边界钉死 (写不成就明确报错, 不留模糊).
   *
   * 三种结局 (调用方靠返回值/异常区分):
   *   - 有桥实现且写成功 → `true`;
   *   - 没有桥实现该能力 (老实现 / 测试桩) → `false` (**不抛**, 属常态降级);
   *   - 有桥实现但**全部写失败** → **抛错** (数据没存下来, 必须让人知道).
   *
   * @param input 覆盖写输入
   * @returns 是否写成功
   * @throws 有桥实现但全部失败时抛错
   */
  async replaceTranscript(input: VoiceSessionTranscriptInput): Promise<boolean> {
    let attempted = false;
    let written = false;
    let lastError: unknown;
    for (const bridge of this.bridges.values()) {
      if (!bridge.replaceTranscript) continue;
      attempted = true;
      try {
        await bridge.replaceTranscript(input);
        written = true;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `[replace_transcript_failed] bridge=${bridge.name} db_session=${input.dbSessionId} ` +
            `err=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (attempted && !written) {
      throw lastError instanceof Error ? lastError : new Error('逐字稿覆盖写失败: 全部落库桥都失败');
    }
    return written;
  }
}
