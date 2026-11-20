// V2026-11-20 建立 (AF-200 · 坏咨询师边界压测矩阵):
//   覆盖"只有专家/正常咨询师"这一验收盲区：
//     · 7 种咨询师模式（专家 / 中级 / 新手 / 聊家常 / 冷漠 / 说教 / 胡说八道）
//     · 3 种接触方式（面对面 / 线上语音 / 线上文字）
//   只断言确定性的不变量，不写死模型台词，不依赖真实 LLM：
//     1. 模式 systemPrompt 不被场景块覆盖或吞掉；
//     2. 坏咨询师的合法怪话仍算台词，不被输出闸门误杀；
//     3. 坏咨询师把媒介带偏时，漂移检测与输出闸门必须拦住；
//     4. 正常场景台词不产生误报。
//
//   真实模型批量压测与 AI rubric 评分由后续批次执行；本文件只守确定性边界。

import { describe, expect, it } from 'vitest';

import { CounselorPromptBuilder } from '../../src/auto-practice/counselor/builder/counselor-prompt-builder.js';
import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import { COUNSELOR_MODE_SEEDS, type CounselorModeSeed } from '../../src/auto-practice/seeds/counselor-modes.seed.js';
import { LEGACY_SESSION_PROFILE } from '../../src/auto-practice/session-profile.js';
import { buildEncounterVisitorBlock, detectEncounterDrift, type EncounterInput } from '../../src/shared/encounter/encounter-scene.js';
import { inspectGeneratedOutput } from '../../src/shared/text/output-integrity.js';

/** 本矩阵覆盖的三种接触方式。 */
const SCENES: readonly {
  readonly key: string;
  readonly encounter: EncounterInput;
  readonly sceneMarker: string;
  readonly cleanLine: string;
  readonly driftLine: string;
  readonly driftToken: string;
}[] = [
  {
    key: 'in_person',
    encounter: { mode: 'in_person' },
    sceneMarker: '同一个咨询室',
    cleanLine: '你慢慢说，我在这里，不着急。',
    driftLine: '我把链接发给你，你点开看一下。',
    driftToken: '发给你',
  },
  {
    key: 'online_voice',
    encounter: { mode: 'online', channel: 'voice' },
    sceneMarker: '只通过声音连接',
    cleanLine: '听得到我吗？信号还行的话，我们就从这里开始。',
    driftLine: '我看到你画面里有点紧张，镜头前放松一点。',
    driftToken: '画面',
  },
  {
    key: 'online_text',
    encounter: { mode: 'online', channel: 'text' },
    sceneMarker: '通过文字消息交流',
    cleanLine: '我看到你的消息了，你可以慢慢打，不用一次说完。',
    driftLine: '我们现在面对面坐着，你别紧张。',
    driftToken: '面对面',
  },
];

/**
 * 每种模式在 prompt 里的身份签名。
 *
 * 用途：防止“场景块/纪律块覆盖了人设”，导致聊家常、胡说八道都被洗成同一种专家腔。
 */
const MODE_SIGNATURE: Readonly<Record<string, string>> = {
  expert: '不会评判',
  intermediate: '偶尔会提前给一点建议',
  novice: '经常问封闭式问题',
  chatty: '聊天气、聊周末',
  cold: '不太有情感反应',
  preachy: '你会说"你应该"',
  nonsense: '你吃午饭了吗',
};

/** 坏咨询师模式下的合法怪话：可以跑题、可以冷、可以说教，但不是输出缺陷。 */
const MODE_LEGITIMATE_LINE: Readonly<Record<string, string>> = {
  expert: '我听到你说很累，我们先慢一点。',
  intermediate: '我理解你的感受，也许我们可以再看看这部分。',
  novice: '是这样吗？我可能没太听明白。',
  chatty: '我周末去爬山了，你平时周末都做什么？',
  cold: '嗯。你接着说。',
  preachy: '你应该先想清楚自己到底要什么。',
  nonsense: '你上次说养了只猫，那只猫后来怎么样了？',
};

function toEntity(seed: CounselorModeSeed): CounselorMode {
  const mode = new CounselorMode();
  mode.id = seed.id;
  mode.name = seed.name;
  mode.systemPrompt = seed.systemPrompt;
  mode.description = seed.description;
  mode.enabled = 1;
  mode.sortOrder = seed.sortOrder;
  return mode;
}

