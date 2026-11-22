// V2026-11-05 治本 (WP64 · B 层 · LLM 审议层 PoC · 影子模式):
//   职责: 跑一次 LLM 审议 —— 组装 WP63 的三个 prompt 零件 → 调
//         `CounselorLlmJsonClient.requestJson()` → 算 delta 差异 → 写 Redis trace 表.
//         结果**不写进状态** (影子模式 = 只观察, 不生效).
//   边界: B 层 (src/engine-adapters/), 触网络 / 触 Redis —— **不在** src/engine-core/ 内.
//         内核一行未改: 影子模式**不进内核管道** (任务单 §4.1 —— 进管道 = 改 turn 方法 = 破红线).
//
//   V2026-11-05 治本 (WP65 · 影子模式 BullMQ 队列化):
//     本文件**降级为执行器** —— `runShadowMode()` 改名 `executeShadowMode()`, 语义不变
//     (跑 LLM + 写 trace), 但**只由 BullMQ Worker 调用**.
//     编排门面那一侧改由 `DeliberationProcessor` 实现同一个端口 (`runShadowMode` = 入队).
//     门面完全感知不到内部从"直接调"改成了"入队" —— 端口签名一个字没动.
//
//   为什么这一层在适配层:
//     审议层带 prompt / 模型 / 网络, 内核是纯层 (零 @nestjs / 零网络 / 零 prompt).
//     北极星 (hybrid-bdi-agent-blueprint-v1.0.md §2.2) 也写明「审议服务在适配层」.
//
//   影子模式的**三条硬纪律** (任务单 §1.3 / §4.2):
//     ① 结果**不生效** —— 审议 delta 只进 trace 表, 绝不回写 BDI 快照;
//     ② **旁路** —— 调用方不 await, 主流程响应时间不受审议影响 (WP65 起: 入队即返回);
//     ③ **只抛一种异常** —— 值得重试的失败抛 `DeliberationRetryableError` (WP66 起),
//        其余异常照旧在本层 catch 住, 影子模式挂了不能炸主流程.
//
//   V2026-11-05 治本 (WP66 · 审议输出格式校验与重试):
//     智能重试 —— 区分错误类型, **值得重试的才抛**给 BullMQ:
//       · 值得重试: 模型输出形状不对 (json_not_found / json_parse_failed /
//         schema_validation_failed / parse_error) + 上游限流与 5xx (http_429 / http_5xx);
//       · 不值得重试: 鉴权 4xx / 网络与超时 (fetch_error) / no_body / 代码 bug ——
//         重试大概率同样失败, 白烧一次 LLM.
//     ⚠️ **先写 trace, 再抛** —— 失败记录不能丢, PoC 统计要用.
//     ⚠️ 抛异常的语句**不在 try 块里** —— 否则会被自己的 catch 吞掉, 重试永远不发生
//       (所以"跑"与"判"拆成了两个方法, 见 `runDeliberation`).
//
//   V2026-11-05 治本 (WP67 · 审议熔断与降级策略):
//     本层**不知道熔断器的存在** —— 熔断状态 (failureCount / openedAt) 全在
//     `DeliberationProcessor` 里. 本层只多做两件事:
//       ① `executeShadowMode` **返回结局** —— 熔断器要靠它判断"这轮成没成"
//         (之前非重试类失败被吞掉, 调用方分不清成功与失败, 熔断会形同虚设);
//       ② `recordCircuitOpen()` —— 熔断时由 processor 调它写一条 `circuit_open` 的 trace
//         (trace 的格式与 key 设计仍归本层一家, 队列层不自己写 trace).
//
//   反双胞胎:
//     - **不自己拼 "systemPrompt + schemaDescription"** —— `CounselorLlmJsonClient`
//       已经把 schemaDescription 拼到 system prompt 尾部 (llm-json.client.ts:115).
//       本服务只出三个零件, 拼装由 client 独家负责 (WP63 交付记录 §2.4 同一治本).
//     - **不自己解析 JSON** —— 结构化输出只有一条链: `CounselorLlmJsonClient`
//       (仓库硬约束 6). 本服务只提供一个 `validate` 回调.
//     - **不自己写 LLM 请求** —— 复用 counselor 域唯一的结构化出口, 不引第二套 client.
//     - **不用 `config.get<number>()` 读数值** —— ConfigService 不做类型转换, 拿到的是
//       **字符串** ('3000'), 一路传到 `AbortSignal.timeout()` 会抛 (仓库 WP9-B 已踩过).
//       本文件自己解析 + 回退默认值.
//     - **不给审议结果开"第二次写状态"的口子** —— trace 表是 append-only 的观察面,
//       没有回写 BDI 的通道 (切灰度是 Phase3A 的事).
//     - **不把审议原文 (reason / summary) 打进日志** —— 心理内容禁止进普通日志
//       (隐私红线 AGENTS.md §5.4). 日志只出 id / 计数 / 错误码.
//     - **不自己读 env 开关** —— 开关判定收敛到 `resolveDeliberationEnabled()` 一个纯函数,
//       入队前 (processor) 与执行时 (本服务) 共用同一份真相, 杜绝两处口径漂移.
//
//   ⚠️ 硬安全维度 (自杀倾向 / 自伤风险 / 危机等级) **永远只走规则**, 不跑 LLM 审议:
//     WP63 的 `DELIBERATION_DIMS` 只列了 11 个软状态维度; 模型若硬塞一个硬安全维度,
//     校验层会把它判为**非法条目**并丢进 `rejectedEntries` —— 证据留在 trace 表里
//     (PoC 验收: "高安全维度零误触发" 就能一眼查), 但**不会**进入 delta 建议.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp64-deliberation-shadow.spec.ts 覆盖开关 / 成功 / 格式非法 /
//        超时 / 差异计算 / 异常不炸主流程 / 键设计 / TTL
//     3. test/engine-adapters/wp65-deliberation-queue.spec.ts 覆盖入队 / Worker 配置 / 队列生命周期
//     4. `git diff --stat HEAD -- src/engine-core` 为空 (本期不动内核)
//
//   V2026-11-05 治本 (WP68 · 意图锁定机制 · PoC 组最后一单):
//     **意图锁定** —— "当前核心意图在 N 轮内不随意切换" (蓝图 §2.3).
//     影子期一直在比"软状态 delta", 但**意图层面**还没比过 ——
//     "LLM 会不会乱改意图"这个问题, 没有 `intentionShift` 就**答不出来**.
//     本单做三件事:
//       ① 审议输出加**可选**的 `intentionShift` (建议切到哪个策略 + 理由);
//       ② 旁路**模拟**意图锁定: 锁定 N 轮, 期间忽略 LLM 的切换建议;
//       ③ trace 里记下三方对比 (规则算子选的 / LLM 建议的 / 锁定后实际生效的).
//
//     ⚠️ **本层为什么也管锁定** (任务单原本写的是 processor 层):
//       trace 是**本层**写的 (WP65 起的纪律: 队列层不自己写 trace) ——
//       锁定判定结果要进 trace, 就必须在写 trace 之前算好.
//       放 processor 的话, processor 拿到结局时 trace 早已写完, 只能二次改写 Redis
//       (读-改-写, 有竞态窗口, 每轮多两次往返). 已与大炮确认走本层 (方案 A).
//
//     ⚠️ 影子模式下锁定**不改变任何主流程行为**:
//       审议结果从不写回内核 —— 主流程永远走规则算子选的意图.
//       `lockedStrategy` 是**推演值** ("如果真用 LLM 审议会用哪个"), 只进 trace 供 PoC 分析.
//
//   如何验证 (WP68):
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp68-deliberation-intention-lock.spec.ts 覆盖锁定五情况 /
//        intentionShift 校验 / 配置 / 边界
//
//   V2026-11-07 治本 (过期判定与丢弃 · 切灰度前置安全网):
//     **审议跑完后, load 一次当前快照的 revision, 对比 baseRevision** ——
//     不一致 = 快照变了 = 这份审议结果过期了 (它是在旧快照上算出来的).
//
//     为什么要现在做 (切灰度前置):
//         审议是**异步**的 (BullMQ 队列跑), 等它跑完的时候, 快照可能已经被
//         规则算子更新过好几轮了. 这时候把旧快照的 delta apply 到新快照上 ——
//         状态就错乱了. 所以切灰度前必须先有"过期判定"这个安全网.
//
//     ⚠️ **锚 R1, 不是 R0** (口径别搞混):
//         R1 = 本轮**落库后**的版本 (= 内核 `EngineTurnOutput.revision`, 门面透传成
//         入参 `baseRevision`); 本轮**开始时**的那份 (baseSnapshot) 是 R0 = R1 - 1.
//         锚 R1 是因为判定问的是"**回来时的当前版本 == 本字段吗**": 审议在本轮落库
//         **之后**才入队, 回来时当前版本必然 >= R1 —— 锚 R0 会让判定**永远**为"过期".
//
//     ⚠️ **保守兜底** (宁可误判没过期, 不误杀):
//         load 失败 (Redis 挂) / 会话不存在 → `currentRevision: null` + `stale: false`.
//         为什么保守: 影子期只是观测 —— 误判过期会让你以为"很多审议都过期了",
//         把切灰度决策带偏; 误判没过期只是少记几条, 不影响大局.
//
//     ⚠️ **DI 用 token, 不用接口当 token** (本单实测踩到的坑):
//         `BdiStateRepository` 是**接口** —— 编译后没有运行时值, 当不了 Nest 的
//         provider token. 直接写 `private readonly bdiStates: BdiStateRepository`
//         会让 Nest 按 `design:paramtypes` 去找名为 `Object` 的 provider ——
//         找不到, 就**静默注入 undefined** (症状: 判定永远走兜底分支, 过期率恒为 0,
//         且**不报错**). 必须 `@Inject(ENGINE_BDI_STATE_REPOSITORY)` ——
//         同一个 token, 同一个**单例**仓储实例 (与内核读写的是同一份真相).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp-deliberation-stale-check.spec.ts 覆盖判定口径 /
//        保守兜底 / trace 形状 / 跨轮次过期
//     3. `git diff --stat HEAD -- src/engine-core` 为空 (本单不动内核)
//
//   V2026-11-07 治本 (cap 配置统一 · 审议侧与规则算子同口径 · 切灰度前置):
//     审议侧的逐维 delta cap 从**硬编码**内核种子值, 改成与规则算子**同一份**
//     `resolveDeltaCapConfig(config)` 的结果.
//
//     为什么现在做 (切灰度前置):
//         规则算子的 cap 边界可以从 env (`ENGINE_CAP_*`) 覆写, 审议侧却一直用种子值 ——
//         两边口径不一致. 影子期无害 (砍幅只进 trace, 不写状态), 但切灰度后审议结果与
//         规则结果会用**不同的 cap 标准**, deltaDiff 的口径就歪了.
//
//     ⚠️ **config 参数是可选的** (缺省 = 内核种子值):
//         现有单测大量直接调 `applyDeliberationDeltaCap(deltas)` —— 保持可选, 它们零改动,
//         行为逐字不变. 且内核 `resolveBounds` 对缺项 / 非法值**逐项**回退种子值,
//         所以传一份 config 进去是安全的 (配错一个维度不会连累别的维度).
//
//     ⚠️ **两侧都在启动期求值** (不做热更新, 任务单 §八 5):
//         规则侧在 `ENGINE_SESSION_PORT` 的 useFactory 里求值一次, 审议侧在本构造函数里
//         求值一次 (本服务是单例) —— 运维中途改 env, **两侧都不变**, 口径始终一致.
//         真要热更新是切灰度时的事, 那时再单独做.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp-deliberation-cap-config.spec.ts 覆盖"传 config 按 config 砍" /
//        "不传 config 与种子值逐字一致" / "env 覆写后审议侧跟着变"
//     3. `git diff --stat HEAD -- src/engine-core` 为空 (本单不动内核)

