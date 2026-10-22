// V2026-10-21 治本 (V1.2 VS-B2 — 来访者上下文插槽 (依赖倒置)):
//   原因: v1.2 §4.3 要求「长程: 注入 VisitorFullPersona 全量 + 当前信任度 + 已解锁
//     CaseProfileEntry 列表」到 **AI 来访者** 的 prompt. 但 AI 来访者在 src/agent/visitor/,
//     它跟 counselor 业务**完全正交** (agent 侧 0 处 import counselor):
//       - agent 的 Persona 实体只有 3 个字段 (complaint / personality / background) + 难度 + 情绪基线
//       - 它走的是**内存** PersonaRepository (PersonaRepositoryMemory), 3 个内置 persona
//       - counselor 的 training_sessions.persona* (5 字段) / long_term_cases.visitor_persona (8 字段)
//         / visitor_full_personas (7 大块) **此前从未进过任何 AI prompt**
//     若让 agent 直接 import counselor 的数据 → 破坏单向依赖 (agent → business),
//     且 agent 的 persona 存储是内存实现, 跨存储后要重做.
//   修法: **依赖倒置** —— agent 只提供"插槽", 不认识业务:
//     - VisitorContextContributor: 业务侧实现"我能为这个 session 提供什么上下文"
//     - VisitorContextRegistry: agent 侧全局注册表, 按 sessionId 收集所有贡献者的产出
//     - VisitorService 每轮从 registry 解析, 把内容块拼进 system prompt
//     counselor 侧注册自己的实现 (CounselorVisitorContextContributor), **agent 不 import counselor**.
//   反双胞胎:
//     - 不用 "agent 里写 if (isCounselorSession) ..." 的硬编码分支: 那等于 agent 认识业务
//     - 不用 NestJS 的 provider token 直接注入 (VisitorModule import CounselorModule):
//       那会造成 counselor → agent (LlmModule) 与 agent → counselor 的**循环依赖**
//     - 不用模块级 provider 覆盖: 同名 token 在不同 module 里各有一份, 消费方拿到的是
//       自己 module 的那份, 业务实现根本到不了消费者. 全局注册表绕开这个坑
//     - 不用 Redis Pub/Sub 传上下文: 上下文是**请求级**数据, 不是事件, 走不到 pub/sub
//   验证:
//     1. tsc 0 错
//     2. 大炮开长程会话的 voice WS → 来访者 prompt 带上「本次会话的来访者设定」段
//     3. 开一个**非** counselor 的普通 voice session → prompt 不变 (向后兼容)
//   时间戳: 2026-10-21

import { Injectable } from '@nestjs/common';

import type { PersonaDifficulty } from '../persona/domain/entities/persona.entity';

/**
 * 一次会话级上下文贡献的产出.
 */
export interface VisitorContextBlock {
  /**
   * 上下文正文 (会原样进 system prompt).
   *
   * 约定: 正文里应自带小标题, 让模型知道这段是"本次会话的设定"而非通用画像.
   */
  readonly content: string;
  /**
   * 覆盖来访者难度档位 (影响 behavior block 的选择).
   *
   * 咨询师为本场会话配置的难度优先于 agent 内置 persona 的难度.
   */
  readonly difficulty?: PersonaDifficulty;
  /**
   * 覆盖身份信息 (代号 / 年龄 / 职业).
   *
   * 咨询师为本场会话配置的来访者身份优先于 agent 内置 persona.
   */
  readonly identity?: {
    readonly name: string;
    readonly age: number;
    readonly occupation: string;
  };
  /**
   * true = 本块**替换**掉通用的「人格画像」段 (而不是追加在后面).
   *
   * 什么时候必须替换: 咨询师配置了本场会话的来访者 (主诉/背景/难度都跟内置 persona 不同),
   * 两个画像同时出现会让模型无所适从.
   */
  readonly replacesPersona?: boolean;
}

/**
 * 上下文解析请求.
 */
export interface VisitorContextRequest {
  /** 会话 id (voice WS 的 path 里的 sid) */
  readonly sessionId: string;
  /** 当前用户 id (JWT) */
  readonly userId: string;
  /** 租户 id */
  readonly tenantId: string;
}

/**
 * 上下文贡献者 (业务侧实现).
 *
 * 实现方只需回答两个问题: "这个 session 我管吗?" + "我能提供什么?".
 */
export interface VisitorContextContributor {
  /** 贡献者标识 (日志用) */
  readonly name: string;
  /** 优先级 (小的先渲染 —— 身份类要排在行为规则类前面) */
  readonly priority: number;
  /** 是否管这个 session (返回 false = 不产出) */
  supports(request: VisitorContextRequest): boolean;
  /** 产出上下文块; 返回 null = 本次无内容 */
  build(request: VisitorContextRequest): Promise<VisitorContextBlock | null>;
}

/**
 * 来访者上下文注册表 (@Global).
 *
 * 业务模块在自己的 provider 里调 `register()` 把贡献者挂进来 (通常在 onModuleInit).
 */
@Injectable()
export class VisitorContextRegistry {
  private readonly contributors = new Map<string, VisitorContextContributor>();

  /**
   * 注册 1 个贡献者 (同 name 覆盖, 便于测试时热替换).
   *
   * @param contributor 贡献者
   */
  register(contributor: VisitorContextContributor): void {
    this.contributors.set(contributor.name, contributor);
  }

  /**
   * 注销 1 个贡献者.
   *
   * @param name 贡献者名
   */
  unregister(name: string): void {
    this.contributors.delete(name);
  }

  /**
   * 解析某 session 的全部上下文块 (按 priority 升序).
   *
   * **单个贡献者出错不影响其他贡献者** —— 一个业务侧上下文查不到数据, 不该让整个
   * AI 来访者会话挂掉 (降级成"没有额外上下文"即可).
   *
   * @param request 解析请求
   */
  async resolve(request: VisitorContextRequest): Promise<VisitorContextBlock[]> {
    // V2026-10-21 治本 (V1.2 VS-B2 — 排序用 toSorted 而非 sort):
    //   原因: ESLint unicorn/no-array-sort 要求用不可变版本 —— sort() 会**原地改**传入数组,
    //     而这里传的是刚从 Map.values() 展开的新数组, 原地改虽然无害, 但语义上不清晰.
    //   修法: 改用 toSorted() (ES2023, Node 20+ 内置) → 显式表达"排序产生新数组".
    const sorted = [...this.contributors.values()].toSorted((a, b) => a.priority - b.priority);
    const blocks: VisitorContextBlock[] = [];
    for (const contributor of sorted) {
      try {
        if (!contributor.supports(request)) {
          continue;
        }
        const block = await contributor.build(request);
        if (block && block.content.length > 0) {
          blocks.push(block);
        }
      } catch {
        // 降级: 单个贡献者失败 → 跳过, 不影响其余
        continue;
      }
    }
    return blocks;
  }
}
