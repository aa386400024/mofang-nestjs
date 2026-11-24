// AF-448 · 零语料算子剧本补语料（规则轨 · boundary_cross 优先）
//
//   目的：AF-427 台账表三里 normalization / affirmation / boundary_cross 三类的语料轮次为 0，
//         导致「算子幅度是否生效/是否被 cap 吞掉」无法用真实语料验证。本脚本用**人工剧本 +
//         真实规则轨分类器**补这三类的可复现语料：
//           · 咨询师台词由剧本给定（不是随机生成，也不是伪造引擎输出）；
//           · 每条台词都过生产同款 `RuleBasedClassifier`（v2 口径）拿真实命中词与 strength；
//           · delta 向量用内核 `aggregateTurnDelta` 真实计算（含同盟基础值与 cap 前的原始值）。
//
//   边界：
//     · 只做规则轨能判定的算子（normalization / affirmation / boundary_cross）。
//       `holding_present` / `cold_absent` 是跨轮模型轨事件，规则轨产不出来（见
//       rule-based-classifier.ts 头注），必须真跑 LLM 才有，本脚本不伪造 → 见交付记录 backlog。
//     · 会话文件带 `synthetic: true` / `generationMethod` / `scriptedScenario` 标记，
//       台账分组时必须能与真实用户会话区分。
//     · 不打印逐字稿原文（隐私红线），控制台只输出计数。
//
//   用法（pnpm，禁裸 npx）：
//     pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --dry-run
//     pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --apply
//     pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --apply --dir data/debug-sessions

import fs from 'node:fs';
import path from 'node:path';

import { RuleBasedClassifier, aggregateTurnDelta } from '../../../src/engine-core/index.js';
import type { CounselorEventKind } from '../../../src/engine-core/index.js';
import { KERNEL_REF } from '../../../src/engine-adapters/observability/kernel-fingerprint.js';

/** 剧本轮：咨询师台词 + 来访回应（来访文本只入档，不参与规则分类）。 */
interface ScriptedTurn {
  readonly counselor: string;
  readonly visitor: string;
  /** 该轮**刻意**瞄准的算子（自检断言用，不进引擎）。 */
  readonly targets: readonly CounselorEventKind[];
}

interface Scenario {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly turns: readonly ScriptedTurn[];
}

/**
 * 剧本库。
 *
 * 每条台词都刻意包含词表里的长词（不用裸词），避免否定抑制与遮盖消歧把命中吃掉：
 *   normalization：这很正常 / 很多人都会 / 并不是你一个人
 *   affirmation：你做得已经很好 / 这很不容易 / 我看到你的努力
 *   boundary_cross：我们私下 / 加我微信 / 留个联系方式
 */