//
//   V2026-11-07 治本 (临床合理性校验 · 观测版 · 切灰度前置):
//     三条规则把"可疑"的轮次**标记**出来记进 trace —— **不拦截、不砍幅**.
//
//     为什么现在做 (切灰度前置):
//         蓝图 §2.3 的"临床合理性校验"是切灰度前最后一块. 但那是一类**需要临床数字**
//         的规则 —— 我们没有临床顾问, 不能自己发明. 所以本期只做**观测版**:
//         阈值是**工程种子值** (明确标注"非临床标定"), 影子期把可疑轮次挑出来,
//         供督导复盘校准; 等数据跑够了, 再把确认的规则从"观测"切换到"拦截".
//
//     ⚠️ **两道各司其职, 不互相替代**:
//         · delta cap = **硬边界** (超了就是这一轮不该动这么多, 砍到边界并记账);
//         · 临床校验 = **软观测** (标记可疑, 但**不改变**审议结果).
//         所以临床校验放在 cap **之后** —— 它审计的是"进 trace 的那个数"(砍后的值),
//         与 deliberationDelta / deltaDiff 同口径.
//
//     ⚠️ **阈值是工程种子值, 不是临床数字** (仓库纪律: 不发明临床数字):
//         三条阈值都在 CLINICAL_SANITY_THRESHOLDS 里, 注释写明了"非临床标定".
//
//     ⚠️ **开关缺省关** (ENGINE_CLINICAL_SANITY_ENABLED):
//         影子期默认不跑 (零开销); 要跑观测数据时运维显式打开.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp-deliberation-clinical-sanity.spec.ts 覆盖三条规则 /
//        边界 / 开关 / trace 形状 / "不拦截"
//     3. `git diff --stat HEAD -- src/engine-core` 为空 (本单不动内核)
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { isDeliberationRiskAcceptable } from './deliberation-input.js';
import { buildDeliberationSchemaDescription, buildDeliberationSystemPrompt, buildDeliberationUserPrompt } from './deliberation-prompt.js';
import { applyDeliberationStats } from './deliberation-stats.js';
import {
  DELIBERATION_DIMS,
  DELIBERATION_LLM_ONLY_TAGS,
  DELIBERATION_MAX_ABS_DELTA,
  DELIBERATION_RISK_SKIP_ERROR_CODE,
  DELIBERATION_RULE_ALIGNED_TAGS,
  isBehaviorStrategy,
  type DeliberationDeltaEntry,
  type DeliberationDim,
  type DeliberationInput,
  type DeliberationIntentionShift,
  type DeliberationMode,
  type DeliberationOperatorTag,
  type DeliberationOutput,
} from './deliberation-types.js';
import { CounselorLlmJsonClient } from '../../counselor/providers/llm-json.client.js';
import {
  DEFAULT_DELTA_CAP_CONFIG,
  capTurnDelta,
  type BehaviorStrategy,
  type BdiSnapshot,
  type BdiStateRepository,
  type DeltaCapConfig,
  type DeltaVector,
} from '../../engine-core/index.js';
import { RedisService } from '../../shared/infra/redis/redis.service.js';
import { resolveDeltaCapConfig } from '../wiring/delta-cap.config.js';
import { ENGINE_BDI_STATE_REPOSITORY } from '../wiring/engine.tokens.js';

/** Redis key 的逻辑前缀 (ioredis 还会自动拼 `REDIS_KEY_PREFIX`, 多环境隔离靠它). */
export const DELIBERATION_TRACE_KEY_PREFIX = 'deliberation_trace';

/**
 * trace 数据的存活时长 (秒) —— 30 天.
 *
 * 口径: 影子模式的数据量不大 (100 场 × 每轮一次 ≈ 几千条), 留一个月够 PoC 分析完.
 */
export const DEFAULT_DELIBERATION_TRACE_TTL_SECONDS = 2_592_000;

/** 审议请求的默认超时 (ms). */
export const DEFAULT_DELIBERATION_TIMEOUT_MS = 3000;

/**
 * 审议请求的默认温度.
 *
 * ⚠️ **M3.1-Flash 会忽略 temperature / top_p** (官方固定 1 / 0.95) —— 仓库硬约束 8.
 * 所以这个值只对**换掉的模型**生效 (例如运维把 `ENGINE_DELIBERATION_MODEL` 指到别的模型).
 * 保留这个键是因为: 换模型时不必再改代码, 且不配就沿用上游默认值.
 */
export const DEFAULT_DELIBERATION_TEMPERATURE = 0.3;

/**
 * 审议输出的生成长度上限.
 *
 * ⚠️ 任务单写 512, **这里给 2048** —— 见交付记录 §2.5 (偏差 D7):
 *   MiniMax-M3.1-Flash 是推理模型, **thinking token 计入生成长度上限** (仓库硬约束 8).
 *   引擎渲染侧的既有做法是 1500 (思考 ~700-1000 + 输出 ~500-800, 见 turn-render-orchestrator.ts
 *   的 DEFAULT_TURN_TOKEN_BUDGET 注释). 审议输出本身约 200-300 token, 但思考要先吃预算 ——
 *   给 512 的话, 思考吃掉一两百 token 后正文就被截断, JSON 半截 → `json_not_found` /
 *   `json_parse_failed` 连续失败 (影子模式直接白跑). 2048 是"思考 + 正文都留足"的档.
 */
export const DELIBERATION_MAX_COMPLETION_TOKENS = 2048;

/** 数值保留的小数位 (避免浮点噪声进 JSON). */
const DELIBERATION_VALUE_PRECISION = 6;

/** 扁平理由字段的长度上限 (逐条明细在 `entries` 里, 这里只是给人看的摘要). */
const DELIBERATION_FLAT_REASON_MAX_CHARS = 500;

/**
 * 影子审议的入参.
 *
 * 为什么是"输入"而不是"服务自己去取": 审议服务在适配层, 但**只有编排门面**
 * 同时握有本轮的前后状态与内核判定 —— 让门面把这些**结构化**好传进来,
 * 审议服务就保持"纯消费 + 纯产出", 不必自己去翻会话.
 *
 * ⚠️ **V2026-11-08 治本 (Phase2.5 WP-A · 审议输入最小化)**: 入参**不再装对话原文**.
 *   改造前这里有 counselorText / visitorText / characterBrief / baseSnapshot 四个字段,
 *   前两个是**逐字原文** —— 它们被原样拼进 prompt 发给第三方模型 (合规问题 R6),
 *   而且 BullMQ 的 job payload 里也躺着它们 (job 要随队列冻结到 Redis).
 *   现在只剩 `structured` (结构化输入) + `ruleDelta` (对比基准):
 *     · **零原文** —— 审议层物理上拿不到对话, 也就没有东西可泄漏;
 *     · **零快照副本** —— 状态以"前后对比"的形式进 prompt, 不再整份塞进去.
 */
export interface DeliberationShadowInput {
  /** 业务会话 id (租户内唯一). */
  readonly sessionId: string;
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 发起这次审议的用户 id (计费 + 审计; 引擎会话的学员账号). */
  readonly userId: string;
  /** 本轮序号 (内核累计轮次, 从 1 起). */
  readonly turnIndex: number;
  /**
   * 本轮审议对应的 BDI 快照版本号 (WP65) —— 即**本轮落库后**的版本 (R1).
   *
   * 为什么必填 (不设可选):
   *     这是切灰度时做"过期判定"的唯一依据 —— 忘传 = 那个键恒为 undefined,
   *     判定恒走"过期"分支 → 审议结果全被丢弃 → 机制静默失效.
   *     必填 = 编译器逼着每个构造点想一遍 (仓库纪律: 契约要显式).
   *
   * 口径 (⚠️ 与"本轮开始时"差一版, 别搞混):
   *     R1 = 本轮**落库后**的版本; 本轮开始时的那份 (baseSnapshot) 是 R0 = R1 - 1.
   *     锚 R1 是因为过期判定是"回来时的当前版本 == 本字段": 审议在本轮落库**之后**
   *     才入队, 回来时当前版本必然 >= R1 —— 锚 R0 会让判定永远为"过期".
   *
   * 兜底: 内核没填 revision 时 (老版本 / 测试 mock) 门面传 0 —— 真实版本都 >= 1,
   *     0 会被判定为过期 (安全的失败方向).
   */
  readonly baseRevision: number;
  /** 当前会话模式 (考核 / 自由练习) —— 决定用哪套 prompt 模板. */
  readonly mode: DeliberationMode;
  /**
   * 本轮审议的**结构化输入** (Phase2.5 WP-A) —— 审议 prompt 的**唯一**数据源.
   *
   * 内容: 本轮事件分类 / BDI 状态逐维前后对比 / 角色基线 / 风险等级 / 规则策略.
   * ⚠️ **零对话原文** —— 事件是标签、状态是数字、角色基线是角色种子的元数据.
   *
   * ⚠️ `ruleStrategy` (本轮规则算子选中的行为策略) 也在这里 ——
   *   它是 prompt 的一个区块 (WP68 意图锁定要模型知道"现在在做什么"),
   *   放顶层会出现"两份真相"的风险 (改一处忘了另一处).
   */
  readonly structured: DeliberationInput;
  /** 规则算子算出的最终 delta (用来跟审议 delta 对比). */
  readonly ruleDelta: DeltaVector;
}

/**
 * 影子审议的**窄端口** (编排门面只依赖这一个动作).
 *
 * 为什么要端口而不是直接依赖实现类:
 *   门面 (`TurnRenderOrchestrator`) 是**纯类** (零 @nestjs), 单测里 new 出来就能跑.
 *   直接依赖 Nest service 会把框架拖进门面, 也让"装配缺席"变成"门面起不来".
 *   窄端口 + 缺省缺席 = 纯增强 (装配缺席时只是没有影子审议, 会话照常).
 *
 * ⚠️ V2026-11-05 (WP65): **实现方换了, 签名一个字没动**.
 *   实现是 `DeliberationProcessor` (同目录) —— 它把审议请求**入队**, 由 BullMQ Worker
 *   异步跑 LLM. 门面拿到的是"入队就返回"的语义, 与 WP64 的"直接跑"对门面**完全透明**.
 *   这个接口继续声明在本文件 (而不是 processor 里): 门面只认这一个 import 路径,
 *   换了实现不该连门面与它的端口定义一起搬走.
 */
export interface DeliberationShadowPort {
  /**
   * 影子模式跑一次审议 (不生效, 只记录对比数据).
   *
   * fire-and-forget: 调用方**不需要** await, 不影响主流程响应时间.
   * 内部捕获所有异常, **不抛** —— 影子模式挂了不能炸主流程.
   */
  runShadowMode(input: DeliberationShadowInput): Promise<void>;
}

/**
 * 生效路径的审议入参 (R9).
 *
 * ⚠️ **与影子入参同形状** (直接别名, 不复制第二份契约):
 *   两条路径需要的上下文**逐字相同** —— 归属 / 轮次 / 版本号 / 结构化输入 / 规则 delta.
 *   复制一份类型 = 两份真相 (改了一份忘了另一份 = 生效路径少传一个字段,
 *   而且**不报错**, 只是审议质量变差).
 *
 * ⚠️ **WP-A 之后"快照是哪一份"不再是入参歧义**:
 *   改造前两条路径传的快照不同 (影子传 R0 = 本轮开始时; 生效传 R1 = 本轮落库后),
 *   注释要花整段提醒"别搞混". 现在统一由 `structured.stateComparison` 表达
 *   **本轮前 → 本轮后**, 两条路径逐字相同 —— 歧义从契约里消失了.
 *
 *   过期判定仍然锚 `baseRevision` (= R1, 本轮落库后的版本), 见 `checkStale` 的说明.
 */
export type DeliberationEffectiveInput = DeliberationShadowInput;

/**
 * 剔掉**临床可疑**的维度 (R9 · 生效路径专用).
 *
 * ⚠️ **为什么影子期不做这件事**:
 *   影子期的临床校验是**观察** —— 只标记, 不改 delta (那期要的是数据, 不是拦截).
 *   生效期不一样: 一条被判定为"可疑"的改动**落进状态**就撤不回来了 (状态轨迹不可回滚),
 *   所以保守方向是**不落** —— 该维度这一轮保持规则算子的值.
 *
 * ⚠️ **只剔 `warn` 级别的维度**: `info` 级 (阻抗集体上升) 是"值得看一眼"而不是
 *   "可疑到不能落" —— 一并剔掉会让生效路径几乎什么都不做.
 *
 * ⚠️ **整维度剔, 不是整份建议剔**: 一条建议里通常有几维, 只把可疑的那几维剔掉,
 *   其余维度照常生效 (全剔 = 一条可疑建议把整轮审议废掉, 灰度就白灰了).
 *
 * @param deltas 砍幅后的 delta 列表
 * @param clinicalFlags 临床合理性标记
 * @returns 剔掉可疑维度后的列表 (没有可疑维度时**原样返回**)
 */
export function dropClinicalFlaggedDimensions(
  deltas: readonly DeliberationDeltaEntry[],
  clinicalFlags: readonly ClinicalFlag[],
): readonly DeliberationDeltaEntry[] {
  const flagged = new Set(clinicalFlags.filter((flag) => flag.severity === 'warn').map((flag) => flag.dimension));
  if (flagged.size === 0) return deltas;
  return deltas.filter((delta) => !flagged.has(delta.dimension));
}

/**
 * 生效路径的结局 (R9).
 *
 * ⚠️ **不抛** —— 三种结局都如实返回, 由调用方决定"回退规则 delta".
 *   与 `DeliberationOutcome` 的区别: 这里只给**生效用的 delta 列表`,
 *   不回传 `validated` / `usage` —— 观察面 (trace) 已经写过了, 生效面只要能落状态的数.
 */
export type DeliberationEffectiveOutcome =
  | {
      readonly kind: 'ok';
      /** 生效用的 delta 列表 (已过 cap, 临床可疑维度已剔除). */
      readonly deltas: readonly DeliberationDeltaEntry[];
    }
  | { readonly kind: 'failed'; readonly errorCode: string | null }
  | { readonly kind: 'exception' };

