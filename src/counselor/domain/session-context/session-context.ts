// V2026-10-21 治本 (V1.2 VS-A — 会话上下文装配器 (纯类型 + 纯渲染)):
//   原因: v1.2 的 M1 (分层人设) / M2 (知情同意) / M3 (轻提示 + 技术统计) / M4 (作业反馈 +
//     咨询师笔记) 全都要往 "给模型看的上下文" 里加东西. 现状是 visitor prompt
//     (src/agent/visitor/visitor.prompts.ts) 只认 complaint/personality/background 3 字段,
//     **完全不知道** counselor 侧 training_sessions 的 persona 5 字段 / visitorStyle /
//     难度 / 情绪基线 / 防御水平, 也不知道 transcript 全文.
//     若 M1/M2/M3/M4 各自去改 visitor.prompts.ts, 必然长出 4 份重复拼装代码 + 4 份
//     上下文口径漂移 (督导看到的 transcript 和来访者看到的 transcript 不是同一份).
//   修法: 本模块是 **会话上下文的唯一真值源**, 分两层:
//     - 类型层: SessionContext / SessionPersonaContext (不可变), 描述 "一个会话有哪些上下文"
//     - 渲染层: 纯函数, 把 SessionContext 渲染成 prompt 文本块
//       * renderSessionMetaBlock  — 会话元信息 (场景 / 难度 / 时长 / 状态)
//       * renderPersonaBlock      — 来访者画像 (persona 5 字段 + visitorStyle + 难度 + 情绪/防御)
//       * renderTranscriptBlock   — 逐字稿 (咨询师 / 来访者 交替, 带轮次序号)
//       * buildSupervisionContextBlock — 督导分析用的完整上下文块 (上面 3 块拼装)
//     后续 M1 (全量人设) / M2 (知情同意状态) / M3 (轻提示) / M4 (作业反馈 + 笔记) 统一
//     往 SessionContext 加字段, 渲染层负责把它们放进 prompt — **新增 context 块只有 1 处要改**.
//   反双胞胎:
//     - 不把渲染逻辑写进 visitor.prompts.ts: 那是 agent 模块的来访者人设模板, 与 counselor
//       业务上下文正交; 上下文装配归 counselor, agent 只消费拼好的 prompt
//     - 不在本模块注入 Repository: 本文件是纯函数 (无 DI), 便于单测; 取数在
//       src/counselor/providers/session-context.builder.ts
//     - 不把 transcript 原文直接塞进 prompt 而不做截断: 长会话会撑爆上下文, 统一走
//       maxTurns 截断 + 尾部保留 (最近 N 轮对督导最有价值)
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 curl GET /counselor/training-sessions/:id → 返 transcript 数组 (字段跟 V0.5 client 一致)
//     3. 生成督导反馈时日志可见 transcript 轮次数与截断标记
//   时间戳: 2026-10-21

import { ChatRole } from '../../enums/chat-role.enum';
import type { TrainingDifficulty } from '../../enums/training-difficulty.enum';
import type { TrainingSessionStatus } from '../../enums/training-session-status.enum';
import type { VisitorStyle } from '../../enums/visitor-style.enum';

/**
 * 统一的一轮对话 (counselor 端唯一口径).
 *
 * 存在的原因: 两种 session 的 transcript 元素形状不一样 —
 *   - 单次训练 training_sessions.transcript: { id, role, text, timestamp, isTyping? }
 *   - 长程卷宗 long_term_case_sessions.transcript: { role, content, ts }
 *   (两者都是 v1.1 §6.5 定的 1:1 wire shape, 不能改 entity)
 *   督导 / 来访者 prompt 只需要 (角色, 文本, 时间戳), 所以在**上下文层**统一成
 *   SessionContextTurn, entity 形状差异由各自的 mapper 吸收.
 */
export interface SessionContextTurn {
  readonly role: ChatRole;
  readonly text: string;
  readonly timestamp: number;
}

/**
 * 来访者画像上下文 (v1.2 M1 之前 = training_sessions 的浅层 5 字段 + VisitorPreset 关键项).
 *
 * v1.2 M1 会把全量人设 (成长时间线 / 内在工作模型 / 社会关系 / 应对模式 / 咨询预设) 加进来,
 * 届时本类型扩展, 渲染层同步扩展 — 消费方 (督导 / 来访者) 不用改.
 */
export interface SessionPersonaContext {
  readonly name: string;
  readonly age: number;
  readonly occupation: string;
  readonly complaint: string;
  readonly background: string;
  readonly visitorStyle: VisitorStyle;
  readonly difficulty: TrainingDifficulty;
  readonly emotionBaseline: number;
  readonly defenseLevel: number;
}

/**
 * 已解锁档案条目 (视图 B, 已被来访披露的部分).
 *
 * 只装**用户已经知道**的信息 —— 督导上下文里放未解锁的深层人设, 等于变相泄露
 * "来访者还没说出口的内心戏", 摧毁信息探索的训练价值 (v1.2 §2.2 原则 1/2).
 */
export interface SessionContextEntry {
  /** 锚点 (对应全量人设的 JSON path) */
  readonly anchorKey: string;
  /** 条目正文 (披露原话) */
  readonly content: string;
  /** 在第几次会谈中披露 (无关联时为 null) */
  readonly sessionId: string | null;
}

