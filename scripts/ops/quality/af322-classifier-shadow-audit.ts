// V2026-11-23 建立 (AF-323 · 真实语料分类器影子审计):
//   职责: 读本地 debug trace → 抽咨询师轮 → 规则轨与模型轨（shadow）并行 → 只输出计数 / 比率.
//   边界:
//     · 不打印、不落盘任何咨询师或来访原文;
//     · 不改生产分类器、不改 delta、不改 prompt;
//     · 模型轨固定 shadow，core 结果始终等于规则轨，审计只观察两轨标签.
//
//   用法 (pnpm, 禁裸 npx):
//     pnpm audit:classifier-shadow -- --rule-only
//     pnpm audit:classifier-shadow -- --sample-per-session 3 --limit 24
//     pnpm audit:classifier-shadow -- --rule-only --legacy   # 仅历史复现，默认 v2 与生产一致
//
//   ⚠️ 隐私红线 (AGENTS.md §5.4): 控制台与 JSON 只有 id / 计数 / 比率 / 标签 / 模型标识.

import 'dotenv/config';

import { ConfigService } from '@nestjs/config';
import fs from 'node:fs';
import path from 'node:path';

import { formatRatio, parseTargetIds, renderAuditMarkdown, summarizeAudit } from './af322-classifier-shadow-audit.mjs';
import { LlmService } from '../../../src/agent/llm/llm.service.js';
import { COUNSELOR_LLM_DEFAULT_MODEL, COUNSELOR_LLM_MODEL_ENV_KEY } from '../../../src/counselor/config/counselor-llm.config.js';
import { CounselorLlmJsonClient } from '../../../src/counselor/providers/llm-json.client.js';
import type { ModelClassifierModeConfig } from '../../../src/engine-adapters/cognition/model-classifier-mode.config.js';
import {
  type ModelClassifierObservation,
  type ModelClassifierObserver,
} from '../../../src/engine-adapters/cognition/model-classifier-observation.js';
import {
  ModelEventClassifier,
  type ModelClassifierSessionResolver,
} from '../../../src/engine-adapters/cognition/model-event-classifier.js';
import { RuleBasedClassifier } from '../../../src/engine-core/index.js';

interface RawMessage {
  readonly role?: string;
  readonly text?: string;
  readonly turnIndex?: number;
}

interface RawTranscript {
  readonly id?: string;
  readonly messages?: readonly RawMessage[];
}

interface Options {
  readonly dir: string;
  readonly ids: readonly string[];
  readonly samplePerSession: number;
  readonly limit: number;
  readonly ruleOnly: boolean;
  readonly legacy: boolean;
}

interface SampleTurn {
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly counselorText: string;
  readonly previousVisitorText: string;
}

/**
 * 解析命令行参数.
 *
 * @param argv 参数数组
 * @returns 选项
 */
function parseOptions(argv: readonly string[]): Options {
  const read = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index === -1 ? fallback : (argv[index + 1] ?? fallback);
  };
  const samplePerSession = Number(read('--sample-per-session', '3'));
  const limit = Number(read('--limit', '24'));
  return {
    dir: read('--dir', 'data/debug-sessions'),
    ids: parseTargetIds(read('--ids', '')),
    samplePerSession: Number.isFinite(samplePerSession) && samplePerSession > 0 ? Math.floor(samplePerSession) : 3,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 24,
    ruleOnly: argv.includes('--rule-only'),
    legacy: argv.includes('--legacy'),
  };
}

/**
 * 读一场 trace，取最后 N 个咨询师轮（后段更能观察策略空间）。
 *
 * @param filePath 文件路径
 * @param sessionId 场次 id
 * @param samplePerSession 每场抽样轮数
 * @returns 抽样轮
 */
function sampleSession(filePath: string, sessionId: string, samplePerSession: number): SampleTurn[] {
  const transcript = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RawTranscript;
  const messages = transcript.messages ?? [];
  const counselorMessages = messages.filter((message) => message.role === 'counselor' && (message.text ?? '').trim());
  const selected = counselorMessages.slice(-samplePerSession);
  return selected.map((message) => {
    const turnIndex = Number.isFinite(message.turnIndex) ? Number(message.turnIndex) : 0;
    const visitor = messages
      .filter((item) => item.role === 'visitor' && Number(item.turnIndex) === turnIndex - 1)
      .map((item) => item.text ?? '')
      .join('\n');
    return {
      sessionId,
      turnIndex,
      counselorText: message.text ?? '',
      previousVisitorText: visitor,
    };
  });
}