describe('AF-200 · 咨询师模式 × 接触方式确定性矩阵', () => {
  it('7 种模式 × 3 种场景：人设签名保留，场景块正确挂载', () => {
    const builder = new CounselorPromptBuilder();
    let combinations = 0;

    for (const seed of COUNSELOR_MODE_SEEDS) {
      const mode = toEntity(seed);
      const signature = MODE_SIGNATURE[seed.id];
      expect(signature, `模式 ${seed.id} 缺少身份签名，矩阵会失去区分力`).toBeDefined();

      for (const scene of SCENES) {
        const prompt = builder.build(mode, false, LEGACY_SESSION_PROFILE, 1, { encounter: scene.encounter });
        combinations += 1;

        expect(prompt.startsWith(seed.systemPrompt), `${seed.id}/${scene.key} 人设被场景块覆盖`).toBe(true);
        expect(prompt, `${seed.id}/${scene.key} 人设签名丢失`).toContain(signature);
        expect(prompt, `${seed.id}/${scene.key} 场景块未挂载`).toContain(scene.sceneMarker);
      }
    }

    expect(combinations).toBe(COUNSELOR_MODE_SEEDS.length * SCENES.length);
    expect(COUNSELOR_MODE_SEEDS).toHaveLength(7);
  });

  it('来访者侧场景契约独立于咨询师模式：7 种模式共用同一份接触方式约束', () => {
    for (const scene of SCENES) {
      const block = buildEncounterVisitorBlock(scene.encounter);
      expect(block).toContain(scene.sceneMarker);
      expect(block).toContain('不可自行改变');
    }
  });

  it('坏咨询师的合法怪话不被输出闸门误杀', () => {
    for (const seed of COUNSELOR_MODE_SEEDS) {
      const line = MODE_LEGITIMATE_LINE[seed.id];
      expect(line, `模式 ${seed.id} 缺少合法怪话样本`).toBeDefined();

      for (const scene of SCENES) {
        const verdict = inspectGeneratedOutput(line, 'counselor', scene.encounter);
        expect(verdict.invalid, `${seed.id}/${scene.key} 误杀合法怪话: ${verdict.reasons.join(',')}`).toBe(false);
      }
    }
  });

  it('坏咨询师把媒介带偏时，漂移检测必须命中当前场景的冲突词', () => {
    for (const seed of COUNSELOR_MODE_SEEDS) {
      for (const scene of SCENES) {
        const hits = detectEncounterDrift(scene.driftLine, scene.encounter);
        expect(hits, `${seed.id}/${scene.key} 未拦住跨场景媒介词`).toContain(scene.driftToken);
      }
    }
  });

  it('输出闸门对跨场景台词给出 scene_drift，而不是只靠模型自觉', () => {
    for (const scene of SCENES) {
      const verdict = inspectGeneratedOutput(scene.driftLine, 'counselor', scene.encounter);
      expect(verdict.invalid).toBe(true);
      expect(verdict.reasons).toContain('scene_drift');
    }
  });

  it('正常场景台词不产生误报', () => {
    for (const scene of SCENES) {
      const verdict = inspectGeneratedOutput(scene.cleanLine, 'visitor', scene.encounter);
      expect(verdict.invalid, `${scene.key} 正常台词被误杀: ${verdict.reasons.join(',')}`).toBe(false);
      expect(verdict.sceneDrift).toEqual([]);
    }
  });

  it('线上缺省语音，视频必须显式选择', () => {
    const voice = inspectGeneratedOutput('我这边听得到你，信号还可以。', 'visitor', { mode: 'online' });
    expect(voice.invalid).toBe(false);

    const video = inspectGeneratedOutput('我看到你画面里有点紧张。', 'visitor', { mode: 'online', channel: 'video' });
    expect(video.invalid).toBe(false);

    const voiceAsDefault = inspectGeneratedOutput('我看到你画面里有点紧张。', 'visitor', { mode: 'online' });
    expect(voiceAsDefault.invalid).toBe(true);
    expect(voiceAsDefault.reasons).toContain('scene_drift');
  });
});