/**
 * 影子审议开关的**唯一判定口径** (`ENGINE_DELIBERATION_ENABLED`).
 *
 * ⚠️ 为什么是导出给两处用的纯函数 (WP65):
 *   开关在**两个时间点**各判一次, 理由不同:
 *     · 入队前 (processor) —— 关着就**不入队**, 白占队列也不白等上游;
 *     · 执行时 (service) —— 排队期间运维把开关关了 → 队列里的旧 job 要**跳过**,
 *       不该在开关已关的情况下照样烧 LLM (仓库硬约束 12: 异步任务的偏好在执行时读).
 *   两处各写一份判定 = 两份真相, 迟早漂移 (一处认 'on' 一处不认) → 收口到这里.
 *
 * 缺省 = **关** (影子模式每轮多烧一次 LLM, 不配就零成本).
 *
 * @param raw env 原值 (未 trim / 未归一)
 * @returns true = 开
 */
export function resolveDeliberationEnabled(raw: string | undefined): boolean {
  return parseBooleanEnv(raw);
}

/**
 * 布尔型 env 的**唯一**解析口径 (缺省 = 关).
 *
 * ⚠️ **为什么抽成独立函数** (V2026-11-07 · 临床合理性校验):
 *   影子模式总开关 (`ENGINE_DELIBERATION_ENABLED`) 与临床合理性观测开关
 *   (`ENGINE_CLINICAL_SANITY_ENABLED`) 是**两个不同的键**, 但接受的字面量
 *   必须**同一套** (true / 1 / yes / on) —— 两处各写一份解析, 迟早漂移 (一处认 `on`
 *   一处不认). 仓库纪律: **判定只有一份**.
 *
 * @param raw env 原值 (未 trim / 未归一)
 * @returns true = 开
 */
export function parseBooleanEnv(raw: string | undefined): boolean {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized.length === 0) return false;
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * 值得重试的错误码 (WP66) —— **模型抽风类 + 瞬时上游类**.
 *
 * ⚠️ 这份清单按**真实错误码词表**列, 不是按任务单的示意表:
 *   `CounselorLlmJsonClient` 实际能吐出的码只有这些:
 *     · client 自身: `json_not_found` / `json_parse_failed` / `schema_validation_failed`
 *     · 上游 chunk 透传: `http_401` / `http_429` / `http_500`… / `no_body` / `parse_error` / `fetch_error`
 *   任务单表里的 `timeout` **根本不存在** (超时落到 catch-all 的 `fetch_error`),
 *   `llm_error` 也从不作为 errorCode 产生 (client 直接透传 `chunk.error.code`).
 *
 * 口径 (与大炮确认):
 *   · **形状类** —— 模型输出的形状不对, 换一次采样可能就好了 → 重试;
 *   · **限流 / 5xx** —— 瞬时上游故障, 退避后大概率恢复 → 重试;
 *   · 其余 (鉴权 4xx / 网络与超时 `fetch_error` / `no_body` / 代码 bug) → **不重试**
 *     (重试大概率同样失败, 白烧一次 LLM).
 *
 * 与仓库既有口径一致: `src/counselor/providers/supervision-failure.ts` 的
 * `mapLlmErrorCodeToFailureCode` 也是把 429 / 5xx / JSON+schema 归为"可重试",
 * 把鉴权与素材类归为"永久性".
 */
export const DELIBERATION_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  // 形状类 (模型没按契约吐 JSON / 形状不对 / SSE 解析失败)
  'json_not_found',
  'json_parse_failed',
  'schema_validation_failed',
  'parse_error',
  // 限流 (上游配额被打满 —— 正是 WP65 的并发闸门要压的那个)
  'http_429',
]);

/**
 * 5xx 上游错误的码前缀 (`http_500` / `http_502` / `http_503` …).
 *
 * 为什么用前缀而不是只列 `http_500`: 上游的 5xx 不止一种, 逐个列永远列不全;
 * 而 4xx (除 429) 是**请求本身有问题**, 重试无意义 —— 所以按"5 开头"一刀切.
 */
const DELIBERATION_RETRYABLE_5XX_PREFIX = 'http_5';

/**
 * 这个错误码值得重试吗 (纯函数, 可单测).
 *
 * 做成**类型守卫**: 判定为 true 时, 调用方手里的 `string | null` 会被收窄成 `string`,
 * 后面构造 `DeliberationRetryableError(errorCode, …)` 不用再补一次空值判断.
 *
 * @param errorCode LLM client 的 errorCode (可空)
 * @returns true = 值得重试 (换一次采样 / 退避后大概率能成)
 */
export function isRetryableDeliberationError(errorCode: string | null | undefined): errorCode is string {
  const code = (errorCode ?? '').trim().toLowerCase();
  if (code.length === 0) return false;
  if (DELIBERATION_RETRYABLE_ERROR_CODES.has(code)) return true;
  return code.startsWith(DELIBERATION_RETRYABLE_5XX_PREFIX);
}

/**
 * 值得重试的审议失败 —— 抛这个异常让 BullMQ 自动重试.
 *
 * ⚠️ 只在"**写完 trace 之后**"抛 —— 失败记录不能丢, PoC 统计要用.
 * ⚠️ 只抛这一种异常: 其它异常 (代码 bug / 上游永久失败) 照旧被 service 吃掉 ——
 *   影子模式挂了不能炸主流程, 更不该让队列反复重试同一件没救的事.
 */
export class DeliberationRetryableError extends Error {
  constructor(
    /** 触发重试的错误码 (与 trace 里的 errorCode 一致). */
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeliberationRetryableError';
  }
}

/**
 * 一次审议的结局 (结构化, 不抛).
 *
 * 为什么要"结构化"而不是靠抛异常表达: 三种结局里只有一种值得往上传
 * (可重试的失败), 另外两种都要在**同一次调用**里被吃掉.
 * 用返回值表达 → **抛异常的语句永远在 try 之外**, 不会被自己写的 catch 吞掉
 * (那是 WP66 最容易踩的坑: 抛在 try 里 → catch 吞掉 → 重试永远不发生).
 *
 * ⚠️ V2026-11-05 (WP67): 加了 `skipped` —— "开关关着, 这一轮**没跑**审议".
 *   它跟 `failed` 是两回事: failed 是"跑了但没成" (烧了钱), skipped 是"根本没跑"
 *   (没烧钱). 熔断器必须区分: skipped **不动**熔断状态.
 */
export type DeliberationOutcome =
  | { readonly kind: 'ok'; readonly validated: ValidatedDeliberation; readonly usage: DeliberationTokenUsage | null }
  | { readonly kind: 'failed'; readonly errorCode: string | null; readonly usage: DeliberationTokenUsage | null }
  | { readonly kind: 'exception' }
  | { readonly kind: 'skipped' };

/**
 * "熔断中, 这一轮没跑审议"的 trace 错误码 (WP67).
 *
 * ⚠️ 用它把"根本没跑"与"跑了但失败"在 PoC 统计里分开:
 *   `circuit_open` = 熔断器拦下了 (省钱, 有意为之); 其余 `ok=false` = 真跑了没成.
 */
export const DELIBERATION_CIRCUIT_OPEN_ERROR_CODE = 'circuit_open';

// ── WP68 · 意图锁定机制 ─────────────────────────────────────────────

/**
 * 意图锁定轮数的默认值 (WP68) —— **3 轮**.
 *
 * ⚠️ 这是**工程种子值, 不是临床数字** (蓝图 §3.3: "意图锁定粒度 → 做成可配置参数,
 *   不同角色类型不同; PoC 阶段做基础版, 后期调参"). PoC 跑完按督导反馈校准.
 *
 * 口径: 选定一个意图后**锁定 3 轮**, 期间 LLM 的切换建议被忽略;
 *   第 4 轮开始允许切换, 一旦切换就**重新锁定 3 轮**.
 */
export const DEFAULT_DELIBERATION_INTENTION_LOCK_ROUNDS = 3;

/**
 * 意图锁定状态的 Redis key 前缀 (WP68).
 *
 * ⚠️ 与熔断 key **同构** (带租户 + 会话长度前缀), 只是前缀不同 ——
 *   两个是不同的东西: 熔断是"**要不要跑**"的控制状态, 锁定是"**跑完怎么算**"的观察状态.
 */
export const DELIBERATION_INTENTION_LOCK_KEY_PREFIX = 'deliberation_intention_lock';

/**
 * 意图锁定状态的 TTL (秒) —— 24 小时 (WP68 D6).
 *
 * 口径: 锁定按**轮次**算, 但 Redis key 总得有个 TTL —— 不然会话结束了 key 还留着占内存.
 *   24 小时足够跑完一场会话; 每次更新都**刷新** TTL (活跃会话永不过期, 不活跃的自动清掉).
 */
export const DELIBERATION_INTENTION_LOCK_TTL_SECONDS = 86_400;

/**
 * 意图锁定状态 (Redis 里存的东西).
 *
 * ⚠️ 为什么存**两个**策略 (`ruleStrategy` + `effectiveStrategy`):
 *   · `ruleStrategy` —— **规则算子**选的那个 (内核的真实意图);
 *   · `effectiveStrategy` —— **锁定后实际生效**的那个 (可能是 LLM 建议的).
 *   影子模式下内核不会真的采纳 LLM 的建议, 所以这两个值**本来就会分叉** ——
 *   不分开存, 就分不清"内核换了意图"与"LLM 建议被采纳"这两件事.
 */
export interface IntentionLockState {
  /** 上一轮**规则算子**选的行为策略 (内核意图). */
  readonly ruleStrategy: BehaviorStrategy;
  /** 锁定后**实际生效**的行为策略 (影子模式下是"假设 LLM 审议生效"的推演值). */
  readonly effectiveStrategy: BehaviorStrategy;
  /** 锁定到第几轮 (**不含**本轮) —— 轮次 >= 它就不再锁定. */
  readonly lockedUntilRound: number;
  /** 状态最后一次更新时的轮次 (观测用). */
  readonly roundIndex: number;
}

/**
 * 意图锁定判定的结果.
 */
export interface IntentionLockResult {
  /**
   * 锁定后**实际生效**的行为策略.
   *
   * ⚠️ 影子模式下它是**推演值**: "如果真用 LLM 审议, 这一轮会用哪个策略".
   *   主流程实际用的仍然是规则算子那个 —— 审议结果从不生效 (WP64 起的纪律).
   */
  readonly effectiveStrategy: BehaviorStrategy;
  /**
   * LLM 的切换建议有没有被**采纳**.
   *
   * 口径: true = 采纳了 (且不在锁定期内); false = 被锁定期拦下, 或者**压根没有建议**.
   *   PoC 统计"锁定期内被拦住多少"用 `llmIntentionShift !== null && !llmIntentionAccepted`.
   */
  readonly llmSuggestionAccepted: boolean;
  /** 算完之后的锁定状态 (下一轮从它接着算). */
  readonly newState: IntentionLockState;
}

/**
 * 构造意图锁定状态的 Redis key (与熔断 key 同构, 带租户 + 会话长度前缀).
 *
 * @param tenantId 租户隔离键
 * @param sessionId 业务会话 id
 * @returns 意图锁定状态的 key
 */
export function buildDeliberationIntentionLockKey(tenantId: string, sessionId: string): string {
  return `${DELIBERATION_INTENTION_LOCK_KEY_PREFIX}:${tenantId.length}:${tenantId}:${sessionId.length}:${sessionId}`;
}

/**
 * 意图锁定判定 (纯函数, 可单测) —— WP68 的核心.
 *
 * 口径 (任务单 §4.3 的五个情况, 但**情况 2 的触发条件改了**, 见下):
 *   1. 还没锁过 (第一次审议) → 用规则算子的策略, 开始锁定;
 *   2. **规则算子选的策略变了** → 内核真的换意图了, 重新锁定 (内核的切换优先于 LLM 的建议);
 *   3. 还在锁定期内 → **忽略** LLM 建议, 有效策略保持不变;
 *   4. 锁定期过了 + LLM 有建议 → **采纳**, 重新锁定 3 轮;
 *   5. 锁定期过了 + LLM 没建议 → 继续用当前有效策略 (不重新上锁).
 *
 * ⚠️ **情况 2 的触发条件为什么不是任务单写的那样**:
 *   任务单的代码是 `state.currentStrategy !== currentStrategy`, 而它自己的注释写的是
 *   "**规则算子**选的策略变了" —— 两者对不上, 因为情况 4 把 `currentStrategy` 写成了
 *   **LLM 建议的**策略. 照抄的话, 影子模式下会出现一个假象:
 *   LLM 的建议被采纳一次之后, 下一轮 `state.currentStrategy`(=LLM 建议) 必然
 *   ≠ `currentStrategy`(=规则策略) → **每轮都走情况 2**, 锁被反复重新上锁、永不过期,
 *   于是"锁定机制拦住率"被这个假象**撑爆**, PoC 结论直接失真.
 *   所以这里把状态拆成 `ruleStrategy` / `effectiveStrategy` 两个字段:
 *   情况 2 只在**内核真的换了意图**时触发.
 *
 * ⚠️ 情况 3 / 5 返回的是 `state.effectiveStrategy` 而不是 `currentStrategy`:
 *   LLM 建议被采纳后, 它要在**锁定期内保持** (不然"锁定"就白锁了).
 *
 * @param state 当前锁定状态 (null = 没锁过)
 * @param currentStrategy 本轮规则算子选的行为策略
 * @param llmSuggestion LLM 建议的切换 (null = 不建议切换)
 * @param lockRounds 锁定轮数 (0 = 不锁)
 * @param roundIndex 当前轮次
 * @returns 锁定后的结果: 实际生效的策略 + LLM 建议有没有被采纳 + 新的锁定状态
 */
