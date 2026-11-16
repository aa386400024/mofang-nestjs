// V2026-10-30 治本 (WP19-R · 留痕链真跑验收探针):
//   目的: 用**真实 DI 装配** (AppModule) + 真实 MySQL + 真实上游模型跑 ≥2 场对练,
//         然后把 training_sessions.turn_debug_trace 的**脱敏**查询结果打出来.
//
//   为什么必须这么跑 (任务单 §3 验收第 1 条):
//     "验收以实跑 DB 行为为准, 不接受通读代码后声明完成" ——
//     本单的核心缺陷正是"代码看起来接上了, 但那根线从没通电".
//     所以探针走的是**产品真实链路**: Nest 容器 → EngineStreamBackend →
//     引擎门面 → 渲染适配器 → 上游模型, 留痕由装配层注入的 TraceRecorder 落库.
//     探针**不**手工构造快照 —— 那样只能证明"JSON 能写进去", 证明不了"真的写了".
//
//   为什么跑编译产物 (dist/) 而不是 tsx 直跑源码:
//     仓库现在是 ESM (`type: module`), tsx 直跑源码时的模块求值顺序与编译产物
//     不同 —— 直跑会撞上 `AuditLogProcessor` 的循环依赖 (基线代码同样炸, 与本单
//     无关). 编译产物是**服务真实启动的那份**, 所以探针也跑它.
//
//   跑法:
//     1. npx tsc -p tsconfig.build.json      (出 dist/)
//     2. node scripts/probe-wp19r-trace.mjs
//
//   脱敏口径 (打出来的都是非敏感字段):
//     · 不打 promptPreview 全文 (只打长度) —— 它是 system prompt 前 500 字;
//     · 不打逐字稿 / 用户 id / 会话 id 全文 (只打前 8 位);
//     · 打的是: BDI 四值 / renderSpec 参数 / llmUsage / crisis / 时间戳.

import { loadEnvFile } from 'node:process';

import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AppModule } from '../dist/app.module.js';
import { TrainingSession } from '../dist/counselor/entities/training-session.entity.js';
import { TrainingSessionStatus } from '../dist/counselor/enums/training-session-status.enum.js';
import { TrainingDifficulty } from '../dist/counselor/enums/training-difficulty.enum.js';
import { VisitorMode } from '../dist/counselor/enums/visitor-mode.enum.js';
import { VisitorStyle } from '../dist/counselor/enums/visitor-style.enum.js';
import { DimensionVariance } from '../dist/counselor/enums/dimension-variance.enum.js';
import { CharacterProfileEntity } from '../dist/engine-adapters/wiring/character/character-profile.entity.js';
import { CHARACTER_PROFILE_RESOLVER } from '../dist/engine-adapters/wiring/character/index.js';
import { EngineStreamBackend } from '../dist/engine-adapters/wiring/engine-stream-backend.adapter.js';

try {
  loadEnvFile();
} catch {}

// 留痕开关: dev 缺省开, 这里显式打开 (验收要的是"真的落库").
process.env['ENGINE_DEBUG_TRACE_ENABLED'] = 'true';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });

const backend = app.get(EngineStreamBackend);
const sessionRepo = app.get(getRepositoryToken(TrainingSession));
const characterRepo = app.get(getRepositoryToken(CharacterProfileEntity));
const resolver = app.get(CHARACTER_PROFILE_RESOLVER);

// ── 角色: 挑一个真实 vpt_* slug (approved + enabled) ───────────────────────
const characters = await characterRepo.find({ where: { auditStatus: 'approved', enabled: true }, order: { templateId: 'ASC' } });
const character = characters.at(0);
if (!character) throw new Error('角色池里没有 approved + enabled 的角色 —— 先跑 seed:character-profiles');
console.log(`[probe] 选中角色 slug=${character.templateId} codename=${character.displayName}`);

// 引擎侧真实解析一次 (证明"调试器看到的角色"与"引擎注入的角色"同源).
const resolved = await resolver.resolve({ templateId: character.templateId });
console.log(
  `[probe] 引擎注入基线 trust=${resolved?.characterProfile.baseline?.trust} ` +
    `valence=${resolved?.characterProfile.baseline?.emotion.valence} ` +
    `arousal=${resolved?.characterProfile.baseline?.emotion.arousal} ` +
    `resist=${resolved?.characterProfile.baseline?.resistance.verbal}`,
);
console.log(
  `[probe] DB 角色行基线 trust=${character.baselineTrust} ` +
    `valence=${character.baselineEmotionValence} ` +
    `arousal=${character.baselineEmotionArousal} ` +
    `resist=${character.baselineResistanceVerbal}`,
);

// ── 跑 2 场对练, 每场 2 轮 ──────────────────────────────────────────────────
const SESSIONS = [
  { user: 'probe-student-a', lines: ['你好，今天感觉怎么样？', '最近跟男朋友吵了一架，心里挺堵的。'] },
  { user: 'probe-student-b', lines: ['我们开始吧，你想聊点什么？', '最近工作上压力有点大，睡不太好。'] },
];