/**
 * 内存观测器：只收集无原文的观测记录.
 */
function memoryObserver(): { observer: ModelClassifierObserver; records: ModelClassifierObservation[] } {
  const records: ModelClassifierObservation[] = [];
  return {
    records,
    observer: {
      record(observation): void {
        records.push(observation);
      },
    },
  };
}

/**
 * 主流程.
 */
async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  console.log('=== AF-323 真实语料分类器影子审计 ===');
  console.log(`trace 目录 ${options.dir}`);
  console.log(`目标场次 ${options.ids.length} | 每场抽样 ${options.samplePerSession} | 总调用上限 ${options.limit}`);
  console.log(`模式 ${options.ruleOnly ? 'rule_only（零模型调用）' : 'shadow（规则轨 + 模型轨）'}`);
  console.log(`规则轨 ${options.legacy ? 'legacy（历史复现）' : 'v2（与生产一致）'}`);

  if (!fs.existsSync(options.dir)) {
    console.error(`目录不存在: ${options.dir}`);
    process.exitCode = 1;
    return;
  }

  const samples: SampleTurn[] = [];
  const missing: string[] = [];
  for (const sessionId of options.ids) {
    const filePath = path.join(options.dir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) {
      missing.push(sessionId);
      continue;
    }
    samples.push(...sampleSession(filePath, sessionId, options.samplePerSession));
  }
  console.log(`可抽样轮 ${samples.length} | 缺失场次 ${missing.length > 0 ? missing.join('、') : '无'}`);

  const rule = new RuleBasedClassifier({ semantics: options.legacy ? 'legacy' : 'v2' });
  let records: ModelClassifierObservation[] = [];
  let sessions = 0;

  if (options.ruleOnly) {
    const synthetic = samples.slice(0, options.limit).map((sample) => ({
      sessionId: sample.sessionId,
      turnIndex: sample.turnIndex,
      ruleKinds: rule.classify(sample.counselorText, { sessionId: sample.sessionId }).map((event) => event.kind),
      modelKinds: rule.classify(sample.counselorText, { sessionId: sample.sessionId }).map((event) => event.kind),
      agreement: true,
      confidence: null,
      modelId: 'rule-only',
      degraded: false,
    }));
    records = synthetic as unknown as ModelClassifierObservation[];
    sessions = new Set(synthetic.map((item) => item.sessionId)).size;
  } else {
    const config = new ConfigService({ ...process.env });
    const llm = new LlmService(config);
    const llmJson = new CounselorLlmJsonClient(llm, config);
    const modelId = config.get<string>(COUNSELOR_LLM_MODEL_ENV_KEY) ?? COUNSELOR_LLM_DEFAULT_MODEL;
    const memory = memoryObserver();
    const modeConfig: ModelClassifierModeConfig = {
      effectiveMode: 'shadow',
      grayscaleSessions: new Set<string>(),
      timeoutMs: 3000,
    };
    const resolver: ModelClassifierSessionResolver = {
      resolveBySessionId: (sessionId): { tenantId: string; userId: string; scenarioType: 'full_simulation' } => ({
        tenantId: 'af323-audit',
        userId: 'offline-audit',
        scenarioType: 'full_simulation',
      }),
    };
    const classifier = new ModelEventClassifier(llmJson, modeConfig, memory.observer, resolver, modelId);

    for (const sample of samples.slice(0, options.limit)) {
      classifier.recordVisitorTurn(sample.sessionId, sample.previousVisitorText);
      await classifier.classifyAsync(sample.counselorText, { sessionId: sample.sessionId });
      console.log(`  ${sample.sessionId} turn=${sample.turnIndex} 完成`);
    }
    records = memory.records;
    sessions = new Set(records.map((record) => record.sessionId)).size;
  }

  const summary = summarizeAudit(records, options.ids);
  console.log('\n=== 汇总（无原文） ===');
  console.log(renderAuditMarkdown(summary));
  console.log(`实际覆盖场次 ${sessions} / 目标 ${options.ids.length} | 总数 ${summary.total} | 降级 ${summary.degraded}`);
  console.log(
    `exact=${formatRatio(summary.exactAgreementRate)} jaccard=${formatRatio(summary.meanJaccard)} neutral规则=${formatRatio(summary.ruleNeutralRate)} neutral模型=${formatRatio(summary.modelNeutralRate)}`,
  );
}

await main();