export function resolveIntentionLock(
  state: IntentionLockState | null,
  currentStrategy: BehaviorStrategy,
  llmSuggestion: DeliberationIntentionShift | null,
  lockRounds: number,
  roundIndex: number,
): IntentionLockResult {
  // 情况 1: 还没锁过 —— 用规则算子的策略, 开始锁定 (第一轮不采纳 LLM 的建议).
  if (!state) {
    return {
      effectiveStrategy: currentStrategy,
      llmSuggestionAccepted: false,
      newState: {
        ruleStrategy: currentStrategy,
        effectiveStrategy: currentStrategy,
        lockedUntilRound: roundIndex + lockRounds,
        roundIndex,
      },
    };
  }

  // 情况 2: 规则算子选的策略变了 —— 内核真的换意图了, 重新锁定 (内核优先).
  if (state.ruleStrategy !== currentStrategy) {
    return {
      effectiveStrategy: currentStrategy,
      llmSuggestionAccepted: false,
      newState: {
        ruleStrategy: currentStrategy,
        effectiveStrategy: currentStrategy,
        lockedUntilRound: roundIndex + lockRounds,
        roundIndex,
      },
    };
  }

  // 情况 3: 还在锁定期内 —— 忽略 LLM 建议, 有效策略保持不变.
  if (roundIndex < state.lockedUntilRound) {
    return {
      effectiveStrategy: state.effectiveStrategy,
      llmSuggestionAccepted: false,
      newState: { ...state, roundIndex },
    };
  }

  // 情况 4: 锁定期过了 + LLM 有建议 —— 采纳, 重新锁定.
  if (llmSuggestion) {
    return {
      effectiveStrategy: llmSuggestion.targetStrategy,
      llmSuggestionAccepted: true,
      newState: {
        ruleStrategy: currentStrategy,
        effectiveStrategy: llmSuggestion.targetStrategy,
        lockedUntilRound: roundIndex + lockRounds,
        roundIndex,
      },
    };
  }

  // 情况 5: 锁定期过了 + LLM 没建议 —— 继续用当前有效策略 (不重新上锁).
  return {
    effectiveStrategy: state.effectiveStrategy,
    llmSuggestionAccepted: false,
    newState: { ...state, roundIndex },
  };
}

/** 审议产出的 token 用量. */
export interface DeliberationTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** trace 表里单条 delta 的**明细** (逐维可复核). */
export interface DeliberationTraceEntry {
  readonly dimension: DeliberationDim;
  readonly delta: number;
  readonly operatorTags: readonly DeliberationOperatorTag[];
  readonly reason: string;
}

/**
 * 过期判定的结果 (V2026-11-07 · 切灰度前置安全网).
 *
 * 口径: 审议**跑完后** load 一次当前快照的 revision, 对比入参里的 baseRevision.
 *   · currentRevision === baseRevision → 没过期 (中间没跑别的轮次);
 *   · currentRevision >  baseRevision → 过期了 (中间又跑了几轮, 审议基于旧快照);
 *   · currentRevision <  baseRevision → **不可能** (防御性当作没过期).
 *
 * ⚠️ **保守兜底**: load 失败 / 会话不存在 → `{ stale: false, currentRevision: null }`.
 *   宁可误判没过期 (少记几条), 也不误判过期 (把切灰度决策带偏).
 */
export interface DeliberationStaleCheck {
  /** 审议结果是不是已经过期 (基于旧快照算出来的). */
  readonly stale: boolean;
  /** 审议回来时读到的当前快照 revision; null = 没读到 (兜底). */
  readonly currentRevision: number | null;
}

/**
 * 一条审议 trace (Redis value 的形状).
 *
 * ⚠️ 这份记录**含心理内容** (LLM 写的 reason / summary) —— 它是**数据**, 不是日志:
 *   只落 Redis, 不进普通日志 / crash report / 网络日志 (隐私红线 AGENTS.md §5.4).
 *
 * 失败时 (ok=false): `errorCode` 有值, `deliberationDelta` / `entries` 为空,
 * `tokenUsage` 可能仍带 (上游报了用量但 JSON 不合法时).
 */
export interface DeliberationTraceRecord {
  /** 租户隔离键 (与 key 里的那段一致, 便于按值反查归属). */
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnIndex: number;
  /**
   * 本次审议对应的 BDI 快照版本号 (WP65) —— 从入参原样带下来.
   *
   * 口径 (⚠️ 是 **R1 = 本轮落库后**的版本, 不是 R0):
   *     R1 = 本轮**落库后**的版本 (= 内核 `EngineTurnOutput.revision`);
   *     本轮**开始时**的那份 (baseSnapshot) 是 R0 = R1 - 1.
   *     锚 R1 是因为过期判定问的是"**回来时的当前版本 == 本字段吗**":
   *     审议在本轮落库**之后**才入队, 回来时当前版本必然 >= R1 —— 锚 R0 会让判定**永远**为"过期".
   */
  readonly baseRevision: number;
  /**
   * 过期判定: 审议回来时, 快照是不是还在 baseRevision 那个版本.
   *
   * true = 中间又跑了几轮, 这份审议是在**旧快照**上算出来的 —— 切灰度后应该丢弃.
   * false = 没过期, **或者判定没做成** (保守兜底, 见 `currentRevision`).
   */
  readonly stale: boolean;
  /**
   * 审议回来时读到的当前快照 revision.
   *
   * null = load 失败 / 会话不存在 (保守兜底: 同时意味着 stale 恒为 false).
   */
  readonly currentRevision: number | null;
  /** 写入时刻 (ISO). */
  readonly timestamp: string;
  /** 审议是否成功 (格式合法 + API 不报错). */
  readonly ok: boolean;
  /** 失败原因码 (成功时为 null). */
  readonly errorCode: string | null;
  /**
   * 已经重试过几次 (**0 = 第一次跑就结束了**).
   *
   * ⚠️ 语义是"**已重试**次数", 不是"尝试次数" —— 从 BullMQ 的 `job.attemptsMade` 来.
   *   仓库既有口径 (`counselor-supervision.processor.ts` 注释): worker 回调里
   *   `attemptsMade` 是"已经尝试过几次", **首次执行时为 0** → 正好等于重试次数.
   *
   * 用途: 统计"有多少轮是靠重试救回来的" (PoC 指标).
   */
  readonly retryCount: number;
  /** 本次审议耗时 (ms). */
  readonly durationMs: number;
  /** 审议模式 (考核 / 自由练习). */
  readonly mode: DeliberationMode;
  /** token 用量 (上游没报时为 null). */
  readonly tokenUsage: DeliberationTokenUsage | null;
  /** 规则算子这一轮的实际 delta (逐维全量). */
  readonly ruleDelta: DeltaVector;
  /** 审议建议的 delta (**稀疏**: 只含模型明确提到的维度). */
  readonly deliberationDelta: Readonly<Partial<Record<DeliberationDim, number>>>;
  /** 逐维差异 (审议 - 规则; **全量 11 维**, 没提到的维度按 0 算). */
  readonly deltaDiff: Readonly<Record<DeliberationDim, number>>;
  /**
   * 约束校验层: 逐维 delta cap 砍幅明细.
   *
   * 只记**被砍的**维度 (raw !== capped) —— 没被砍的不出现
   *   (观测面要的是"哪里出过问题", 不是"哪里没问题"; 与内核 cap 报告同口径).
   *
   * ⚠️ `deliberationDelta` 里存的**已经是砍后**的值 ——
   *   切灰度后, 砍后的 delta 才是实际生效的那个.
   */
  readonly capEntries: readonly DeliberationCapEntry[];
  /**
   * 临床合理性标记 (观测版 —— **不拦截、不砍幅**).
   *
   * 空数组 = 没发现可疑 (或观测开关关着).
   *
   * ⚠️ 影子模式下这只是**观测**: 标记不改变审议结果, 也不写 BDI 快照.
   *   切灰度后再决定要不要把确认的规则从观测切换到拦截.
   */
  readonly clinicalFlags: readonly ClinicalFlag[];
  /** 本轮审议打出的操作标签全集 (去重, 按出现顺序). */
  readonly operatorTags: readonly DeliberationOperatorTag[];
  /** 逐条理由的合并文本 (多条用 '；' 连接; 逐条明细在 `entries` 里). */
  readonly reason: string | null;
  /** 整体置信度 [0,1]. */
  readonly confidence: number | null;
  /** 整体判断 (一句话中文). */
  readonly summary: string | null;
  /** 逐条 delta 明细 (人工复核用). */
  readonly entries: readonly DeliberationTraceEntry[];
  /** 被校验层丢掉的**原始**条目 (非法维度 / 非法标签 / 越界幅度等). */
  readonly rejectedEntries: readonly unknown[];
  /**
   * 本轮**规则算子**选中的行为策略 (内核意图) (WP68).
   *
   * PoC 用途: 与 `llmIntentionShift` 对比 —— "规则说 A，LLM 说 B".
   */
  readonly ruleStrategy: BehaviorStrategy;
  /**
   * LLM 建议的意图切换 (WP68) —— null = 不建议切换.
   *
   * ⚠️ 建议被**校验层丢掉**时也是 null (原始条目在 `rejectedEntries` 里) ——
   *   证据不丢, 但不让非法值参与锁定判定.
   */
  readonly llmIntentionShift: DeliberationIntentionShift | null;
  /**
   * 锁定后**实际生效**的行为策略 (WP68).
   *
   * ⚠️ 影子模式下这是**推演值** ("如果真用 LLM 审议会用哪个"), 主流程实际用的
   *   仍然是 `ruleStrategy` —— 审议结果从不生效.
   */
  readonly lockedStrategy: BehaviorStrategy;
  /**
   * LLM 的切换建议有没有被**采纳** (WP68).
   *
   * 口径: true = 采纳 (且不在锁定期内); false = 被锁定期拦下, 或者压根没有建议.
   */
  readonly llmIntentionAccepted: boolean;
}

/**
 * 校验通过后的审议产物 (外加被丢掉的条目).
 *
 * 为什么要把 `rejectedEntries` 带出来:
 *   模型偶尔会吐出非法维度 (最典型的是**硬安全维度** —— prompt 明令不许, 但模型未必听话).
 *   那些条目必须**留下证据** (PoC 验收: "高安全维度零误触发" 就是查这一项),
 *   静默丢掉 = 把"模型试图越界"这件事藏起来.
 */
export interface ValidatedDeliberation {
  /** 通过校验的 delta 列表. */
  readonly output: DeliberationOutput;
  /** 被丢掉的原始条目 (逐条保留, 便于事后审计). */
  readonly rejectedEntries: readonly unknown[];
}

/**
 * 构造 trace 表的 Redis key.
 *
 * 口径: **长度前缀复合键** (与 WP32 的 `RedisBdiStateRepository` 同一套纪律):
 *   `deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}`
 *
 * 为什么加长度前缀:
 *   直接用 ':' 拼的话, (租户="a:b", 会话="c") 与 (租户="a", 会话="b:c") 会**撞键** ——
 *   撞键的后果是**跨租户串数据** (静默的隐私事故). 同一套纪律 = 两个 Redis 实现
 *   对"什么算同一场会话"的判断**逐字一致**, 运维扫 key 的方式也一样.
 */
export function buildDeliberationTraceKey(tenantId: string, sessionId: string, turnIndex: number): string {
  return `${DELIBERATION_TRACE_KEY_PREFIX}:${tenantId.length}:${tenantId}:${sessionId.length}:${sessionId}:${turnIndex}`;
}

/**
 * 算规则算子这一轮的**实际** delta (逐维快照差).
 *
 * ⚠️ 口径说明 (交付记录 §2.3 · 偏差 D3):
 *   任务单要的是"规则算子算出的最终 delta (capped 后的)". 但**适配层拿不到**内核的
 *   `cappedTotal` —— 它是内核 `turn()` 内部的局部变量, 出口只有"本轮结束后的快照".
 *   内核零改动是本期红线, 所以这里只能用**快照差**反推:
 *     · 优点: 口径与"状态实际怎么动了"**完全一致**, 也正是审议 delta 该对齐的基准;
 *     · 代价: 快照落盘时会 clamp 到 [0,1] / 情绪区间 —— 贴着边界的那一轮,
 *             快照差会**小于**内核的 capped delta (差值 = 被 clamp 掉的部分).
 *   边界值附近的偏差对"差异均值 < 0.01"这个 PoC 指标的影响可忽略 (绝大多数轮次不在边界).
 *
 * @param base 本轮开始时的快照
 * @param next 本轮结束后的快照
 * @returns 逐维增量 (11 维全量)
 */
