// 停滞判定口径标定 (Phase2.5 WP-J · 改动 A)
//
// 用途: 用**真实逐字稿**回放新口径, 看它相对旧口径到底改了什么.
//
// 为什么要这个脚本 (而不是只靠单测):
//   单测只能证明"规则按设计生效"; 证不了"它会不会继续误伤真实对话".
//   金丝雀 24 场里有 5 场被判 stagnant, 逐对回放后全部是咨询师侧语义层误判 ——
//   那 5 场必须在新口径下**不再终止**, 这是本脚本的第一号验收项.
//
// ⚠️ 它算的不是"准确率":
//   DB 里的 status 是**旧口径**的产物, 不是人工真值. 所以输出叫"口径对比",
//   真阳性/假阳性的准确评估要靠 20 场人工标注集 (P1 后续).
//
// 隐私红线: 只输出 session id / 状态 / 轮次 / 相似度数字 —— **不打印任何对话文本**.
//
// 用法:
//   npx tsx scripts/ops/calibration/stagnation-calibration.ts
//   npx tsx scripts/ops/calibration/stagnation-calibration.ts YiBgpQSxbQh_q663IiVbT gzu9tnrBuXzztNMizliYh

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import mysql from 'mysql2/promise';

import {
  decideTurn,
  type CrisisWindowState,
  type StagnationState,
} from '../../../src/auto-practice/practice-runner.service.js';

/** 逐字稿默认目录. */
const TRANSCRIPT_DIR = path.resolve('data/debug-sessions');

interface TranscriptMessage {
  readonly role?: string;
  readonly text?: string;
}

interface TranscriptFile {
  readonly messages?: readonly TranscriptMessage[];
}

interface SessionRow {
  readonly debug_session_id: string;
  readonly status: string;
  readonly exit_reason: string;
  readonly turn_count: number;
  readonly counselor_mode_id: string;
  readonly character_slug: string;
}

/** 回放结论. */
interface ReplayResult {
  /** 新口径是否终止, 以及终止轮次. */
  readonly stoppedAtTurn: number | null;
  /** 触发终止的规则. */
  readonly rule: 'literal' | 'no_progress' | null;
  /** 咨询师语义回响轮数 (指标). */
  readonly semanticEchoTurns: number;
}

/**
 * 用**生产同款判定**回放一份逐字稿 (调 decideTurn, 不另写一套规则).
 *
 * 好处: 脚本量到的是线上真正会走的那条逻辑, 不会出现"标定脚本和线上判定漂移".
 * 逐字稿里没有 trace, 所以危机类别只能从文本推断 —— 而本脚本只关心停滞,
 * 危机分支在历史逐字稿里极少出现, 出现时会如实报成 crisis_* 终止.
 *
 * @param messages 逐字稿消息
 * @returns 回放结论
 */
function replay(messages: readonly TranscriptMessage[]): ReplayResult {
  const visitors = messages.filter((m) => m.role === 'visitor').map((m) => String(m.text ?? '').trim());
  const counselors = messages.filter((m) => m.role === 'counselor').map((m) => String(m.text ?? '').trim());
  const crisisWindow: CrisisWindowState = {
    active: false,
    firstTurn: 0,
    postTurns: 0,
    peakLevel: 0,
    category: null,
    escalated: false,
  };
  const stagnation: StagnationState = { literalRepeatStreak: 0, noProgressStreak: 0, semanticEchoTurns: 0 };

  for (let i = 0; i < visitors.length; i += 1) {
    const decision = decideTurn(
      {
        turnIndex: i + 1,
        closeRequested: false,
        crisisDetected: false,
        crisisCategory: null,
        visitorText: visitors[i],
        visitorHistory: visitors.slice(0, i),
        counselorText: counselors[i] ?? '',
        lastCounselorText: i === 0 ? '' : (counselors[i - 1] ?? ''),
      },
      crisisWindow,
      stagnation,
    );
    if (decision.kind === 'stop' && decision.reason === 'stagnant') {
      return {
        stoppedAtTurn: i + 1,
        rule: decision.literalStreak >= decision.noProgressStreak ? 'literal' : 'no_progress',
        semanticEchoTurns: stagnation.semanticEchoTurns,
      };
    }
  }
  return { stoppedAtTurn: null, rule: null, semanticEchoTurns: stagnation.semanticEchoTurns };
}

