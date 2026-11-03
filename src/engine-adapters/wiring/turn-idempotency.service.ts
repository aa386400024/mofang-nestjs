// V2026-11-02 治本 (WP16 · B 层 · 轮次幂等表):
//   职责: 维护「会话 id → 轮次号 → 本轮结果快照」的内存表, 供 turn 入口做幂等判定.
//   边界: 纯内存 / 零 IO / 零依赖 / 零 @nestjs; 只记"这一轮产出过什么",
//         记不记、怎么判, 由调用方 (对话后端适配器) 决定.
//
//   为什么要有这张表 (任务单 §0):
//     内核的 turn 是**先落状态、再渲染** —— BDI 快照在渲染之前就提交了.
//     所以"流式渲染中途断了"留下的不是"没跑过的这一轮", 而是
//     「**状态已经走了、话没说完**」的半轮. 用户重发同一轮时若再跑一遍 BDI,
//     阻抗 / 情绪 / 信任会二次跳变 —— 状态漂移.
//     这张表就是那道闸门: 同一会话同一 round_id 再来一次, 不重跑 BDI.
//
//   为什么是**内存态** (任务单 §2.1.4):
//     Phase1 单实例部署, 进程重启后旧 WS 连接本来也断了 —— 幂等键跟着断, 语义自洽.
//     分布式幂等键 / 三阶段事务是 Phase2 的活 (任务单 §5 明确不做).
//
//   为什么记「在跑」而不只是「跑完」 (并发重试):
//     客户端超时重发时, 服务端那一轮**可能还在跑**. 若表里只记"跑完",
//     并发重发就会让同一个 round_id 跑两遍 BDI —— 恰好是本单要消灭的那件事.
//     所以每轮先登记为 pending, 跑完再落成 done; 并发重发等前一轮落定后复用它的结果.
//
//   生命周期: openSession 重置 (重连 = 新会话 = 新状态) → 每轮登记 → closeSession 清空.
//
//   反双胞胎:
//     - 不把幂等表塞进内核 (src/engine-core): 内核零 IO / 零编排, 幂等是**编排层**的职责.
//     - 不在表里存 BDI 快照本体: 状态已经在内核里落定了, 再存一份只会多出第二份真相
//       (而两份状态迟早对不上). 这里只记"这轮产出过什么" —— 够重放, 不会漂移.
//     - 不做跨进程 / 跨会话的幂等键: Phase1 单实例 (任务单 §5).
//     - 不用 TTL / LRU 淘汰: 会话关闭即清 (closeSession), 场次长度由业务定 ——
//       引入淘汰策略就得回答"淘汰后重试怎么办", 而那正是本单要消灭的歧义.

/**
 * 一轮用量的快照 (重放时原样回给前端).
 *
 * 为什么连用量一起存: 重放若回不出用量, 前端拿到的 `llm_done.usage` 会是空的 ——
 * 端上验收要看"这轮思考 token 吃了多少", 空值等于"这一轮没花钱", 是假账.
 */
export interface TurnUsageSnapshot {
  /** 输入 token (流式路径通常缺省 → 落 0 = 不可得, 不是"没花钱"). */
  readonly promptTokens: number;
  /** 输出 token (含思考). */
  readonly completionTokens: number;
  /** 总 token. */
  readonly totalTokens: number;
  /** 思考 token (推理模型专用; 缺省 = 上游没报). */
  readonly reasoningTokens?: number;
}

/**
 * 一轮的结果快照 (幂等表里存的东西).
 */
export interface TurnResultSnapshot {
  /**
   * 本轮回复是否**完整**下发.
   *
   * `false` = 断流: 状态已提交但回复只发了一半 —— 重发时**不能重放**这一轮.
   */
  readonly complete: boolean;
  /**
   * 本轮回复正文.
   *
   * `complete=true` 时是全量 (重放就回它); `complete=false` 时是**已发出的部分**
   * (任务单 §2.2.2: 缓存里存 `{ complete: false, reply: partialText }`).
   */
  readonly reply: string;
  /** 本轮用量 (重放时原样回给前端). */
  readonly usage: TurnUsageSnapshot;
  /**
   * 上游结束原因 (重放时原样回给前端).
   *
   * V2026-11-03 治本 (WP26 · P2-34): `length` 意味着正文被上游按长度砍断 ——
   *   丢了它, 客户端分不清"模型说完了"与"模型被截断了".
   *   为什么连它一起存: 重放若回不出这个字段, 客户端在**重试那一轮**看到的就是
   *   "正常结束", 而首轮其实是被截断的 —— 同一个 round_id 两次结论不一致, 比缺字段更糟.
   *   缺省 = 上游没给 (老 provider / 非 OpenAI 兼容上游).
   */
  readonly finishReason?: string;
  /**
   * 本轮咨询师输入 (仅诊断用).
   *
   * 为什么存: 客户端拿**同一个 round_id** 换了别的话来重发时, 后端要能一眼看出
   * "这不是同一轮" —— 幂等键是 round_id, 但文本对不上时至少该留一条 warn.
   */
  readonly userText: string;
}