export function computeRuleDelta(base: BdiSnapshot, next: BdiSnapshot): DeltaVector {
  return {
    trust: round(next.trust - base.trust),
    safety: round(next.safety - base.safety),
    bond: round(next.bond - base.bond),
    valence: round(next.emotion.valence - base.emotion.valence),
    arousal: round(next.emotion.arousal - base.emotion.arousal),
    verbal: round(next.resistance.verbal - base.resistance.verbal),
    depth: round(next.resistance.depth - base.resistance.depth),
    style: round(next.resistance.style - base.resistance.style),
    positive: round(next.transference.positive - base.transference.positive),
    negative: round(next.transference.negative - base.transference.negative),
    dependency: round(next.transference.dependency - base.transference.dependency),
  };
}

/**
 * 逐维差异 = 审议 delta - 规则 delta (**全量 11 维**).
 *
 * 为什么是全量而不是"只算模型提到的维度":
 *   PoC 的验收指标是"软状态维度差异均值 < 0.01" —— 均值的**分母**必须是确定的维度集.
 *   只算模型提到的维度, 分母就变成"模型想说多少维", 均值会被人为抬高.
 *   全量 11 维 = 每轮的统计口径完全一致, 跨轮 / 跨会话可加.
 */
export function computeDeliberationDeltaDiff(
  ruleDelta: DeltaVector,
  deliberationDelta: Readonly<Partial<Record<DeliberationDim, number>>>,
): Readonly<Record<DeliberationDim, number>> {
  const diff = {} as Record<DeliberationDim, number>;
  for (const dim of DELIBERATION_DIMS) {
    diff[dim] = round((deliberationDelta[dim] ?? 0) - ruleDelta[dim]);
  }
  return diff;
}

/** 去掉 readonly 的映射类型 (只用于造本地可变副本). */
type MutableDeltaVector = { -readonly [K in keyof DeltaVector]: number };

/** 全零 delta 向量 (cap 探针用). */
const ZERO_DELTA_VECTOR: DeltaVector = {
  trust: 0,
  safety: 0,
  bond: 0,
  verbal: 0,
  depth: 0,
  style: 0,
  valence: 0,
  arousal: 0,
  positive: 0,
  negative: 0,
  dependency: 0,
};

/**
 * 单维被砍的明细 (约束校验层).
 *
 * ⚠️ 与内核的 `DeltaCapEntry` 形状相同但**类型更窄** (dimension 收成 `DeliberationDim`):
 *   内核那份的 dimension 是 `string` —— 审议层收窄后, 消费方拿到的 dimension
 *   一定是合法审议维度, 不用再判一遍.
 */
export interface DeliberationCapEntry {
  /** 维度名 (trust / safety / ...). */
  readonly dimension: DeliberationDim;
  /** 砍之前的原始 delta. */
  readonly raw: number;
  /** 砍之后实际生效的 delta. */
  readonly capped: number;
}

/**
 * 审议输出的**逐维 delta cap** 砍幅 (约束校验层 · 切灰度前置安全网).
 *
 * 为什么在格式校验**之后**再加一道 (两道各司其职, 不互相替代):
 *   · 格式校验 (WP66) = **防离谱**: 维度白名单 / 有限数字 / 统一 0.2 粗口径 / 标签合法 / 理由非空.
 *     它是**底线** —— 超了就是模型胡说, 该丢.
 *   · 逐维 cap (本函数) = **按标准砍**: 与规则算子**同一份边界**
 *     (`resolveDeltaCapConfig(config)`, 缺省 = 内核种子值 `DEFAULT_DELTA_CAP_CONFIG`),
 *     移情三维 (positive / negative / dependency) 是 ±0.15, 比格式校验的 0.2 更严.
 *     它是**标准** —— 超了不是错, 是"这一轮不该动这么多", 砍到边界并记账.
 *
 * ⚠️ 影子模式下这只是**观测**: 砍后的 delta 只进 trace, 不写 BDI 快照.
 *   切灰度后, 砍后的 delta 才是实际生效的那个.
 *
 * @param deltas 格式校验通过的 delta 建议列表
 * @param config cap 边界 (可选) —— 与规则算子同一份 `resolveDeltaCapConfig(config)`;
 *   缺省 = 内核种子值, 行为与本单之前逐字一致
 * @returns 砍后的列表 + 被砍的明细 (没被砍的维度不出现)
 */
export function applyDeliberationDeltaCap(
  deltas: readonly DeliberationDeltaEntry[],
  config?: DeltaCapConfig,
): {
  /** 砍后的稀疏 delta 列表 (维度 + 标签 + 理由不变, 只改 delta 数值). */
  readonly cappedDeltas: readonly DeliberationDeltaEntry[];
  /** 被砍的明细 (raw !== capped 才进). */
  readonly capEntries: readonly DeliberationCapEntry[];
} {
  const cappedDeltas: DeliberationDeltaEntry[] = [];
  const capEntries: DeliberationCapEntry[] = [];
  for (const entry of deltas) {
    // 先 round 再砍: trace 里所有数字都是同一个精度, 砍完的边界值 (0.15 / 0.2 / -0.3)
    //   在该精度下是精确值 —— 于是 `deliberationDelta[dim] === capEntries[].capped` 恒成立,
    //   消费方不用猜"这两个数是不是同一个口径".
    const raw = round(entry.delta);
    const capped = capEntryDelta(entry.dimension, raw, config);
    cappedDeltas.push({ ...entry, delta: capped });
    if (raw !== capped) {
      capEntries.push({ dimension: entry.dimension, raw, capped });
    }
  }
  return { cappedDeltas, capEntries };
}

/**
 * 单条 delta 按**它自己维度**的边界砍幅.
 *
 * ⚠️ 为什么用"探针向量 + 内核 `capTurnDelta`"而不是自己写一遍 clamp:
 *   仓库纪律 —— **判定只有一份** (env 守卫 / 召回策略 / cap 边界都是这条纪律的实例).
 *   自己写一份 `Math.min(Math.max(...))` 就等于开了第二个真相:
 *   哪天内核改了 `DEFAULT_DELTA_CAP_CONFIG` 的数值, 或改了 `capAsym` 的边界语义
 *   (严格大于 vs 大于等于), 这份就静默漂移 —— 而且**不报错**, 只在某个维度上表现不同.
 *
 *   探针法成立的前提: `capTurnDelta` 是**逐维独立**处理的 (每维各砍各的, 不看别的维),
 *   所以造一个"只有目标维度带值、其余维度全 0"的向量喂进去, 读回该维度的值,
 *   就是这个值按该维度边界砍完的结果.
 *
 *   ⚠️ 为什么要**逐条**探针而不是一次性把所有维度的值塞进去:
 *   模型可能对同一维度给多条建议 (格式校验不拦重复维度). 一次性塞进去只能拿到
 *   "最后一个值"的砍幅, 前面几条会被算成别的值 —— 逐条探针保证每条建议只改自己的数值.
 *
 * @param dim 维度名
 * @param value 该维度上的 delta (已 round)
 * @param config cap 边界 (可选) —— 缺省 = 内核种子值
 * @returns 砍完后的 delta
 */
function capEntryDelta(dim: DeliberationDim, value: number, config?: DeltaCapConfig): number {
  const probe: MutableDeltaVector = { ...ZERO_DELTA_VECTOR };
  probe[dim] = value;
  return capTurnDelta(probe, config ?? DEFAULT_DELTA_CAP_CONFIG)[dim];
}

/**
 * ── 临床合理性校验 (观测版 · 切灰度前置) ─────────────────────────────────────
 *
 * 三条规则的阈值都是**工程种子值**, 不是临床标定 (仓库纪律: 不发明临床数字).
 * 影子期只**标记**可疑轮次, 供督导复盘校准; 等数据跑够了再把确认的规则
 * 从"观测"切换到"拦截".
 *
 * ⚠️ **为什么在 delta cap 之后**: 临床校验审计的必须是**进 trace 的那个数**
 *   (砍后的值) —— 与 `deliberationDelta` / `deltaDiff` 同口径,
 *   消费方不用猜"这个标记说的是模型原话还是砍完的话".
 */

/**
 * 临床合理性规则名 —— trace 里 `clinicalFlags[].rule` 就是它.
 *
 * ⚠️ 这是**稳定的统计口径**: 督导复盘按规则名聚合. 改名 = 历史数据对不上,
 *   所以改之前先想清楚 (要改就新加一个规则名, 别改老的).
 */
export type ClinicalSanityRule = 'alliance_positive_spike' | 'alliance_negative_spike' | 'resistance_triple_jump';

/**
 * 单条临床合理性标记 (观测版 —— **不拦截、不砍幅**).
 *
 * ⚠️ 这里只有**数字 + 规则名 + 维度名** —— 不是心理内容 (隐私红线 AGENTS.md §5.4).
 */
export interface ClinicalFlag {
  /** 命中的规则名. */
  readonly rule: ClinicalSanityRule;
  /** 维度名 (收窄成审议维度 —— 消费方不用再判一次合法性). */
  readonly dimension: DeliberationDim;
  /** 实际值 (砍后的 delta). */
  readonly value: number;
  /** 该规则的阈值 (记下来 = 事后知道当时按什么标准判的). */
  readonly threshold: number;
  /** 严重程度: info = 稍微可疑; warn = 很可疑. */
  readonly severity: 'info' | 'warn';
}

/**
 * 三条规则的阈值 (**工程种子值, 非临床标定**).
 *
 * ⚠️ **这些数字没有临床依据** —— 它们的用途是"把可疑的轮次挑出来给督导看",
 *   不是"判定临床对错". 校准流程: 影子期跑数据 → 督导复盘 flagged 轮次 →
 *   确认哪些规则真的有信号 → 再定阈值 (或者把规则改成拦截).
 */
export const CLINICAL_SANITY_THRESHOLDS = {
  /** 同盟三维 (trust / safety / bond) 正向跳变 —— 信任建立得太快. */
  alliancePositive: 0.15,
  /**
   * 同盟三维负向跳变 —— 信任破裂得太快.
   *
   * ⚠️ **这条规则在完整管道里目前不可达**: 格式校验的粗口径
   *   (`DELIBERATION_MAX_ABS_DELTA = 0.2`) 比这条阈值 (-0.25) **更严** ——
   *   能过格式校验的负向 delta 最小是 -0.2, 永远够不到 "< -0.25".
   *   → 观测数据里规则 2 恒为 0 条. **这不是 bug**, 是上游那道更严的底线先拦住了.
   *   → 切灰度时若要让这条规则有信号, 得先决定: 放宽格式校验到 per-dim cap 边界,
   *     还是把阈值收到 -0.2 以内. (直接调 `applyClinicalSanityCheck` 时它照常命中.)
   */
  allianceNegative: -0.25,
  /** 阻抗三维 (verbal / depth / style) 集体上升. */
  resistanceTriple: 0.1,
} as const;

/** 同盟三维 (咨询同盟: trust / safety / bond). */
const CLINICAL_ALLIANCE_DIMS = ['trust', 'safety', 'bond'] as const satisfies readonly DeliberationDim[];

/** 阻抗三维 (话量 / 内容深度 / 表达风格 —— 内核口径: 越高阻抗越强). */
const CLINICAL_RESISTANCE_DIMS = ['verbal', 'depth', 'style'] as const satisfies readonly DeliberationDim[];

/**
 * 临床合理性校验 (观测版) —— 对**砍后**的 delta 跑三条规则, 标记可疑的.
 *
 * ⚠️ **只标记, 不改 delta**: `checkedDeltas` 与入参**逐字相同** ——
 *   这是观测版的全部意义 (切灰度前, 这层只提供信号, 绝不改变审议结果).
 *
 * ⚠️ **同一维度多条建议时按"最后一条"取值** (与 trace 口径一致):
 *   `buildSuccessRecord` 拼 `deliberationDelta` 时也是**后写覆盖前写**,
 *   所以临床校验必须取**同一个数** —— 否则标记说的值和 trace 记的值对不上.
 *
 * @param deltas 砍幅后的 delta 建议列表
 * @param enabled 观测开关 (关着 → 直接返回空数组, 零开销)
 * @returns 原样返回的 delta 列表 + 临床合理性标记
 */
