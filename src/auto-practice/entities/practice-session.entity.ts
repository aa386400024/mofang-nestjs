// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练 — 对练场次表):
//   原因: 批量跑 30+ 场 AI 对 AI 之后, 要有一张表记录"跑了哪几场 / 谁和谁聊 /
//     跑了几轮 / 为什么结束 / 花了多少钱", 才能给 WP-E 自动评测和 WP-B 可复现性
//     提供数据底座. 逐字稿本身落在 debug-session 的 JSON 文件里 (复用现有管道),
//     这张表只存"场次元数据 + 退出原因", 不存对话原文 (隐私红线).
//
//   表结构 (16 列 + 3 索引):
//     id / debug_session_id / character_slug / counselor_mode_id / status /
//     max_turns / turn_count / crisis_ended / exit_reason / batch_id /
//     model_version / seed_value / total_cost / error_message /
//     started_at / finished_at + created_at / updated_at
//
//   反双胞胎:
//     - **不存对话原文**: 逐字稿在 debug-session JSON 文件里 (data/debug-sessions/),
//       这张表只存元数据. WP-E 评测时通过 debug_session_id 去读那个文件.
//     - **model_version / seed_value 是 WP-B 预留字段**: 本期只写不读 (写入模型名
//       和种子), 可复现性逻辑归 WP-B. 现在留字段 = 将来 WP-B 不用 ALTER TABLE.
//     - **不加 DB FK**: debug_session_id 是进程内 id (不是 DB 主键), character_slug
//       指向 character_profiles (应用层校验), 都不加物理外键 (ADR-0003).
//     - **不做软删**: 场次是审计数据, 删了等于让批量统计凭空少一场.
//
//   V2026-11-09 治本 (Phase2.5 WP-F · Step 0 · 补 token / 成本列):
//     成本看板要合并"正式训练 + 自动对练"两个数据源, 但自动对练**没有留痕 JSON 列**
//     (正式训练从 `turn_debug_trace[].llmUsage` 算) —— 不落库, 看板这边永远是 0.
//     于是 runner 结算时把 token / 成本 / 成本口径写进本表:
//       prompt_tokens / completion_tokens / reasoning_tokens / total_tokens
//       total_cost_cny (元) / cost_basis (full | output_only)
//     ⚠️ 成本**直接算人民币元** (同一张定价表 + 同一个 `estimateSessionCost()`),
//        不搞美元字段、不搞汇率 (WP-F 任务单 §6 硬约束).
//     ⚠️ 旧列 `total_cost` (声明"美元") 保留但**不再读写** —— 迁移已把它的 DB 注释
//        标成"已废弃"; 权威字段是 `total_cost_cny`.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'ap_practice_sessions';
//     2. DESCRIBE ap_practice_sessions;
//     3. 跑一场单场对练 → 表里多一行 status=completed
//
//   V2026-11-10 治本 (Phase2.5 WP-J P1b — 危机后置练习窗指标落库):
//     P1a 把「危机披露后继续练应对」写进了引擎, 但指标只活在内存里 ——
//       run() 返回了 metrics, updateSessionResult() 却只写旧的 crisis_ended,
//       跑完几十场自动对练, "危机窗后有没有真练到 / 练了几轮 / 峰值多高 / 有没有升级"
//       这几个核心质量指标**全丢了**, 没法回答「危机应对协议到底有没有用」.
//     本次补 6 列 (纯数字 / 枚举, 不含任何台词):
//       crisis_practiced / crisis_first_turn / crisis_post_turns /
//       crisis_peak_level / crisis_category / crisis_escalated
//     ⚠️ 老行这 6 列 = 默认值 (0 / NULL), 语义是"**没这数据**" (P1a 上线前跑的场次),
//        **不是**"当时没危机" —— 历史不可反推, 不回填.
//     ⚠️ crisis_ended (旧列) **保留不动**: 它与 crisis_practiced 是两个独立信号,
//        四种组合都合法 (见 crisis_ended 列注释里的对照表).
//     ⚠️ 本表的 crisis_peak_level 是**规则自动判**的档位; quality_annotation 表里
//        同名列是**人工标**的 —— 两者只做对照, 不要 join.
//
//   V2026-11-10 治本 (Phase2.5 WP-H 第二波 · 改动 5 / 改动 6 — 渲染降级率指标列):
//     第一波把 LLM 拉回来了, 但"这批数据能不能用"还是看不出来 —— 库里没有任何字段
//     能区分"LLM 挂了"和"内容质量差". 本次补 5 列:
//       counselor_degraded_turns / visitor_degraded_turns  ← 拆双计数器 (每轮最多 +1)
//       render_fallback_turns / llm_call_turns              ← 渲染降级 vs 真实调用
//       render_fallback_ratio                                ← 兜底率 (DECIMAL(5,4) NULL)
//     旧列 degraded_turns **保留不动**, 写入时取 max(counselor, visitor) 维持旧语义可读性.
//     历史场次**不可反推** (迁移注释已写死): 四个 INT 列 = 0 表示"没测过", 不是"没问题";
//     ratio 留 NULL 表示"未知" —— 不许当成 0, 那等于替历史数据编了个结论.
//
//   时间戳: 2026-11-08

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 对练场次状态机.
 *
 * running → completed (跑满 maxTurns)
 *         → crisis_ended (来访者触发危机, 提前停)
 *         → stagnant (来访者连续 3 轮答非所问 / 重复, 提前停)
 *         → failed (LLM 报错 / 引擎报错)
 *         → canceled (手动取消)
 */