/** 读逐字稿 (缺失返回 null). */
function readTranscript(debugSessionId: string): TranscriptFile | null {
  const file = path.join(TRANSCRIPT_DIR, `${debugSessionId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as TranscriptFile;
}

async function main(): Promise<void> {
  const batchIds = process.argv.slice(2);
  const conn = await mysql.createConnection({
    host: process.env['DB_HOST'],
    port: Number(process.env['DB_PORT']),
    user: process.env['DB_USER'],
    password: process.env['DB_PASSWORD'],
    database: process.env['DB_NAME'],
  });

  const where = batchIds.length > 0 ? `batch_id IN (${batchIds.map(() => '?').join(',')})` : '1=1';
  const [rows] = await conn.execute(
    `SELECT debug_session_id, status, exit_reason, turn_count, counselor_mode_id, character_slug
       FROM ap_practice_sessions
      WHERE ${where} AND debug_session_id <> ''
      ORDER BY created_at`,
    batchIds,
  );
  await conn.end();

  const sessions = rows as SessionRow[];
  const tally = {
    /** 旧口径判停滞的场次. */
    oldStagnant: 0,
    /** 其中新口径**不再**判停滞 (翻案). */
    flipped: 0,
    /** 其中新口径仍然判停滞. */
    stillStagnant: 0,
    /** 旧口径判"非停滞"但新口径判停滞 (新增命中). */
    newlyFlagged: 0,
    /** 有逐字稿可回放的场次. */
    replayed: 0,
    missingTranscript: 0,
  };
  const flippedList: string[] = [];
  const stillList: string[] = [];
  const newList: string[] = [];

  for (const session of sessions) {
    const transcript = readTranscript(session.debug_session_id);
    if (!transcript?.messages) {
      tally.missingTranscript += 1;
      continue;
    }
    tally.replayed += 1;
    const result = replay(transcript.messages);
    const oldStagnant = session.status === 'stagnant';
    const newStagnant = result.stoppedAtTurn !== null;

    if (oldStagnant) {
      tally.oldStagnant += 1;
      if (newStagnant) {
        tally.stillStagnant += 1;
        stillList.push(
          `  · ${session.debug_session_id} [${session.character_slug}/${session.counselor_mode_id}]` +
            ` 旧=${session.exit_reason}@${session.turn_count}轮  新=${result.rule}@${result.stoppedAtTurn}轮`,
        );
      } else {
        tally.flipped += 1;
        flippedList.push(
          `  · ${session.debug_session_id} [${session.character_slug}/${session.counselor_mode_id}]` +
            ` 旧=${session.exit_reason}@${session.turn_count}轮  新=不终止 (语义回响 ${result.semanticEchoTurns} 轮)`,
        );
      }
    } else if (newStagnant) {
      tally.newlyFlagged += 1;
      newList.push(
        `  · ${session.debug_session_id} [${session.character_slug}/${session.counselor_mode_id}]` +
          ` 旧=${session.exit_reason}@${session.turn_count}轮  新=${result.rule}@${result.stoppedAtTurn}轮`,
      );
    }
  }

  console.log('\n=== 停滞判定口径对比 (旧口径产物 vs 新口径回放) ===');
  console.log(`批次: ${batchIds.length > 0 ? batchIds.join(', ') : '(全部)'}`);
  console.log(`场次总数        ${sessions.length}`);
  console.log(`有逐字稿可回放   ${tally.replayed}   (缺逐字稿 ${tally.missingTranscript})`);
  console.log(`旧口径判停滞     ${tally.oldStagnant}`);
  console.log(`  ├ 新口径不再判  ${tally.flipped}   ← 翻案 (误判被纠正)`);
  console.log(`  └ 新口径仍判    ${tally.stillStagnant}`);
  console.log(`旧口径未判/新口径判 ${tally.newlyFlagged}   ← 旧口径漏掉的真实停滞`);

  if (flippedList.length > 0) {
    console.log('\n-- 翻案场次 (新口径不再终止) --');
    console.log(flippedList.join('\n'));
  }
  if (stillList.length > 0) {
    console.log('\n-- 仍判停滞 (需人工复核是否为真停滞) --');
    console.log(stillList.join('\n'));
  }
  if (newList.length > 0) {
    console.log('\n-- 新增命中 (旧口径漏判) --');
    console.log(newList.join('\n'));
  }
  console.log('');
}

await main();