export function applyClinicalSanityCheck(
  deltas: readonly DeliberationDeltaEntry[],
  enabled: boolean,
): {
  /** 原始 delta 列表 (**不改** —— 观测版只标记). */
  readonly checkedDeltas: readonly DeliberationDeltaEntry[];
  /** 临床合理性标记 (没发现可疑 = 空数组). */
  readonly clinicalFlags: readonly ClinicalFlag[];
} {
  if (!enabled) return { checkedDeltas: deltas, clinicalFlags: [] };

  // 逐维取值 (同一维度多条 → 最后一条, 与 trace 的 deliberationDelta 同口径).
  const values = new Map<DeliberationDim, number>();
  for (const entry of deltas) values.set(entry.dimension, entry.delta);

  const clinicalFlags: ClinicalFlag[] = [];

  // 规则 1 / 2: 同盟三维的正向 / 负向跳变 (信任建立得太快 / 破裂得太快).
  for (const dim of CLINICAL_ALLIANCE_DIMS) {
    const value = values.get(dim);
    if (value === undefined) continue;
    if (value > CLINICAL_SANITY_THRESHOLDS.alliancePositive) {
      clinicalFlags.push({
        rule: 'alliance_positive_spike',
        dimension: dim,
        value,
        threshold: CLINICAL_SANITY_THRESHOLDS.alliancePositive,
        severity: 'warn',
      });
    }
    if (value < CLINICAL_SANITY_THRESHOLDS.allianceNegative) {
      clinicalFlags.push({
        rule: 'alliance_negative_spike',
        dimension: dim,
        value,
        threshold: CLINICAL_SANITY_THRESHOLDS.allianceNegative,
        severity: 'warn',
      });
    }
  }

  // 规则 3: 阻抗三维**同时**正向跳变 (阻抗集体上升).
  //   ⚠️ 三维**都**超阈值才算命中 (少一维就不算"集体") —— 缺的维度按"没超"处理.
  const resistanceHits: { dim: DeliberationDim; value: number }[] = [];
  for (const dim of CLINICAL_RESISTANCE_DIMS) {
    const value = values.get(dim);
    if (value !== undefined) resistanceHits.push({ dim, value });
  }
  if (
    resistanceHits.length === CLINICAL_RESISTANCE_DIMS.length &&
    resistanceHits.every((item) => item.value > CLINICAL_SANITY_THRESHOLDS.resistanceTriple)
  ) {
    for (const { dim, value } of resistanceHits) {
      clinicalFlags.push({
        rule: 'resistance_triple_jump',
        dimension: dim,
        value,
        threshold: CLINICAL_SANITY_THRESHOLDS.resistanceTriple,
        severity: 'info',
      });
    }
  }

  return { checkedDeltas: deltas, clinicalFlags };
}

/**
 * 审议输出的**最简**格式校验 (WP66 正式做校验 + 重试).
 *
 * 本期口径:
 *   - **顶层**形状不对 (不是对象 / deltas 不是数组 / summary 不是字符串 / confidence 不是数字)
 *     → 整份判不合法 (返回 null → client 返 `schema_validation_failed`);
 *   - **单条**条目不合法 → 丢掉这一条, 但把**原始条目**带进 `rejectedEntries`
 *     (证据不能丢: 非法维度最典型就是模型硬塞硬安全维度).
 *
 * 校验项:
 *   · dimension 必须在 `DELIBERATION_DIMS` 里 (硬安全维度不在其中 → 必被丢);
 *   · delta 必须是有限数字, 且绝对值不超过 `DELIBERATION_MAX_ABS_DELTA`;
 *   · operatorTags 至少 1 个, 且每个都必须是合法标签;
 *   · reason 必须是非空字符串.
 *
 * @param raw LLM 返回的原始 JSON (反序列化后)
 * @returns 校验通过则返回产物 + 被丢掉的条目; 不通过返回 null
 */
export function validateDeliberationOutput(raw: unknown): ValidatedDeliberation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { deltas?: unknown; summary?: unknown; confidence?: unknown; intentionShift?: unknown };
  if (!Array.isArray(candidate.deltas)) return null;
  if (typeof candidate.summary !== 'string') return null;
  if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence)) return null;

  const deltas: DeliberationDeltaEntry[] = [];
  const rejectedEntries: unknown[] = [];
  for (const item of candidate.deltas) {
    const entry = validateDeltaEntry(item);
    if (entry === null) {
      rejectedEntries.push(item);
      continue;
    }
    deltas.push(entry);
  }

  // WP68: `intentionShift` 是**可选**的 —— 缺省 (或明确 null) = 不建议切换.
  //   给了但非法 (策略名不在内核 8 种里 / 理由为空) → **丢掉它** (当 null),
  //   原始值留在 `rejectedEntries` 里 (证据不丢, 但不让非法值参与锁定判定).
  //   ⚠️ 不整份判不合法: 一条非法建议不该让整轮审议白跑 (与单条 delta 的处理同款).
  const intentionShift = validateIntentionShift(candidate.intentionShift);
  if (intentionShift === undefined) rejectedEntries.push(candidate.intentionShift);

  return {
    output: {
      deltas,
      summary: candidate.summary,
      confidence: candidate.confidence,
      intentionShift: intentionShift ?? null,
    },
    rejectedEntries,
  };
}

/**
 * 校验 LLM 建议的意图切换 (WP68).
 *
 * @param raw 原始 JSON 里的 `intentionShift` 字段
 * @returns `null` = 不建议切换 (缺省 / 明确 null); 有值 = 合法建议;
 *          `undefined` = **非法** (调用方丢掉它并留证据)
 */
function validateIntentionShift(raw: unknown): DeliberationIntentionShift | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return undefined;
  const candidate = raw as { targetStrategy?: unknown; reason?: unknown };
  if (!isBehaviorStrategy(candidate.targetStrategy)) return undefined;
  if (typeof candidate.reason !== 'string' || candidate.reason.trim().length === 0) return undefined;
  return { targetStrategy: candidate.targetStrategy, reason: candidate.reason.trim() };
}

/**
 * 校验单条 delta 建议.
 *
 * @param raw 单条原始条目
 * @returns 合法则返回规范条目; 不合法返回 null
 */
function validateDeltaEntry(raw: unknown): DeliberationDeltaEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { dimension?: unknown; delta?: unknown; operatorTags?: unknown; reason?: unknown };
  if (typeof candidate.dimension !== 'string') return null;
  if (!isDeliberationDim(candidate.dimension)) return null;
  if (typeof candidate.delta !== 'number' || !Number.isFinite(candidate.delta)) return null;
  if (Math.abs(candidate.delta) > DELIBERATION_MAX_ABS_DELTA) return null;
  if (!Array.isArray(candidate.operatorTags) || candidate.operatorTags.length === 0) return null;
  const tags: DeliberationOperatorTag[] = [];
  for (const tag of candidate.operatorTags) {
    if (typeof tag !== 'string' || !isDeliberationOperatorTag(tag)) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (typeof candidate.reason !== 'string' || candidate.reason.trim().length === 0) return null;
  return {
    dimension: candidate.dimension,
    delta: candidate.delta,
    operatorTags: tags,
    reason: candidate.reason.trim(),
  };
}

/** 这个维度名在审议枚举里吗 (硬安全维度不在其中). */
function isDeliberationDim(value: string): value is DeliberationDim {
  return (DELIBERATION_DIMS as readonly string[]).includes(value);
}

/** 这个操作标签在审议枚举里吗. */
function isDeliberationOperatorTag(value: string): value is DeliberationOperatorTag {
  return DELIBERATION_OPERATOR_TAG_SET.has(value);
}

/** 合法操作标签的集合 (建一次, 反复查). */
const DELIBERATION_OPERATOR_TAG_SET: ReadonlySet<string> = new Set<string>([
  ...DELIBERATION_RULE_ALIGNED_TAGS,
  ...DELIBERATION_LLM_ONLY_TAGS,
]);

/** 数值保留固定小数位 (消掉浮点噪声). */
function round(value: number): number {
  const factor = 10 ** DELIBERATION_VALUE_PRECISION;
  return Math.round(value * factor) / factor;
}

/**
 * LLM 审议服务 (影子模式的**执行器**).
 *
 * 装配: 引擎装配模块 (EngineWiringModule) 把它列为 provider; 由
 * `DeliberationProcessor` (BullMQ Worker) 调用.
 *
 * ⚠️ V2026-11-05 (WP65): 它**不再实现** `DeliberationShadowPort` ——
 *   门面那一侧的端口实现在 `DeliberationProcessor` (入队), 本类只负责"真跑".
 *   两者拆开的原因: 让门面与"队列"解耦 —— 以后换队列 (Redis Stream / MQ),
 *   或给 Worker 扩缩容, 都不牵动本类.
 */
@Injectable()
export class LlmDeliberationService {
  private readonly logger = new Logger(LlmDeliberationService.name);

  /**
   * 审议侧的逐维 delta cap 边界 —— 与规则算子**同一份** (`resolveDeltaCapConfig(config)`).
   *
   * ⚠️ **为什么在构造函数体里赋值** (而不是字段初始化器):
   *   `tsconfig` 的 `useDefineForClassFields` 是 true (target es2024 的默认) —— 字段初始化器
   *   在**类字段定义阶段**就跑, 那时构造参数 `config` 还没赋值 (参数属性的赋值发生在
   *   构造函数体内), 初始化器会拿到 `undefined` → `resolveDeltaCapConfig(undefined)` 直接抛.
   *   所以字段只**声明**, 赋值放构造函数体.
   *
   * ⚠️ **启动期求值, 不做热更新** (任务单 §八 5):
   *   规则侧在 `ENGINE_SESSION_PORT` 的 useFactory 里求值一次, 本服务是单例也只求值一次 ——
   *   运维中途改 env, **两侧都不变**, 口径始终一致 (不会出现"规则侧新、审议侧旧"的分歧).
   */
  private readonly capConfig: DeltaCapConfig;

  constructor(
    private readonly llmJson: CounselorLlmJsonClient,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    /**
     * BDI 状态仓储 (过期判定要读当前快照的 revision).
     *
     * ⚠️ **必须用 token 注入, 不能靠接口类型**:
     *   `BdiStateRepository` 是**接口** —— 编译后没有运行时值, 当不了 Nest 的 provider
     *   token. 裸写类型会让 Nest 按 `design:paramtypes` 去找名为 `Object` 的 provider ——
     *   找不到就**静默注入 undefined** (不报错!), 症状是判定永远走兜底分支、过期率恒为 0.
     *   同理, 这个 token 绑定的必须与内核写侧**同一个单例** (否则读的不是同一份真相).
     */
    @Inject(ENGINE_BDI_STATE_REPOSITORY) private readonly bdiStates: BdiStateRepository,
  ) {
    // 与规则算子**同一份** cap 配置 (env `ENGINE_CAP_*` → `DeltaCapConfig`) —— 两边口径逐字一致.
    this.capConfig = resolveDeltaCapConfig(config);
  }