export type PracticeSessionStatus = 'running' | 'completed' | 'crisis_ended' | 'stagnant' | 'failed' | 'canceled';

/**
 * ap_practice_sessions 表 —— 自动对练场次元数据.
 *
 * 一场 = 一个 AI 咨询师 × 一个 AI 来访者, 自动聊若干轮. 逐字稿在 debug-session
 * 的 JSON 文件里; 这张表只回答"这场是谁跟谁 / 跑了多久 / 为什么停 / 花了多少".
 */
@Entity('ap_practice_sessions')
// 批量进度查询主路径: 按 batch_id 列一场批量跑了多少场.
@Index('idx_ap_sessions_batch', ['batchId'])
// 按状态筛 (admin 面板看"跑了几场失败的").
@Index('idx_ap_sessions_status', ['status'])
// 按角色 + 模式查 (WP-E 评测时按 character_slug 聚合).
@Index('idx_ap_sessions_character_mode', ['characterSlug', 'counselorModeId'])
export class PracticeSession {
  /** 场次 id (nanoid, 对外契约). */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  /**
   * 关联的 debug-session id (逐字稿在 data/debug-sessions/{debugSessionId}.json).
   *
   * 为什么不直接存逐字稿: 复用现有 debug-session 管道 (create/runTurn/close),
   * 它已经把每轮 trace + messages 落 JSON 文件了. 这里只存个指针.
   */
  @Column({ type: 'varchar', length: 128, name: 'debug_session_id' })
  debugSessionId!: string;

  /** 来访者角色 slug (对应 character_profiles / 内置角色种子). */
  @Column({ type: 'varchar', length: 128, name: 'character_slug' })
  characterSlug!: string;

  /** 咨询师模式 id (ap_counselor_modes.id). */
  @Column({ type: 'varchar', length: 64, name: 'counselor_mode_id' })
  counselorModeId!: string;

  /** 场次状态 (见 PracticeSessionStatus). */
  @Column({ type: 'varchar', length: 32, default: 'running' })
  status!: PracticeSessionStatus;

  /** 本场最大轮数 (到了就正常结束). */
  @Column({ type: 'int', default: 15, name: 'max_turns' })
  maxTurns!: number;

  /** 实际跑了几轮. */
  @Column({ type: 'int', default: 0, name: 'turn_count' })
  turnCount!: number;