export const SCRIPTED_SCENARIOS: readonly Scenario[] = [
  {
    slug: 'boundary_cross_self_disclosure',
    title: '咨询师越界式自我暴露',
    summary: '咨询师反复用「我也有类似经历」拉近关系，并把私下联系渠道给出去 —— 靶向 boundary_cross。',
    turns: [
      {
        counselor: '你愿意说出来，这很不容易。我在这里，慢慢来就好。',
        visitor: '我也不太确定该从哪里说……可能说完会被觉得很奇怪。',
        targets: ['affirmation'],
      },
      {
        counselor: '被这样对待确实很难受。换作别人，通常都会先怀疑是不是自己做错了。',
        visitor: '对，我一直在想是不是我的问题。',
        targets: ['normalization'],
      },
      {
        counselor: '我也有类似经历，所以特别理解你现在这种卡住的感觉。',
        visitor: '真的吗？那你会怎么处理？',
        targets: ['boundary_cross'],
      },
      {
        counselor: '其实这种反应很常见，并不是你一个人会这样。你不用急着把它理顺。',
        visitor: '听你这么说，我好像没那么羞耻了。',
        targets: ['normalization'],
      },
      {
        counselor: '如果你之后还有想说的，可以加我微信，我们私下聊会更方便。',
        visitor: '这样会不会太麻烦你？',
        targets: ['boundary_cross'],
      },
      {
        counselor: '我看到你的努力了，你今天能把这些讲清楚，已经不容易。',
        visitor: '嗯……我第一次觉得自己不是在抱怨。',
        targets: ['affirmation'],
      },
    ],
  },
  {
    slug: 'boundary_cross_advice_creep',
    title: '咨询师把「朋友式关心」带进会谈',
    summary: '咨询师用「跟你做朋友」「下班后找我」越过专业边界，同时在别处做正常化与肯定 —— 混合剧本。',
    turns: [
      {
        counselor: '这很正常，很多人都会在换工作前后睡不好。',
        visitor: '我以为只有我这样。',
        targets: ['normalization'],
      },
      {
        counselor: '你做得已经很好，能把作息调整到这个程度，我看到你的努力。',
        visitor: '其实我经常半夜醒。',
        targets: ['affirmation'],
      },
      {
        counselor: '说实话我挺想跟你做朋友的，你这种人我很欣赏。',
        visitor: '……这样合适吗？',
        targets: ['boundary_cross'],
      },
      {
        counselor: '你要是晚上又睡不着，下班后找我，我一般都在。',
        visitor: '那我是不是太依赖你了。',
        targets: ['boundary_cross'],
      },
      {
        counselor: '并不是你一个人会担心依赖这件事，这很常见。',
        visitor: '听到这句我松了口气。',
        targets: ['normalization'],
      },
      {
        counselor: '你能说出来，这很不容易。我们下次还可以从这里继续。',
        visitor: '好，我想试试。',
        targets: ['affirmation'],
      },
    ],
  },
  {
    slug: 'boundary_cross_boundary_repair',
    title: '越界后回到边界内的修复',
    summary: '先越界、再收回并说明专业边界 —— 用来观察 boundary_cross 与 acceptance 在同一会话里的交替。',
    turns: [
      {
        counselor: '我留个联系方式给你吧，有需要随时找我。',
        visitor: '这样我有点不安。',
        targets: ['boundary_cross'],
      },
      {
        counselor: '抱歉，刚才那句不合适。我们在这里谈就好，我在这里是安全的。',
        visitor: '嗯，这样我反而更放心。',
        targets: ['boundary_cross'],
      },
      {
        counselor: '你能直接说出不安，这很不容易，我看到你的努力。',
        visitor: '我以前不敢说这种话。',
        targets: ['affirmation'],
      },
      {
        counselor: '担心给对方添麻烦，很多人都会这样，这很正常。',
        visitor: '原来不是我太敏感。',
        targets: ['normalization'],
      },
      {
        counselor: '单独约你出去这种事我不会做，我们保持在这里见面。',
        visitor: '好，那我们就按你说的来。',
        targets: ['boundary_cross'],
      },
      {
        counselor: '你今天做的已经很好，能把这些说出来本身就很重要。',
        visitor: '谢谢，我感觉踏实一点了。',
        targets: ['affirmation'],
      },
    ],
  },
  {
    slug: 'normalization_shame_cycle',
    title: '去羞耻化：反复自我指责的来访',
    summary: '来访反复自责，咨询师连续做正常化 —— 观察 normalization 在 cap 下的累积。',
    turns: [
      {
        counselor: '这种情况很常见，很多人都会在犯错之后反复回放。',
        visitor: '我一直觉得自己太蠢了。',
        targets: ['normalization'],
      },
      {
        counselor: '这很正常，并不是你一个人的问题。',
        visitor: '可我总觉得别人不会像我这样。',
        targets: ['normalization'],
      },
      {
        counselor: '你能把这种羞耻讲出来，这很不容易。',
        visitor: '说出来好像轻一点。',
        targets: ['affirmation'],
      },
      {
        counselor: '换作别人，通常也会先责备自己。这不奇怪。',
        visitor: '你这么说我有点意外。',
        targets: ['normalization'],
      },
      {
        counselor: '你已经很努力了，我看到你的努力。',
        visitor: '我很久没听到这种话了。',
        targets: ['affirmation'],
      },
    ],
  },
  {
    slug: 'affirmation_progress_tracking',
    title: '肯定进步：小步也算进步',
    summary: '咨询师逐轮肯定来访的微小行动 —— 观察 affirmation 单算子轮的幅度。',
    turns: [
      {
        counselor: '你今天能按时吃饭，做得不错。',
        visitor: '这算进步吗？我觉得很小。',
        targets: ['affirmation'],
      },
      {
        counselor: '这是你的进步，能坚持三天已经不容易。',
        visitor: '那我先试着坚持一周。',
        targets: ['affirmation'],
      },
      {
        counselor: '你很勇敢，愿意把失败的那部分也说出来。',
        visitor: '我怕说出来你会觉得我矫情。',
        targets: ['affirmation'],
      },
      {
        counselor: '很多人都会怕被评判，这很正常。',
        visitor: '那我就说了。',
        targets: ['normalization'],
      },
      {
        counselor: '你做得已经很好，我看到你的努力。',
        visitor: '我想再试试看。',
        targets: ['affirmation'],
      },
    ],
  },
  {
    slug: 'mixed_boundary_and_normalization',
    title: '混合：越界关心 + 正常化 + 肯定',
    summary: '三类算子交错出现，用来检验多算子同轮合并时台账的拆分口径。',
    turns: [
      {
        counselor: '这很正常，很多人都会在夜里想这些。',
        visitor: '我也知道，可就是停不下来。',
        targets: ['normalization'],
      },
      {
        counselor: '我能理解，我也有类似的时候。',
        visitor: '你也会这样？',
        targets: ['boundary_cross'],
      },
      {
        counselor: '你今天能把这些讲清楚，很勇敢。',
        visitor: '讲完有点累。',
        targets: ['affirmation'],
      },
      {
        counselor: '要不我们私下联系，我平时也会看消息。',
        visitor: '我还是希望就在这里谈。',
        targets: ['boundary_cross'],
      },
      {
        counselor: '听懂你的顾虑了，这很正常，并不是你一个人会这样想。',
        visitor: '嗯，那继续在这里吧。',
        targets: ['normalization'],
      },
      {
        counselor: '你做得已经很好，能说出自己的边界。',
        visitor: '我第一次这么直接。',
        targets: ['affirmation'],
      },
    ],
  },
];