  /**
   * 真正跑一次影子审议 (不生效, 只记录对比数据).
   *
   * ⚠️ V2026-11-05 (WP66): 本方法**只抛** `DeliberationRetryableError` ——
   *   值得重试的失败 (模型输出形状不对 / 上游限流 5xx) 先写 trace 再抛, 交给 BullMQ 重试;
   *   不值得重试的失败 (鉴权 / 网络超时 / 代码 bug) 照旧**吞掉**, 影子模式不炸主流程.
   *   其它异常一律不往上传 —— 队列反复重试同一件没救的事, 只是白烧 LLM.
   *
   * ⚠️ V2026-11-05 (WP67): **返回结局** —— 熔断器要靠它判断"这轮审议成没成".
   *   之前非重试类失败 (网络挂 / 鉴权错) 是被本方法**吞掉**的, 调用方只看"有没有抛异常",
   *   分不清"成功"与"失败但被吞了" —— 熔断器于是永远看不到失败, 熔断形同虚设.
   *   现在: 成功 / 失败 / 代码异常 / 开关关掉没跑, 四种结局**都**如实返回.
   *   ⚠️ "值得重试"的失败仍然**抛** (WP66 的不变式"抛 = 值得重试"不动) —— 那条路径
   *     调用方靠 catch 拿, 不靠返回值.
   *
   * @param input 本轮审议所需的全部上下文
   * @param retryCount 已经重试过几次 (0 = 第一次跑); 从 BullMQ 的 `job.attemptsMade` 来
   * @returns 本轮结局 (ok / failed / exception / skipped)
   */
  async executeShadowMode(input: DeliberationShadowInput, retryCount = 0): Promise<DeliberationOutcome> {
    // 开关在**执行时**再判一次: 入队到执行之间可能隔了几十秒, 运维这期间把开关
    // 关了 → 队列里的旧 job 直接跳过, 不烧这次 LLM (仓库硬约束 12).
    if (!this.isEnabled()) return { kind: 'skipped' };
    const startedAt = Date.now();
    // WP-A 合规红线: 高风险轮次**永远不跑** LLM 审议 (状态变化完全由规则算子决定).
    //   ⚠️ **双重保险**: 队列层 (processor) 入队前已拦过一次, 这里再拦一次 ——
    //   闸门不能只靠一层: 任何一层被绕过 (配置改错 / 代码路径漏接), 这一层还在.
    if (!isDeliberationRiskAcceptable(input.structured.riskLevel)) {
      await this.writeTrace(this.buildFailureRecord(input, DELIBERATION_RISK_SKIP_ERROR_CODE, startedAt, null, retryCount));
      return { kind: 'skipped' };
    }

    const outcome = await this.runDeliberation(input);

    // 代码 bug 路径: **不重试** (重试同一个 bug 还是会挂), 记一条失败 trace 就收工.
    if (outcome.kind === 'exception') {
      await this.writeTrace(this.buildFailureRecord(input, 'shadow_exception', startedAt, null, retryCount));
      return outcome;
    }

    if (outcome.kind === 'failed') {
      // ⚠️ 顺序很重要: **先写 trace, 再抛** —— 失败记录不能丢 (PoC 统计要用).
      await this.writeTrace(this.buildFailureRecord(input, outcome.errorCode, startedAt, outcome.usage, retryCount));
      if (isRetryableDeliberationError(outcome.errorCode)) {
        throw new DeliberationRetryableError(outcome.errorCode, `审议失败, 值得重试: ${outcome.errorCode}`);
      }
      return outcome;
    }

    // 走到这里只剩"成功" (`runDeliberation` 不会返回 'skipped' —— 那是开关关掉时的早退).
    if (outcome.kind === 'ok') {
      // WP68: 意图锁定判定 —— 拿规则算子的策略 + LLM 建议的 intentionShift, 过一遍锁.
      //   ⚠️ 判定结果**直接进 trace** (lockedStrategy / llmIntentionAccepted),
      //   所以这一步必须在写 trace **之前**算好.
      const lock = await this.resolveLock(input, outcome.validated.output.intentionShift);
      // V2026-11-07 (过期判定): 审议跑完后 load 一次当前快照的 revision, 对比 baseRevision.
      //   ⚠️ 判定结果**直接进 trace** (stale / currentRevision), 所以必须在写 trace **之前**算好.
      //   放在 resolveLock 之后: 读 revision 离写 trace 越近, "中间有没有跑别的轮次" 越准.
      const staleCheck = await this.checkStale(input.tenantId, input.sessionId, input.baseRevision);
      await this.writeTrace(this.buildSuccessRecord(input, outcome.validated, startedAt, outcome.usage, retryCount, lock, staleCheck));
      // 状态落盘放在 trace 之后: trace 是主产物, 锁状态是辅助.
      // 写锁状态失败 → 下一轮还是同一个锁定期 (保守方向: 宁可多锁, 不可少锁).
      await this.saveIntentionLockState(input.tenantId, input.sessionId, lock.newState);
    }
    return outcome;
  }

  /**
   * 跑一次**生效**审议 (R9 · 灰度切换) —— 结果会真的改 delta.
   *
   * ⚠️ **与影子路径的关系**: 二者**同源不同命** ——
   *   · 同一份 prompt 装配 (`buildDeliberationSystemPrompt` / `buildDeliberationUserPrompt`);
   *   · 同一个结构化输出链 (`CounselorLlmJsonClient` + `validateDeliberationOutput`);
   *   · 同一份 delta cap (`applyDeliberationDeltaCap` + 同一份 `capConfig`);
   *   · 同一套临床合理性规则 (`applyClinicalSanityCheck`);
   *   · 同一份 trace 记录 (`buildSuccessRecord` / `buildFailureRecord`) —— 灰度期
   *     看板看的还是那套字段 (`deltaDiff` / `capEntries` / `clinicalFlags` …).
   *   差别只有两处:
   *   · **不走 BullMQ 队列** —— 生效路径要的是"下一轮就能用", 队列的延迟与重试语义
   *     对不上 (队列是"观察面"的载体, 生效面要的是"即时可用");
   *   · **多一道"临床可疑维度剔除"** —— 影子期临床校验只标记, 生效期标记的维度
   *     **不落状态** (保守方向: 可疑的改动宁可不生效).
   *
   * ⚠️ **失败一律折成结局, 绝不抛** —— 主流程不能因为审议失败而炸 (与影子路径同款纪律).
   *
   * @param input 本轮审议所需的全部上下文
   * @returns 本轮结局 (ok / failed / exception)
   */
  async runEffectiveDeliberation(input: DeliberationEffectiveInput): Promise<DeliberationEffectiveOutcome> {
    const startedAt = Date.now();
    // WP-A 合规红线: 高风险轮次永远不跑 LLM 审议 —— 返回失败 = 上层拿不到补丁 = 回退规则 delta.
    if (!isDeliberationRiskAcceptable(input.structured.riskLevel)) {
      await this.writeTrace(this.buildFailureRecord(input, DELIBERATION_RISK_SKIP_ERROR_CODE, startedAt, null, 0));
      return { kind: 'failed', errorCode: DELIBERATION_RISK_SKIP_ERROR_CODE };
    }
    const outcome = await this.runDeliberation(input);

    // 代码 bug 路径: 不重试 (重试同一个 bug 还是会挂), 记一条失败 trace 收工.
    if (outcome.kind === 'exception') {
      await this.writeTrace(this.buildFailureRecord(input, 'shadow_exception', startedAt, null, 0));
      return { kind: 'exception' };
    }

    // "跳过" (开关关着) 在生效路径不该出现 (模式配置已判过) —— 出现就当"没有建议".
    if (outcome.kind === 'skipped') {
      return { kind: 'failed', errorCode: 'skipped' };
    }

    if (outcome.kind === 'failed') {
      await this.writeTrace(this.buildFailureRecord(input, outcome.errorCode, startedAt, outcome.usage, 0));
      return { kind: 'failed', errorCode: outcome.errorCode };
    }

    // 走到这里只剩"成功". 下面的三步与影子路径**逐字同款** (锁 → 过期判定 → trace).
    const lock = await this.resolveLock(input, outcome.validated.output.intentionShift);
    const staleCheck = await this.checkStale(input.tenantId, input.sessionId, input.baseRevision);
    await this.writeTrace(this.buildSuccessRecord(input, outcome.validated, startedAt, outcome.usage, 0, lock, staleCheck));
    await this.saveIntentionLockState(input.tenantId, input.sessionId, lock.newState);

    // 生效用的 delta: 砍幅后 + **剔除临床可疑维度**.
    //   ⚠️ 砍幅与 trace 里用的是同一份 `applyDeliberationDeltaCap` (纯函数, 结果逐字相同) ——
    //     生效值与 trace 记的值必须一致, 否则看板会骗人.
    const { cappedDeltas } = applyDeliberationDeltaCap(outcome.validated.output.deltas, this.capConfig);
    //   ⚠️ 临床校验在生效路径**强制打开** (不受 `ENGINE_CLINICAL_SANITY_ENABLED` 控制):
    //     那个开关是**观察面**的开关 (影子期默认关, 省开销); 生效期它是**安全网** ——
    //     观察面可以关, 安全网不能关.
    const { clinicalFlags } = applyClinicalSanityCheck(cappedDeltas, true);
    const deltas = dropClinicalFlaggedDimensions(cappedDeltas, clinicalFlags);
    return { kind: 'ok', deltas };
  }

  /**
   * 记一条"**熔断中, 这一轮没跑审议**"的 trace (WP67).
   *
   * ⚠️ 为什么由 service 写 (而不是 processor 直接写 Redis):
   *   trace 的**格式与 key 设计**归 service 一家 (WP65 的纪律: 队列层不自己写 trace).
   *   processor 只负责"什么时候该记" —— 熔断状态归它, trace 归 service.
   *   这也让"熔断"在 PoC 统计里可辨: `errorCode='circuit_open'` = 根本没跑,
   *   其余 `ok=false` = 跑了但失败.
   *
   * @param input 本轮上下文 (用它的 sessionId / turnIndex / ruleDelta 定位 trace)
   */
  async recordCircuitOpen(input: DeliberationShadowInput): Promise<void> {
    await this.writeTrace(this.buildFailureRecord(input, DELIBERATION_CIRCUIT_OPEN_ERROR_CODE, Date.now(), null, 0));
  }

  /**
   * 记一条"**高风险轮次, 压根没跑审议**"的 trace (WP-A 合规闸门).
   *
   * ⚠️ **为什么由 service 写** (而不是队列层自己写):
   *   trace 的**格式与 key 设计**归 service 一家 (WP65 起的纪律: 队列层不自己写 trace).
   *   队列层只负责"什么时候该记" —— 闸门判定在它那里, trace 的写法在这里.
   *
   * ⚠️ **为什么值得记一条**:
   *   这是**合规证据** —— "高风险轮次一次都没出境"这句话, 要能拿数字证明.
   *   错误码 `skipped_high_risk` 与熔断的 `circuit_open` 分开, 看板能区分
   *   "被合规闸门拦下" 与 "被熔断器拦下".
   *
   * @param input 本轮上下文 (只取定位信息与规则 delta)
   */
  async recordRiskSkipped(input: DeliberationShadowInput): Promise<void> {
    await this.writeTrace(this.buildFailureRecord(input, DELIBERATION_RISK_SKIP_ERROR_CODE, Date.now(), null, 0));
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 跑一次 LLM 审议, 把结果收敛成**结构化结局** (不抛).
   *
   * 为什么要单独抽这一层: `executeShadowMode` 要分三种结局 (成功 / 上游失败 / 代码异常),
   * 而**抛 `DeliberationRetryableError` 的语句不能待在 try 块里** ——
   * 会被同一个 catch 吞掉, 重试就永远不发生 (WP66 的核心机制直接废掉).
   * 把"跑"与"判"分开, 抛异常的语句就永远在 try 之外, 这个坑结构性地踩不到.
   *
   * @param input 本轮审议所需的全部上下文
   * @returns 结局 (成功 / 上游失败 / 代码异常)
   */
  private async runDeliberation(input: DeliberationShadowInput): Promise<DeliberationOutcome> {
    try {
      const model = this.resolveModel();
      const result = await this.llmJson.requestJson<ValidatedDeliberation>({
        systemPrompt: buildDeliberationSystemPrompt(input.mode),
        // WP-A: 用户 prompt **零原文** —— 只有结构化数据
        //   (事件分类 / 状态前后对比 / 角色基线 / 行为策略 / 风险等级).
        userPrompt: buildDeliberationUserPrompt({
          turnIndex: input.turnIndex,
          structured: input.structured,
        }),
        schemaDescription: buildDeliberationSchemaDescription(),
        validate: validateDeliberationOutput,
        maxCompletionTokens: DELIBERATION_MAX_COMPLETION_TOKENS,
        timeoutMs: this.resolveTimeoutMs(),
        tenantId: input.tenantId,
        userId: input.userId,
        temperature: this.resolveTemperature(),
        ...(model ? { model } : {}),
      });

      if (!result.ok || !result.data) {
        return { kind: 'failed', errorCode: result.errorCode, usage: result.usage };
      }
      return { kind: 'ok', validated: result.data, usage: result.usage };
    } catch (error) {
      // 影子模式的**最后一道防线**: 连 client 都抛了 (如 tenantId/userId 缺失导致
      // LlmService 同步抛) —— 记一条失败 trace, 绝不把异常抛回主流程.
      this.logger.warn(`[deliberation_shadow] 审议异常, 已忽略 (session=${input.sessionId} turn=${input.turnIndex}): ${messageOf(error)}`);
      return { kind: 'exception' };
    }
  }

  /**
   * 影子模式开关 (`ENGINE_DELIBERATION_ENABLED`).
   *
   * 判定口径在共享纯函数 `resolveDeliberationEnabled()` —— 入队前 (processor) 与
   * 执行时 (这里) 共用同一份真相, 不各写一份.
   */
  private isEnabled(): boolean {
    return resolveDeliberationEnabled(this.config.get<string>('ENGINE_DELIBERATION_ENABLED'));
  }

  /**
   * 临床合理性观测开关 (`ENGINE_CLINICAL_SANITY_ENABLED`).
   *
   * 缺省 = **关** (影子期默认不跑; 要跑观测数据时运维显式打开).
   *
   * ⚠️ 解析口径复用 `parseBooleanEnv()` —— 与影子模式总开关**同一套字面量**,
   *   不另写一份 (仓库纪律: 判定只有一份).
   */
  private isClinicalSanityEnabled(): boolean {
    return parseBooleanEnv(this.config.get<string>('ENGINE_CLINICAL_SANITY_ENABLED'));
  }

  /**
   * 审议专用模型 (`ENGINE_DELIBERATION_MODEL`).
   *
   * 缺省 = 空 = **沿用 counselor 域的默认模型** (client 内部按
   * `MINIMAX_COUNSELOR_LLM_MODEL` → 默认模型 解析). 换模型不必改代码.
   */
  private resolveModel(): string | undefined {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_MODEL') ?? '').trim();
    return raw.length > 0 ? raw : undefined;
  }

  /**
   * 审议超时 (`ENGINE_DELIBERATION_TIMEOUT_MS`).
   *
   * 非法值 → 回退默认 3000 (不抛错): 超时旋钮填错不该让服务起不来.
   */
  private resolveTimeoutMs(): number {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_TIMEOUT_MS') ?? '').trim();
    if (raw.length === 0) return DEFAULT_DELIBERATION_TIMEOUT_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIBERATION_TIMEOUT_MS;
    return Math.floor(parsed);
  }

  /**
   * 审议温度 (`ENGINE_DELIBERATION_TEMPERATURE`).
   *
   * 非法值 (非数字 / 越界) → 回退默认 0.3 (不抛错).
   */
  private resolveTemperature(): number {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_TEMPERATURE') ?? '').trim();
    if (raw.length === 0) return DEFAULT_DELIBERATION_TEMPERATURE;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) return DEFAULT_DELIBERATION_TEMPERATURE;
    return parsed;
  }