  /**
   * 是否因危机**终止** (旧列, 保留不动).
   *
   * ⚠️ **与 `crisisPracticed` 是两个独立信号**, 四种组合都合法:
   *   · `c_ended=0 c_practiced=0` —— 没危机;
   *   · `c_ended=0 c_practiced=1` —— 进了危机后置练习窗, 正常收尾 (**理想情况**);
   *   · `c_ended=1 c_practiced=1` —— 进了窗, 但强度二次升级仍终止 (协议没救回来);
   *   · `c_ended=1 c_practiced=0` —— **P1a 之前的老数据**: 直接因危机掉线, 从没进过窗.
   *   ⇒ 写 `WHERE crisis_ended=1 AND crisis_practiced=0` 时**别把老数据当成新 bug**.
   */
  @Column({ type: 'tinyint', default: 0, name: 'crisis_ended' })
  crisisEnded!: number;

  /**
   * 是否进过**危机后置练习窗** (WP-J P1b).
   *
   * 语义 = "危机披露之后, 还继续跟来访者练过应对". 与 `crisisEnded` 独立,
   * 四种组合见上一列的注释.
   *
   * ⚠️ **老行的 0 不等于"没练过危机"** —— 只等于"P1a 上线前跑的场次, 当时没有这个数据".
   *   历史场次**不可反推**, 不回填 (见迁移 `1714900000042` 文件头).
   *
   * ⚠️ **用 number (0/1) 而不是 boolean**: mysql 驱动的 tinyint 读回来就是数字,
   *   本表既有的 `crisis_ended` / `ap_counselor_modes.enabled` 都是同一口径,
   *   写成 boolean 会让类型撒谎 (JSON 里是 0/1, 类型却说 true/false).
   */
  @Column({ type: 'tinyint', default: 0, name: 'crisis_practiced' })
  crisisPracticed!: number;

  /**
   * 危机**首次披露**的轮次 (NULL = 本场没披露过危机).
   *
   * 从 1 起 (与逐字稿轮次同口径).
   */
  @Column({ type: 'int', nullable: true, name: 'crisis_first_turn' })
  crisisFirstTurn!: number | null;

  /**
   * 危机窗内**实际完成**的练习轮数 (披露之后又聊了多少轮).
   *
   * 0 = 披露后一轮都没练 (要么当场升级终止, 要么这场压根没危机).
   */
  @Column({ type: 'int', default: 0, name: 'crisis_post_turns' })
  crisisPostTurns!: number;

  /**
   * 危机**强度峰值**档位 0~3 (规则自动判定; 见 `CRISIS_LEVEL_BY_CATEGORY`).
   *
   * ⚠️ **与 `quality_annotation.crisis_peak_level` 不是一回事**:
   *   · 本列 = **规则自动判**的危机档 (自动对练场次的引擎结论);
   *   · `quality_annotation.crisis_peak_level` = **人工标**的危机档 (WP-J P2 校准用).
   *   两张表都有这一列, 语义相反 —— **只做对照, 不要 join** (join 会把"人工标"和
   *   "规则判"混成同一个真相). 对照的正确姿势: 人工档 vs 自动档, 算一致率.
   */
  @Column({ type: 'int', default: 0, name: 'crisis_peak_level' })
  crisisPeakLevel!: number;

  /**
   * 危机类别 (内核 `VisitorRiskCategory` 枚举值, **非自由文本**; 没披露过 → NULL).
   *
   * 只落枚举字符串, **不落任何台词** (隐私红线 AGENTS.md §5.4).
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'crisis_category' })
  crisisCategory!: string | null;

  /**
   * 是否发生"**强度上升**"型二次升级 (WP-J P1b).
   *
   * 同等或更低强度的"又说了一次"**不算**升级 —— 那正是需要练的稳定化过程.
   */
  @Column({ type: 'tinyint', default: 0, name: 'crisis_escalated' })
  crisisEscalated!: number;