const SESSION_PREFIX = 'debug_scripted_af448_';

export interface GenerateOptions {
  readonly dir: string;
  readonly apply: boolean;
}

/**
 * 生成剧本语料。
 *
 * @param {GenerateOptions} options
 * @returns {{ files: string[], perOperator: Record<string, number>, turns: number }}
 */
export function generateScriptedCorpus(options: GenerateOptions) {
  const classifier = new RuleBasedClassifier({ semantics: 'v2' });
  const perOperator: Record<string, number> = {};
  const files: string[] = [];
  let turns = 0;

  for (const [index, scenario] of SCRIPTED_SCENARIOS.entries()) {
    const sessionId = `${SESSION_PREFIX}${index + 1}`;
    const now = new Date().toISOString();
    const messages: Record<string, unknown>[] = [];
    const traces: Record<string, unknown>[] = [];

    for (const [turnIndex, turn] of scenario.turns.entries()) {
      turns += 1;
      const events = classifier.classify(turn.counselor, { sessionId });
      const delta = aggregateTurnDelta(events);
      for (const event of events) {
        perOperator[event.kind] = (perOperator[event.kind] ?? 0) + 1;
      }
      messages.push({ role: 'counselor', text: turn.counselor, turnIndex, ts: now });
      messages.push({ role: 'visitor', text: turn.visitor, turnIndex, ts: now });
      traces.push({
        turnIndex,
        deltaDetail: { events: events.map((event) => event.kind), ...delta },
      });
    }

    const payload = {
      id: sessionId,
      title: scenario.title,
      titleSource: 'script',
      characterSlug: 'scripted_af448',
      characterLabel: '剧本角色（AF-448）',
      createdAt: now,
      updatedAt: now,
      status: 'completed',
      turnCount: scenario.turns.length,
      // AF-451：把落盘时的内核 delta 表指纹写进会话，让合成语料也能按内核版本追溯（表四分桶依据）
      kernelRef: KERNEL_REF,
      synthetic: true,
      generationMethod: 'rule-track-scripted-replay',
      scriptedScenario: scenario.slug,
      scriptedSummary: scenario.summary,
      note: '本会话由 AF-448 剧本 + 生产同款规则分类器生成，不是真实用户会话；不得用于临床结论。',
      messages,
      traces,
    };

    if (options.apply) {
      const target = path.join(options.dir, `${sessionId}.json`);
      fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      files.push(path.relative(process.cwd(), target));
    } else {
      files.push(`${sessionId}.json（dry-run 未写入）`);
    }
  }

  return { files, perOperator, turns };
}

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const dirFlag = argv.indexOf('--dir');
const dir = dirFlag >= 0 ? argv[dirFlag + 1] : 'data/debug-sessions';

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法：tsx scripts/ops/quality/af448-scripted-corpus.ts [--apply] [--dir <目录>]');
  process.exit(0);
}

const result = generateScriptedCorpus({ dir, apply });
console.log(`[af448] 场景=${SCRIPTED_SCENARIOS.length} 咨询师轮=${result.turns} 写入=${apply ? '是' : '否（dry-run）'}`);
console.log(`[af448] 靶向算子命中：${JSON.stringify(result.perOperator)}`);
const missing = ['normalization', 'affirmation', 'boundary_cross'].filter((kind) => !result.perOperator[kind]);
console.log(missing.length === 0 ? '[af448] 三类零语料算子均已命中' : `[af448] 未命中：${missing.join(', ')}`);
for (const file of result.files) console.log(`[af448] ${file}`);
if (!apply) console.log('[af448] 加 --apply 才写盘（data/debug-sessions 已 gitignore）');
