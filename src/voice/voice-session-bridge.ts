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

import { Injectable, Logger } from '@nestjs/common';

import type { VoiceSessionPreset, VoiceSkillCode, VoiceVisitorCard } from './voice-session.types';

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
   */
  close(input: VoiceSessionCloseInput): Promise<void>;
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
   */
  async close(input: VoiceSessionCloseInput): Promise<void> {
    for (const bridge of this.bridges.values()) {
      try {
        await bridge.close(input);
      } catch (error) {
        this.logger.warn(
          `[close_failed] bridge=${bridge.name} session=${input.sessionId} ` +
            `err=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