  /**
   * 退出原因 (与 status 对应, 便于统计):
   * max_turns / crisis / stagnant / error / manual.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'exit_reason' })
  exitReason!: string | null;

  /**
   * 批量批次 id (一场批量跑共享同一个 batchId; 单场实时跑为 null).
   *
   * 批量接口入队 N 个 job 时生成一个 batchId, 所有 job 写同一个 batchId,
   * 前端按它轮询进度 ("这批跑完了吗").
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'batch_id' })
  batchId!: string | null;

  /**
   * WP-B 预留: 本场用的 LLM 模型名 (可复现性).
   *
   * 本期只写不读 —— 跑的时候把 model 名记下来, WP-B 做可复现性时按它筛选.
   */
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'model_version' })
  modelVersion!: string | null;

  /**
   * WP-B 预留: 本场用的随机种子 (可复现性).
   *
   * 本期只写不读 —— 引擎会话开的时候 character resolver 给了 seed, 记下来.
   */
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'seed_value' })
  seedValue!: string | null;

  /**
   * WP-B: 角色 semver 版本号 (如 "1.0.0").
   *
   * 会话创建时从 CharacterVersionRegistry 读实时值, 不缓存 —— 版本号记错 = 溯源失效.
   */
  @Column({ type: 'varchar', length: 32, nullable: true, name: 'character_version' })
  characterVersion!: string | null;

  /**
   * WP-B: 本场审议模式 (rule_only / shadow / llm_active).
   *
   * 考核场景恒为 rule_only (硬隔离), 与全局开关无关.
   */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'deliberation_mode' })
  deliberationMode!: string | null;

  /**
   * WP-B: 后端代码版本 (git sha 或 build id).
   *
   * 用于定位"哪版代码跑出来的数据", 出问题时能快速回溯.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'engine_version' })
  engineVersion!: string | null;

  /**
   * prompt 模板版本 (V2026-11-10 · WP-B): 关键 prompt 模板文件的 sha256 前 16 位.
   *
   * 与 `engineVersion` 的分工: engineVersion 答"哪份代码", 这个答
   * "**prompt 文案**是不是同一版" —— 批次对比时后者才是要看的那个数.
   *
   * NULL = 算不出 / 老场次没记 (= 不知道, 不是"和上一批一样").
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'prompt_version' })
  promptVersion!: string | null;

  /**
   * 本场 LLM 总成本 (**已废弃** —— 历史列, 声明"美元"但全仓零写入点, 恒 NULL).
   *
   * V2026-11-09 (Phase2.5 WP-F): 成本口径改为**人民币元**, 权威字段是 `total_cost_cny`.
   *   本列保留 (不 DROP, 避免不可逆的 schema 变更), 但**不再读写** ——
   *   留着一条"美元"语义的死列, 迟早有人再拿它算一遍钱.
   *   迁移 `1714900000037` 已把本列的 DB 注释改成"已废弃", 别再拿它算成本.
   */
  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, name: 'total_cost' })
  totalCost!: number | null;

  /**
   * 本场 LLM 输入 token 合计 (引擎侧; 咨询师侧用量不可得, 见 WP-F 交付记录 §偏差).
   *
   * V2026-11-09 (Phase2.5 WP-F · Step 0): runner 结算时按轮累加 `trace.llmUsage`.
   *   落库理由: 成本看板要合并两个数据源, 而自动对练**没有留痕 JSON 列** ——
   *   token 与成本不落库, 看板就只能显示"自动对练成本恒 0".
   */
  @Column({ type: 'int', default: 0, name: 'prompt_tokens' })
  promptTokens!: number;

  /** 本场 LLM 输出 token 合计 (思考 token 已含在内, 不重复计入 totalTokens). */
  @Column({ type: 'int', default: 0, name: 'completion_tokens' })
  completionTokens!: number;

  /** 本场思考 token 合计 (已含在输出侧里, 单列只为可追溯). */
  @Column({ type: 'int', default: 0, name: 'reasoning_tokens' })
  reasoningTokens!: number;

  /** 本场 token 总量 (输入 + 输出; 与正式训练 totalTokens 同口径). */
  @Column({ type: 'int', default: 0, name: 'total_tokens' })
  totalTokens!: number;

  /**
   * 本场 LLM 总成本 (**人民币元**) —— 跑时定价快照.
   *
   * 口径: 用 WP24 的 `estimateSessionCost()` + 同一张定价表算出来 (元 / 千 token),
   *   **不搞美元字段, 不搞汇率** (WP-F 任务单 §6 硬约束).
   *   定价快照 = 这场跑的时候单价是多少就算多少 —— 事后调 env 不会改写历史行.
   *   (与正式训练"读时按当前 env 重算"的口径差异登记在交付记录 §偏差.)
   *
   * ⚠️ DECIMAL 在 mysql2 驱动下取回来是**字符串** —— 读的时候记得 `Number(...)`.
   */
  @Column({ type: 'decimal', precision: 12, scale: 6, nullable: true, name: 'total_cost_cny' })
  totalCostCny!: number | null;

  /**
   * 成本口径 (`full` = 输入输出都计 / `output_only` = 只含输出侧, 是下界).
   *
   * null = 没有口径记录 (WP-F 之前跑的历史场次) —— 看板把这种行标成 `estimated`.
   */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'cost_basis' })
  costBasis!: string | null;

  /**
   * 咨询师侧降级轮数 (V2026-11-09 P1-3).
   *
   * 上游 429 / 超时 / 空回复时, counselor-agent 回 FALLBACK_REPLY ("嗯，我在听").
   * 这种轮次不是真咨询师说的话, 之前场次仍标 completed, 评测时混在真数据里.
   * 这里累计降级轮数; 退出时若降级比 ≥ 50%, exitReason 加 _heavy_degraded 后缀.
   */
  @Column({ type: 'int', default: 0, name: 'degraded_turns' })
  degradedTurns!: number;

  /**
   * 咨询师侧降级轮数 (V2026-11-10 · WP-H 改动 5).
   *
   * 为什么要拆: 旧列 `degraded_turns` 一个计数同时装"咨询师侧"和"来访者侧",
   *   每轮最多 +2, 而重活率判定拿它除以**轮数** —— 分子是事件数、分母是轮数,
   *   两个口径混用, 实测 67.8% 的场次 `degraded_turns > turn_count` (数学上不可能).
   *
   * 口径: 咨询师这一侧每一轮**最多 +1** (这一轮是不是回了一句兜底话).
   */
  @Column({ type: 'int', default: 0, name: 'counselor_degraded_turns' })
  counselorDegradedTurns!: number;

  /**
   * 来访者侧降级轮数 (V2026-11-10 · WP-H 改动 5).
   *
   * 口径: 来访者这一侧每一轮**最多 +1** (这一轮是不是走了渲染兜底话术池).
   */
  @Column({ type: 'int', default: 0, name: 'visitor_degraded_turns' })
  visitorDegradedTurns!: number;

  /**
   * 本场渲染兜底轮数 (V2026-11-10 · WP-H 改动 6) —— 来访者侧走兜底的总次数.
   *
   * 这是"LLM 挂了"与"内容质量差"的**唯一可分界线**: 以前所有字段都分不开这两件事,
   *   数据一直在流, 没人拦 —— 三批无效数据就是这么静默流进分析的.
   */
  @Column({ type: 'int', default: 0, name: 'render_fallback_turns' })
  renderFallbackTurns!: number;

  /**
   * 本场真实调用 LLM 的轮数 (V2026-11-10 · WP-H 改动 6) —— 来访者侧成功发起的调用次数.
   *
   * 与 `renderFallbackTurns` 互斥: 每一轮要么真调了, 要么走了兜底.
   */
  @Column({ type: 'int', default: 0, name: 'llm_call_turns' })
  llmCallTurns!: number;

  /**
   * 渲染兜底率 (V2026-11-10 · WP-H 改动 6) = `render_fallback_turns / turn_count`.
   *
   * ⚠️ DECIMAL 在 mysql2 驱动下取回来是**字符串** —— 读的时候记得 `Number(...)`.
   *
   * NULL = 没记录 (WP-H 之前跑的历史场次, 兜底率不可反推) —— 看板按"未知"处理,
   *   **不许**当成 0 (那等于替历史数据编了一个"当时没问题"的结论).
   */
  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true, name: 'render_fallback_ratio' })
  renderFallbackRatio!: number | null;

  /** 失败时的错误信息 (status=failed 时有值). */
  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage!: string | null;

  /** 开始时刻. */
  @Column({ type: 'datetime', name: 'started_at' })
  startedAt!: Date;

  /** 结束时刻 (running 时为 null). */
  @Column({ type: 'datetime', nullable: true, name: 'finished_at' })
  finishedAt!: Date | null;

  /** 创建时刻. */
  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  /** 更新时刻. */
  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