/**
 * 一个训练会话的完整上下文 (不可变).
 */
export interface SessionContext {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly scenarioId: string;
  readonly status: TrainingSessionStatus;
  readonly difficulty: TrainingDifficulty;
  readonly durationMinutes: number;
  readonly persona: SessionPersonaContext;
  readonly transcript: readonly SessionContextTurn[];
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  /**
   * 咨访信任度 0-1 (信息暴露节奏的驱动值, v1.2 §4.1).
   * 单次训练没有长程关系 → null; 长程取 visitor_full_personas.trust_level.
   */
  readonly trustLevel: number | null;
  /** 已解锁档案条目 (仅长程有内容). */
  readonly unlockedEntries: readonly SessionContextEntry[];
  /**
   * 归属长程个案 id (单次训练为 null).
   *
   * V2026-10-21 治本 (V1.2 VS-B2 — 供上下文贡献者定位全量人设):
   *   原因: 访客上下文贡献者要按 caseId 去取 visitor_full_personas (7 大块全量人设),
   *     而 SessionContext 之前没带 caseId → 贡献者拿不到.
   */
  readonly caseId: string | null;
}

/** 角色 → 中文标签 (给模型看, 统一口径). */
const ROLE_LABEL: Readonly<Record<ChatRole, string>> = {
  [ChatRole.COUNSELOR]: '咨询师',
  [ChatRole.VISITOR]: '来访者',
  [ChatRole.SYSTEM]: '系统',
};

/**
 * 渲染会话元信息块.
 *
 * @param ctx 会话上下文
 */
export function renderSessionMetaBlock(ctx: SessionContext): string {
  return [
    '## 会话元信息',
    `- sessionId: ${ctx.sessionId}`,
    `- 场景: ${ctx.scenarioId}`,
    `- 难度: ${ctx.difficulty}`,
    `- 计划时长: ${ctx.durationMinutes} 分钟`,
    `- 状态: ${ctx.status}`,
    `- 轮次数: ${ctx.transcript.length}`,
  ].join('\n');
}

/**
 * 渲染来访者画像块.
 *
 * @param persona 来访者画像
 */
export function renderPersonaBlock(persona: SessionPersonaContext): string {
  return [
    '## 来访者画像',
    `- 姓名: ${persona.name}`,
    `- 年龄: ${persona.age}`,
    `- 职业: ${persona.occupation}`,
    `- 行为风格: ${persona.visitorStyle}`,
    `- 情绪基线: ${persona.emotionBaseline}`,
    `- 防御水平: ${persona.defenseLevel}`,
    '- 主诉:',
    persona.complaint,
    '- 背景:',
    persona.background,
  ].join('\n');
}

/**
 * 渲染逐字稿块.
 *
 * 截断策略: 超过 maxTurns 时**保留最后 maxTurns 轮** (最近的对督导最有价值),
 * 并在开头标记被省略的轮数 (让模型知道这不是完整对话, 避免误判).
 *
 * @param transcript 逐字稿 (不可变数组)
 * @param maxTurns 最多渲染轮数 (默认 200)
 */
export function renderTranscriptBlock(transcript: readonly SessionContextTurn[], maxTurns = 200): string {
  if (transcript.length === 0) {
    return '## 逐字稿\n(本次会话还没有对话记录)';
  }
  const overflow = Math.max(0, transcript.length - maxTurns);
  const slice = overflow > 0 ? transcript.slice(transcript.length - maxTurns) : transcript;
  const header = overflow > 0 ? `## 逐字稿 (前 ${overflow} 轮已省略, 仅保留最近 ${slice.length} 轮)` : '## 逐字稿';
  const lines = slice.map((turn, idx) => {
    const label = ROLE_LABEL[turn.role] ?? turn.role;
    return `[${idx + 1}] ${label}: ${turn.text}`;
  });
  return [header, ...lines].join('\n');
}

/**
 * 渲染"已解锁档案"块.
 *
 * 没有已解锁条目时返回空串 (不占位) —— spec §4.2「未提及的信息保持空白, 绝不提前显示」.
 *
 * @param entries 已解锁条目
 */
export function renderUnlockedEntriesBlock(entries: readonly SessionContextEntry[]): string {
  if (entries.length === 0) {
    return '';
  }
  const lines = entries.map((e, idx) => `[${idx + 1}] (${e.anchorKey}) ${e.content}`);
  return ['## 已解锁档案 (来访已主动披露的信息)', ...lines].join('\n');
}

/**
 * 渲染督导分析用的完整上下文块 (元信息 + 画像 + 逐字稿 + 已解锁档案).
 *
 * @param ctx 会话上下文
 * @param maxTranscriptTurns 逐字稿最多渲染轮数
 */
export function buildSupervisionContextBlock(ctx: SessionContext, maxTranscriptTurns = 200): string {
  const blocks = [renderSessionMetaBlock(ctx), renderPersonaBlock(ctx.persona), renderTranscriptBlock(ctx.transcript, maxTranscriptTurns)];
  const unlocked = renderUnlockedEntriesBlock(ctx.unlockedEntries);
  if (unlocked.length > 0) {
    blocks.push(unlocked);
  }
  return blocks.join('\n\n');
}