/**
 * 轮次条目: 在跑 / 已落定.
 *
 * 为什么要区分这两种状态: 并发重发 (客户端超时重发, 服务端那轮还在跑) 必须
 * **等**前一轮落定后复用它的结果, 而不是各跑一遍 BDI.
 */
export type TurnEntry =
  | { readonly status: 'pending'; readonly settled: Promise<TurnResultSnapshot> }
  | { readonly status: 'done'; readonly snapshot: TurnResultSnapshot };

/**
 * 登记一个在跑的轮次后拿到的句柄.
 */
export interface TurnSettleHandle {
  /**
   * 落定这一轮 (写进表里, 并唤醒等着它的那一方).
   *
   * **只能生效一次**: 重复调用以第一次为准 (落定是事实, 不是状态机).
   */
  settle(snapshot: TurnResultSnapshot): void;
  /** 这一轮落定后的结果 (并发重发方等的就是它). */
  readonly settled: Promise<TurnResultSnapshot>;
}

/**
 * 轮次幂等表 (进程内, 内存态).
 *
 * 为什么是**普通类**而不是 Nest provider: 它零依赖、零 IO, 生命周期与持有它的
 * 对话后端适配器**完全一致** —— 拿它当 provider 只会多一层装配, 换不来任何东西.
 */
export class TurnIdempotencyService {
  /** 会话 id → (轮次号 → 条目). */
  private readonly rounds = new Map<string, Map<number, TurnEntry>>();

  /**
   * 查一个轮次.
   *
   * @param sessionId 会话 id
   * @param roundId 轮次号
   * @returns 条目; undefined = 这个轮次还没开始过 (调用方正常跑这一轮)
   */
  lookup(sessionId: string, roundId: number): TurnEntry | undefined {
    return this.rounds.get(sessionId)?.get(roundId);
  }

  /**
   * 登记一个**在跑**的轮次.
   *
   * 必须**同步**登记: 若等到引擎真的开跑再登记, 两个并发重发会同时看到"没有这一轮",
   * 于是各跑一遍 —— 那正是本单要消灭的事.
   *
   * @param sessionId 会话 id
   * @param roundId 轮次号
   * @returns 落定句柄 (调用方在本轮结束时调 settle)
   */
  begin(sessionId: string, roundId: number): TurnSettleHandle {
    let resolveSettled: ((snapshot: TurnResultSnapshot) => void) | undefined;
    const settled = new Promise<TurnResultSnapshot>((resolve) => {
      resolveSettled = resolve;
    });
    const sessionRounds = this.rounds.get(sessionId) ?? new Map<number, TurnEntry>();
    sessionRounds.set(roundId, { status: 'pending', settled });
    this.rounds.set(sessionId, sessionRounds);

    let done = false;
    return {
      settled,
      settle: (snapshot: TurnResultSnapshot): void => {
        // 落定只生效一次: 后到的落定 (例如引擎迟到) 不许覆盖先到的那个事实.
        if (done) return;
        done = true;
        sessionRounds.set(roundId, { status: 'done', snapshot });
        resolveSettled?.(snapshot);
      },
    };
  }

  /**
   * 清掉一个会话的**整个**轮次表 (防内存泄漏).
   *
   * @param sessionId 会话 id
   */
  clearSession(sessionId: string): void {
    this.rounds.delete(sessionId);
  }

  /**
   * 某会话已登记的轮次数 (观测 / 测试用).
   *
   * @param sessionId 会话 id
   * @returns 轮次数
   */
  roundCount(sessionId: string): number {
    return this.rounds.get(sessionId)?.size ?? 0;
  }

  /**
   * 当前登记的会话数 (观测 / 测试用).
   *
   * @returns 会话数
   */
  sessionCount(): number {
    return this.rounds.size;
  }
}