const createdIds = [];

for (const [index, plan] of SESSIONS.entries()) {
  // 落一条 training_sessions (与 counselor 侧 vpt-session-bridge 同款形状).
  const entity = sessionRepo.create({
    tenantId: plan.user,
    userId: plan.user,
    scenarioId: 'skill_voice',
    difficulty: TrainingDifficulty.L1,
    durationMinutes: 10,
    status: TrainingSessionStatus.IDLE,
    personaName: character.displayName,
    personaAge: 27,
    personaOccupation: '产品经理',
    personaComplaint: '亲密关系与工作压力',
    personaBackground: '',
    visitorStyle: VisitorStyle.COOPERATIVE,
    emotionBaseline: 0.35,
    defenseLevel: 0.2,
    randomSeed: `wp19r-${Date.now()}-${index}`,
    mode: VisitorMode.USE_MY_SETTINGS,
    styleVariance: DimensionVariance.MEDIUM,
    emotionVariance: DimensionVariance.MEDIUM,
    defenseVariance: DimensionVariance.MEDIUM,
    transcript: [],
    supervisionReportId: null,
    startedAt: new Date(),
    endedAt: null,
  });
  const saved = await sessionRepo.save(entity);
  createdIds.push(saved.id);

  const sessionId = `wp19r-probe-${index}-${Date.now()}`;
  await backend.openSession({
    sessionId,
    tenantId: plan.user,
    userId: plan.user,
    templateId: character.templateId,
    personaId: character.templateId,
    dbSessionId: saved.id,
  });

  for (const line of plan.lines) {
    const { stream } = await backend.streamTurn({
      sessionId,
      tenantId: plan.user,
      userId: plan.user,
      personaId: character.templateId,
      userText: line,
    });
    let reply = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content') reply += chunk.content;
      if (chunk.type === 'error') console.log(`[probe] 本轮出错: ${chunk.error.code}`);
    }
    console.log(`[probe] 场次${index + 1} 咨询师="${line}" → 来访="${reply.slice(0, 40)}"`);
  }

  backend.closeSession(sessionId);
}

// 留痕写入是 fire-and-forget (每轮一次 UPDATE) —— 等它落完再查.
await new Promise((resolve) => setTimeout(resolve, 2000));

// ── 脱敏查询: DB 里真实落了什么 ─────────────────────────────────────────────
const rows = await sessionRepo.query(
  `SELECT LEFT(id, 8) AS session_id, user_id,
          JSON_LENGTH(turn_debug_trace) AS trace_rows,
          JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[0].turnIndex'))  AS t0_index,
          JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[0].characterSlug')) AS t0_slug,
          JSON_EXTRACT(turn_debug_trace, '$[0].bdiSnapshot.trust')      AS t0_trust,
          JSON_EXTRACT(turn_debug_trace, '$[0].bdiSnapshot.valence')    AS t0_valence,
          JSON_EXTRACT(turn_debug_trace, '$[0].bdiSnapshot.arousal')    AS t0_arousal,
          JSON_EXTRACT(turn_debug_trace, '$[0].bdiSnapshot.resistance') AS t0_resistance,
          JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[0].bdiSnapshot.anxiousSecure')) AS t0_anxious_secure,
          JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[0].renderSpec.taskKind'))         AS t0_task_kind,
          JSON_EXTRACT(turn_debug_trace, '$[0].renderSpec.maxCompletionTokens')           AS t0_max_tokens,
          JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[0].renderSpec.reasoningEffort'))  AS t0_effort,
          CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[0].renderSpec.promptPreview'))) AS t0_prompt_len,
          JSON_EXTRACT(turn_debug_trace, '$[0].llmUsage.promptTokens')     AS t0_prompt_tokens,
          JSON_EXTRACT(turn_debug_trace, '$[0].llmUsage.completionTokens') AS t0_completion_tokens,
          JSON_EXTRACT(turn_debug_trace, '$[0].llmUsage.reasoningTokens') AS t0_reasoning_tokens,
          JSON_EXTRACT(turn_debug_trace, '$[0].llmUsage.ttftMs')           AS t0_ttft_ms,
          JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[0].llmUsage.finishReason')) AS t0_finish_reason,
          JSON_EXTRACT(turn_debug_trace, '$[0].crisis.detected') AS t0_crisis,
          JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[0].ts')) AS t0_ts,
          JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[1].turnIndex'))  AS t1_index,
          JSON_EXTRACT(turn_debug_trace, '$[1].bdiSnapshot.trust')      AS t1_trust,
          JSON_EXTRACT(turn_debug_trace, '$[1].llmUsage.completionTokens') AS t1_completion_tokens,
          JSON_UNQUOTE(JSON_EXTRACT(turn_debug_trace, '$[1].ts')) AS t1_ts
     FROM training_sessions
    WHERE id IN (?)
    ORDER BY started_at`,
  [createdIds],
);

console.log('\n===== DB 实测: training_sessions.turn_debug_trace (脱敏) =====');
console.table(rows);

await app.close();
process.exit(0);