  /** 成功记录. */
  private buildSuccessRecord(
    input: DeliberationShadowInput,
    validated: ValidatedDeliberation,
    startedAt: number,
    usage: DeliberationTokenUsage | null,
    retryCount: number,
    lock: IntentionLockResult,
    staleCheck: DeliberationStaleCheck,
  ): DeliberationTraceRecord {
    const { output, rejectedEntries } = validated;
    // 约束校验层: 逐维 delta cap —— **写进 trace 的 delta 一定是砍过的**.
    //   ⚠️ 放在这里 (而不是调用点) = "进 trace 的东西必然过了约束校验层",
    //   杜绝"换个调用点忘了砍"这类静默失效 (影子期看不出差别, 切灰度就是状态错乱).
    const { cappedDeltas, capEntries } = applyDeliberationDeltaCap(output.deltas, this.capConfig);
    // 临床合理性校验 (观测版): **只标记, 不砍不丢**.
    //   ⚠️ 放在 cap **之后** = 审计的是"进 trace 的那个数" (砍后的值),
    //   与 deliberationDelta / deltaDiff 同口径.
    const { clinicalFlags } = applyClinicalSanityCheck(cappedDeltas, this.isClinicalSanityEnabled());
    const deliberationDelta: Partial<Record<DeliberationDim, number>> = {};
    const entries: DeliberationTraceEntry[] = [];
    const tags: DeliberationOperatorTag[] = [];
    for (const delta of cappedDeltas) {
      deliberationDelta[delta.dimension] = round(delta.delta);
      entries.push({
        dimension: delta.dimension,
        delta: round(delta.delta),
        operatorTags: delta.operatorTags,
        reason: delta.reason,
      });
      for (const tag of delta.operatorTags) {
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
    return {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      baseRevision: input.baseRevision,
      stale: staleCheck.stale,
      currentRevision: staleCheck.currentRevision,
      timestamp: new Date().toISOString(),
      ok: true,
      errorCode: null,
      retryCount,
      durationMs: Date.now() - startedAt,
      mode: input.mode,
      tokenUsage: usage ? { ...usage } : null,
      ruleDelta: input.ruleDelta,
      deliberationDelta,
      deltaDiff: computeDeliberationDeltaDiff(input.ruleDelta, deliberationDelta),
      capEntries,
      clinicalFlags,
      operatorTags: tags,
      reason: entries.length > 0 ? truncate(entries.map((entry) => entry.reason).join('；')) : null,
      confidence: output.confidence,
      summary: output.summary,
      entries,
      rejectedEntries,
      // WP68: 意图锁定的三方对比 (规则 / LLM 建议 / 锁定后实际生效).
      ruleStrategy: input.structured.ruleStrategy,
      llmIntentionShift: output.intentionShift,
      lockedStrategy: lock.effectiveStrategy,
      llmIntentionAccepted: lock.llmSuggestionAccepted,
    };
  }

  /** 失败记录 (LLM 报错 / JSON 不合法 / 超时). */
  private buildFailureRecord(
    input: DeliberationShadowInput,
    errorCode: string | null,
    startedAt: number,
    usage: DeliberationTokenUsage | null,
    retryCount: number,
  ): DeliberationTraceRecord {
    return {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      baseRevision: input.baseRevision,
      // V2026-11-07: 失败轮次**不跑**过期判定 (没有结果可丢弃) —— 两个字段占位,
      //   让 trace 的形状在成功 / 失败两种情况下**一致** (消费方不用判分支).
      stale: false,
      currentRevision: null,
      timestamp: new Date().toISOString(),
      ok: false,
      errorCode: errorCode ?? 'unknown_error',
      retryCount,
      durationMs: Date.now() - startedAt,
      mode: input.mode,
      tokenUsage: usage ? { ...usage } : null,
      ruleDelta: input.ruleDelta,
      deliberationDelta: {},
      deltaDiff: computeDeliberationDeltaDiff(input.ruleDelta, {}),
      // 失败轮次没有建议可砍 —— 空数组, 让 trace 的形状在成功 / 失败两种情况下**一致**.
      operatorTags: [],
      reason: null,
      confidence: null,
      summary: null,
      entries: [],
      rejectedEntries: [],
      capEntries: [],
      // 失败轮次没有建议可判 —— 空数组, 让 trace 的形状在成功 / 失败两种情况下**一致**.
      clinicalFlags: [],
      // WP68: 失败轮次**不跑**锁定判定 (压根没有建议可判) —— 三个字段占位,
      //   让 trace 的形状在成功 / 失败两种情况下**一致** (消费方不用判分支).
      ruleStrategy: input.structured.ruleStrategy,
      llmIntentionShift: null,
      lockedStrategy: input.structured.ruleStrategy,
      llmIntentionAccepted: false,
    };
  }

  /**
   * 过期判定: 审议回来时, 快照是不是还在 baseRevision 那个版本.
   *
   * 切灰度前置安全网 —— 审议是**异步**的 (BullMQ 队列跑), 等它跑完的时候,
   * 快照可能已经被规则算子更新过好几轮了. 这时候把旧快照算出来的 delta
   * apply 到新快照上, 状态就错乱了.
   *
   * ⚠️ **锚 R1 而不是 R0** (口径别搞混):
   *   R1 = 本轮**落库后**的版本 (= 内核 `EngineTurnOutput.revision`, 门面透传成
   *   入参 `baseRevision`); 本轮**开始时**的那份是 R0 = R1 - 1.
   *   锚 R1 是因为判定问的是"**回来时的当前版本 == 本字段吗**": 审议在本轮落库
   *   **之后**才入队, 回来时当前版本必然 >= R1 —— 锚 R0 会让判定**永远**为"过期".
   *
   * ⚠️ **保守兜底** (宁可误判没过期, 不误杀):
   *   load 失败 (Redis 挂) / 会话不存在 → `{ stale: false, currentRevision: null }`.
   *   影子期只是观测 —— 误判过期会让你以为"很多审议都过期了", 把切灰度决策带偏;
   *   误判没过期只是少记几条, 不影响大局.
   *
   * @param tenantId 租户隔离键 (与内核写快照时用的同一个)
   * @param sessionId 业务会话 id
   * @param baseRevision 本轮审议对应的快照版本 (R1)
   * @returns 过期判定结果
   */
  private async checkStale(tenantId: string, sessionId: string, baseRevision: number): Promise<DeliberationStaleCheck> {
    try {
      const record = await this.bdiStates.load(tenantId, sessionId);
      // 会话不存在 (还没落库 / 已被清理) → 兜底: 判没过期.
      if (!record) return { stale: false, currentRevision: null };
      // currentRevision > baseRevision → 中间又跑了几轮 → 过期.
      // (相等 = 没过期; 小于 = 不可能, 防御性地当作没过期.)
      return { stale: record.revision > baseRevision, currentRevision: record.revision };
    } catch (error) {
      // load 失败 → 兜底: 判没过期 (保守方向).
      // 日志只出定位信息 —— 不打对话原文 (隐私红线 AGENTS.md §5.4).
      this.logger.warn(`[deliberation_stale] 快照读取失败, 按未过期处理 (session=${sessionId}): ${messageOf(error)}`);
      return { stale: false, currentRevision: null };
    }
  }

  /**
   * 意图锁定判定 (读状态 → 纯函数判定).
   *
   * ⚠️ **读失败按"没锁过"处理** (fail-open, 与 WP67 的熔断器同款口径):
   *   锁定机制是**观察工具**, 不是正确性保障 —— Redis 抖动时不该让所有会话的
   *   意图锁定判定失真. 读不到 = 从第一轮重新算起.
   *
   * @param input 本轮上下文
   * @param llmSuggestion LLM 建议的切换 (null = 不建议)
   * @returns 锁定判定结果
   */
  private async resolveLock(
    input: DeliberationShadowInput,
    llmSuggestion: DeliberationIntentionShift | null,
  ): Promise<IntentionLockResult> {
    const state = await this.loadIntentionLockState(input.tenantId, input.sessionId);
    return resolveIntentionLock(state, input.structured.ruleStrategy, llmSuggestion, this.resolveIntentionLockRounds(), input.turnIndex);
  }

  /** 读意图锁定状态 (读不到 / 读坏 = 没锁过). */
  private async loadIntentionLockState(tenantId: string, sessionId: string): Promise<IntentionLockState | null> {
    try {
      const raw = await this.redis.get(buildDeliberationIntentionLockKey(tenantId, sessionId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<IntentionLockState>;
      // 状态坏了 (字段缺失 / 策略名非法) → 当没锁过, 不让一个坏 key 永久卡住会话.
      if (!isBehaviorStrategy(parsed.ruleStrategy) || !isBehaviorStrategy(parsed.effectiveStrategy)) return null;
      return {
        ruleStrategy: parsed.ruleStrategy,
        effectiveStrategy: parsed.effectiveStrategy,
        lockedUntilRound: readFiniteNumber(parsed.lockedUntilRound),
        roundIndex: readFiniteNumber(parsed.roundIndex),
      };
    } catch (error) {
      this.logger.warn(`[deliberation_intention_lock] 状态读取失败 (session=${sessionId}): ${messageOf(error)}`);
      return null;
    }
  }

  /** 写意图锁定状态 (TTL 24 小时, 每次写都刷新). */
  private async saveIntentionLockState(tenantId: string, sessionId: string, state: IntentionLockState): Promise<void> {
    try {
      await this.redis.set(
        buildDeliberationIntentionLockKey(tenantId, sessionId),
        JSON.stringify(state),
        DELIBERATION_INTENTION_LOCK_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`[deliberation_intention_lock] 状态写入失败 (session=${sessionId}): ${messageOf(error)}`);
    }
  }

  /**
   * 意图锁定轮数 (`ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS`).
   *
   * 缺省 = **3** (工程种子值, 非临床数字). 非法值 → 回退默认 (**不抛错**).
   * ⚠️ **0 是合法值** = 关掉锁定机制 (做对照实验用) —— 与"非法值"区分开.
   */
  private resolveIntentionLockRounds(): number {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS') ?? '').trim();
    if (raw.length === 0) return DEFAULT_DELIBERATION_INTENTION_LOCK_ROUNDS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DELIBERATION_INTENTION_LOCK_ROUNDS;
    return Math.floor(parsed);
  }

  /**
   * 写 trace 表 (Redis) + 同步累加统计计数器 (Redis hash).
   *
   * 写失败**只打日志**, 不抛 —— 观察面写不进去不是会话失败 (与仓库既有降级口径一致).
   *
   * ⚠️ **这里是统计计数器的唯一写入点** —— 所有轮次 (成功 / 失败 / 熔断跳过)
   *   都走 writeTrace, 所以这里就是"每轮审议同步累加"的那一处 (任务单 §4.2).
   */
  private async writeTrace(record: DeliberationTraceRecord): Promise<void> {
    try {
      const key = buildDeliberationTraceKey(record.tenantId, record.sessionId, record.turnIndex);
      await this.redis.set(key, JSON.stringify(record), DEFAULT_DELIBERATION_TRACE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`[deliberation_shadow] trace 写入失败 (session=${record.sessionId} turn=${record.turnIndex}): ${messageOf(error)}`);
    }

    // ⚠️ **统计计数器独立 try/catch** —— 不能与 trace 写入共用一个 try:
    //   共用的话, 统计写失败会被 catch 成"trace 写失败" (误导排查);
    //   更糟的情况是统计异常把 trace 也带崩 (trace 是主产物, 统计只是辅助).
    //   影子模式的纪律: 观察面挂了就挂了, **不能炸主流程** (与 trace 写入同款口径).
    try {
      await applyDeliberationStats(this.redis, record);
    } catch (error) {
      this.logger.warn(
        `[deliberation_shadow] 统计计数写入失败 (session=${record.sessionId} turn=${record.turnIndex}): ${messageOf(error)}`,
      );
    }
  }
}

/** 取错误信息 (跨 unknown 边界的安全取法). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读一个有限数字 (读不到 / 不是有限数 → 0). 用于 Redis 里那个可能写坏的锁定状态. */
function readFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 截断到上限 (超长加省略号). */
function truncate(text: string, maxChars = DELIBERATION_FLAT_REASON_MAX_CHARS): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}
