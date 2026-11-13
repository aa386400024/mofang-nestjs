// V2026-11-12 建立 (D-1 取证 · 规则轨漏判率离线取证 · 单测):
//   覆盖开工单 §3.1-3 的两组:
//     ① 纯逻辑模块单测 —— 投影白名单 / 降级过滤 / 标签展开 / precision·recall /
//        两向误吞率 / Wilson 区间 / CSV 契约 / 分层抽样 / 机器候选标签;
//     ② **规则轨基线快照** (预研风险 F: 规则轨分类器此前**没有专属 spec**) ——
//        固定构造语料 → RuleBasedClassifier.classify 的**逐字**事件序列锁定旧口径,
//        作为后续模型轨 / D-2 改动的零回归锚.
//
//   ⚠️ 语料纪律: 快照语料全部是**构造句**, 不含任何真实逐字稿原文 ——
//     既守隐私红线, 也保证语料在版本库里稳定可读.
//
//   验证: pnpm exec vitest run test/quality/d1-event-classifier-evidence.spec.ts

import { describe, expect, it } from 'vitest';

import {
  HUMAN_LABEL_VOCABULARY,
  MACHINE_CANDIDATE_NOTE,
  NEGATIVE_LEXICON_KINDS,
  bucketize,
  buildAnnotationCsv,
  buildProjectionCsv,
  buildSampleCsv,
  charBucket,
  computeLabelAgreement,
  computeRuleTrackBaseline,
  isNeutralOnly,
  machineCandidateLabel,
  parseAnnotationLabels,
  projectTranscript,
  segmentOf,
  stratifiedSample,
  turnKey,
  wilsonInterval,
  type ProjectedTurn,
  type RawTranscript,
} from '../../scripts/ops/quality/d1-event-classifier-evidence.lexicon.js';
import { RuleBasedClassifier } from '../../src/engine-core/cognition/rule-based-classifier.js';

/** 构造一条投影行 (统计用例用, 不依赖真实语料). */
function turn(overrides: Partial<ProjectedTurn> & { readonly turnIndex: number }): ProjectedTurn {
  return {
    debugSessionId: 'debug_test',
    characterSlug: 'vpt_general_secure_l1',
    counselorModeId: 'expert',
    eventTags: ['neutral'],
    degraded: false,
    crisis: false,
    charBucket: '6-15',
    segment: 'middle',
    neutralRunLength: 1,
    ...overrides,
  };
}

/** 构造一份逐字稿 (白名单字段 + 若干禁止字段, 用来验证投影不碰它们). */
function transcript(overrides: Partial<RawTranscript> = {}): RawTranscript {
  return {
    id: 'debug_test',
    characterSlug: 'vpt_general_secure_l1',
    messages: [
      { role: 'counselor', text: '我在这儿听着，你慢慢说。', turnIndex: 1 },
      { role: 'visitor', text: '来访者的原话, 不该出现在任何输出里。', turnIndex: 1 },
    ],
    traces: [
      { turnIndex: 1, eventTags: ['neutral'], degraded: false, crisis: { detected: false } },
      { turnIndex: 2, eventTags: ['empathy'], degraded: false, crisis: { detected: false } },
    ],
    ...overrides,
  };
}

describe('D-1 取证 · 规则轨漏判率离线取证', () => {
  describe('① 投影白名单 (隐私红线)', () => {
    it('投影结果只含白名单字段, 不含原文 / renderSpec / kernelState / 展示名', () => {
      const projected = projectTranscript({
        transcript: transcript({
          title: '展示名不该出现',
          characterLabel: '角色展示名',
          renderSpec: { promptFull: 'prompt 全文不该出现' },
          kernelState: { snapshot: { trust: 0.5 } },
        } as Partial<RawTranscript>),
        debugSessionId: 'debug_test',
        counselorModeId: 'cold',
      });
      const keys = [...new Set(projected.flatMap((row) => Object.keys(row)))].sort();
      expect(keys).toEqual([
        'charBucket',
        'characterSlug',
        'counselorModeId',
        'crisis',
        'debugSessionId',
        'degraded',
        'eventTags',
        'neutralRunLength',
        'segment',
        'turnIndex',
      ]);
    });

    it('咨询师原文不出现在投影结构与序列化结果里', () => {
      const projected = projectTranscript({ transcript: transcript(), debugSessionId: 'debug_test' });
      const serialized = JSON.stringify(projected);
      expect(serialized).not.toContain('我在这儿听着');
      expect(serialized).not.toContain('来访者的原话');
      expect(projected.map((row) => row.charBucket)).toEqual(['6-15', '0']);
    });

    it('模式列来自外部血缘, 取不到时留空 (不猜)', () => {
      const withMode = projectTranscript({
        transcript: transcript(),
        debugSessionId: 'debug_test',
        counselorModeId: 'cold',
      });
      const withoutMode = projectTranscript({ transcript: transcript(), debugSessionId: 'debug_test' });
      expect(withMode[0]?.counselorModeId).toBe('cold');
      expect(withoutMode[0]?.counselorModeId).toBe('');
    });
  });

  describe('② 降级过滤与规则轨基线', () => {
    it('基线: 总轮 / 降级轮 / 有效轮 / neutral 计数', () => {
      const turns = [
        turn({ turnIndex: 1, eventTags: ['neutral'], degraded: true }),
        turn({ turnIndex: 2, eventTags: ['neutral'] }),
        turn({ turnIndex: 3, eventTags: ['empathy'] }),
      ];
      const baseline = computeRuleTrackBaseline(turns);
      expect(baseline.totalTurns).toBe(3);
      expect(baseline.degradedTurns).toBe(1);
      expect(baseline.eligibleTurns).toBe(2);
      expect(baseline.neutralTurns).toBe(2);
      expect(baseline.neutralRate).toBe(1);
    });

    it('neutral 误吞上界 = neutral 轮 / 有效轮 (降级轮不进分母)', () => {
      const turns = [
        turn({ turnIndex: 1, eventTags: ['neutral'], degraded: true }),
        turn({ turnIndex: 2, eventTags: ['neutral'] }),
        turn({ turnIndex: 3, eventTags: ['empathy'] }),
        turn({ turnIndex: 4, eventTags: ['empathy', 'open_probe'] }),
      ];
      const baseline = computeRuleTrackBaseline(turns);
      expect(baseline.neutralTurns).toBe(2);
      expect(baseline.eligibleTurns).toBe(3);
      expect(baseline.neutralRate).toBeCloseTo(2 / 3, 6);
      expect(baseline.multiTagTurns).toBe(1);
      expect(baseline.zeroTagTurns).toBe(0);
    });

    it('标签实例按"每轮每类"展开 (一轮两标签记两件)', () => {
      const baseline = computeRuleTrackBaseline([
        turn({ turnIndex: 1, eventTags: ['empathy', 'open_probe'] }),
        turn({ turnIndex: 2, eventTags: ['neutral'] }),
      ]);
      expect(baseline.tagCounts.get('empathy')).toBe(1);
      expect(baseline.tagCounts.get('open_probe')).toBe(1);
      expect(baseline.tagCounts.get('neutral')).toBe(1);
      // 正向事件率按**实例数 / 有效轮数** (与 batch-metrics 的 event.positive.rate 同口径:
      // 一轮两标签记两件), 分母用有效轮 (降级轮已剔).
      expect(baseline.positiveEventRate).toBeCloseTo(1, 6);
    });

    it('分组统计: 按模式 / 角色 / 轮次段', () => {
      const turns = [
        turn({ turnIndex: 1, counselorModeId: 'cold', characterSlug: 'a', segment: 'tail' }),
        turn({ turnIndex: 2, counselorModeId: 'expert', characterSlug: 'b', segment: 'head' }),
      ];
      const baseline = computeRuleTrackBaseline(turns);
      expect(baseline.byMode.get('cold')?.turns).toBe(1);
      expect(baseline.byMode.get('expert')?.turns).toBe(1);
      expect(baseline.byCharacter.get('a')?.turns).toBe(1);
      expect(baseline.bySegment.get('tail')?.turns).toBe(1);
      expect(baseline.sessions).toBe(1);
    });

    it('负向词事件率只算静态词表的 4 类负向 (不含 sensitive_touch)', () => {
      expect([...NEGATIVE_LEXICON_KINDS].toSorted()).toEqual(['boundary_cross', 'judgment', 'minimizing', 'preaching']);
      const baseline = computeRuleTrackBaseline([
        turn({ turnIndex: 1, eventTags: ['sensitive_touch'] }),
        turn({ turnIndex: 2, eventTags: ['judgment'] }),
      ]);
      expect(baseline.negativeEventRate).toBeCloseTo(0.5, 6);
    });

    it('bucketize 的降级轮不进有效分母', () => {
      const buckets = bucketize([turn({ turnIndex: 1, degraded: true }), turn({ turnIndex: 2 })], () => 'k');
      const bucket = buckets.get('k');
      expect(bucket?.turns).toBe(2);
      expect(bucket?.degradedTurns).toBe(1);
      expect(bucket?.eligibleTurns).toBe(1);
    });
  });

  describe('③ 人工标注对照: precision / recall 与两向漏判', () => {
    it('逐类 precision / recall 计算正确', () => {
      const turns = [
        turn({ turnIndex: 1, eventTags: ['empathy'] }),
        turn({ turnIndex: 2, eventTags: ['empathy'] }),
        turn({ turnIndex: 3, eventTags: ['neutral'] }),
      ];
      const labels = new Map([
        ['debug_test#1', 'empathy'],
        ['debug_test#2', 'holding_present'],
        ['debug_test#3', 'cold_absent'],
      ]);
      const agreement = computeLabelAgreement(turns, labels);
      const empathy = agreement.perKind.find((kind) => kind.kind === 'empathy');
      expect(empathy?.support).toBe(1);
      expect(empathy?.ruleCount).toBe(2);
      expect(empathy?.truePositive).toBe(1);
      expect(empathy?.falsePositive).toBe(1);
      expect(empathy?.falseNegative).toBe(0);
      expect(empathy?.precision).toBeCloseTo(0.5, 6);
      expect(empathy?.recall).toBeCloseTo(1, 6);
    });

    it('两向漏判率分开统计 (漏正向 / 漏负向)', () => {
      const turns = [
        turn({ turnIndex: 1, eventTags: ['neutral'] }),
        turn({ turnIndex: 2, eventTags: ['neutral'] }),
        turn({ turnIndex: 3, eventTags: ['empathy'] }),
      ];
      const labels = new Map([
        ['debug_test#1', 'holding_present'],
        ['debug_test#2', 'cold_absent'],
        ['debug_test#3', 'neutral'],
      ]);
      const agreement = computeLabelAgreement(turns, labels);
      expect(agreement.swallow.holdingPresent.labeled).toBe(1);
      expect(agreement.swallow.holdingPresent.swallowed).toBe(1);
      expect(agreement.swallow.holdingPresent.rate).toBe(1);
      expect(agreement.swallow.coldAbsent.labeled).toBe(1);
      expect(agreement.swallow.coldAbsent.swallowed).toBe(1);
      expect(agreement.swallow.coldAbsent.rate).toBe(1);
    });

    it('误吞分解: 规则轨判 neutral 的已标注轮, 人工判成了什么', () => {
      const turns = [
        turn({ turnIndex: 1, eventTags: ['neutral'] }),
        turn({ turnIndex: 2, eventTags: ['neutral'] }),
        turn({ turnIndex: 3, eventTags: ['neutral'] }),
      ];
      const labels = new Map([
        ['debug_test#1', 'holding_present'],
        ['debug_test#2', 'cold_absent'],
        ['debug_test#3', 'neutral'],
      ]);
      const agreement = computeLabelAgreement(turns, labels);
      expect(agreement.neutralRuleLabeled).toBe(3);
      expect(agreement.neutralRuleBreakdown.get('holding_present')).toBe(1);
      expect(agreement.neutralRuleBreakdown.get('cold_absent')).toBe(1);
      expect(agreement.neutralRuleBreakdown.get('neutral')).toBe(1);
    });

    it('未标注轮不计入任何对照指标', () => {
      const turns = [turn({ turnIndex: 1, eventTags: ['neutral'] })];
      const agreement = computeLabelAgreement(turns, new Map());
      expect(agreement.labeledTurns).toBe(0);
      expect(agreement.unlabeledTurns).toBe(1);
      expect(agreement.swallow.holdingPresent.rate).toBeNull();
      expect(agreement.swallow.coldAbsent.rate).toBeNull();
    });

    it('人工标签词表 = 规则轨 11 类 + 两类在场标签', () => {
      expect(HUMAN_LABEL_VOCABULARY).toContain('neutral');
      expect(HUMAN_LABEL_VOCABULARY).toContain('empathy');
      expect(HUMAN_LABEL_VOCABULARY).toContain('holding_present');
      expect(HUMAN_LABEL_VOCABULARY).toContain('cold_absent');
      expect(HUMAN_LABEL_VOCABULARY).toHaveLength(13);
    });
  });

  describe('④ Wilson 精确区间 (稀有类不做点估计)', () => {
    it('0 命中 / 30 次的 95% 上界 ≈ 0.1135', () => {
      const interval = wilsonInterval(0, 30);
      expect(interval.lower).toBe(0);
      expect(interval.upper).toBeCloseTo(0.1135, 3);
    });

    it('30 / 30 的下界 ≈ 0.8865, 上界夹到 1', () => {
      const interval = wilsonInterval(30, 30);
      expect(interval.lower).toBeCloseTo(0.8865, 3);
      expect(interval.upper).toBe(1);
    });

    it('分母为 0 时区间退化为 0 (不报 NaN)', () => {
      const interval = wilsonInterval(0, 0);
      expect(interval.lower).toBe(0);
      expect(interval.upper).toBe(0);
    });

    it('区间包住点估计', () => {
      const interval = wilsonInterval(994, 1112);
      const point = 994 / 1112;
      expect(interval.lower).toBeLessThan(point);
      expect(interval.upper).toBeGreaterThan(point);
    });
  });

  describe('⑤ CSV 契约 (只出码 / 计数 / 标签 / 归一化字符数桶)', () => {
    it('标注骨架列头固定为任务单约定的九列', () => {
      const csv = buildAnnotationCsv([{ turn: turn({ turnIndex: 1 }), stratum: 'expert|a|middle', machineCandidate: 'unclear' }]);
      expect(csv.split('\n', 1)[0]).toBe(
        'debug_session_id,turn_index,character_slug,counselor_mode_id,event_tags,degraded,machine_candidate,human_label,note',
      );
    });

    it('标注骨架: human_label 留空, note 标注"候选待主控复核"', () => {
      const csv = buildAnnotationCsv([{ turn: turn({ turnIndex: 1 }), stratum: 'expert|a|middle', machineCandidate: 'cold_absent?' }]);
      const row = csv.split('\n', 2)[1] ?? '';
      expect(row.endsWith(`,,${MACHINE_CANDIDATE_NOTE}`)).toBe(true);
      expect(row).toContain('cold_absent?');
    });

    it('投影 CSV 不含任何原文, 只有桶与标签', () => {
      const csv = buildProjectionCsv(projectTranscript({ transcript: transcript(), debugSessionId: 'debug_test' }));
      expect(csv).not.toContain('我在这儿听着');
      expect(csv).not.toContain('来访者的原话');
      expect(csv.split('\n', 1)[0]).toContain('char_bucket');
      expect(csv.split('\n', 1)[0]).not.toContain('text');
    });

    it('抽样清单 CSV 带分层与候选标签', () => {
      const csv = buildSampleCsv([{ turn: turn({ turnIndex: 1 }), stratum: 'cold|a|tail', machineCandidate: 'holding_present?' }]);
      expect(csv.split('\n', 1)[0]).toContain('stratum');
      expect(csv).toContain('cold|a|tail');
    });

    it('parseAnnotationLabels 能读回人工填的标签', () => {
      const csv = [
        'debug_session_id,turn_index,character_slug,counselor_mode_id,event_tags,degraded,machine_candidate,human_label,note',
        'debug_a,3,vpt_x,expert,neutral,0,holding_present?,holding_present,',
        'debug_b,4,vpt_y,cold,neutral,0,cold_absent?,,',
      ].join('\n');
      const labels = parseAnnotationLabels(csv);
      expect(labels.get('debug_a#3')).toBe('holding_present');
      expect(labels.get('debug_b#4')).toBeUndefined();
      expect(labels.size).toBe(1);
    });
  });

  describe('⑥ 分层抽样 (cold 富集 + 尾段优先 + 先剔降级轮)', () => {
    it('确定性: 两次调用结果一致', () => {
      const turns = [
        turn({ turnIndex: 1, counselorModeId: 'expert', segment: 'head' }),
        turn({ turnIndex: 2, counselorModeId: 'cold', segment: 'tail' }),
        turn({ turnIndex: 3, counselorModeId: 'cold', segment: 'tail' }),
      ];
      const first = stratifiedSample(turns, 3);
      const second = stratifiedSample(turns, 3);
      expect(first.map((item) => turnKey(item.turn))).toEqual(second.map((item) => turnKey(item.turn)));
    });

    it('cold 模式排在 expert 之前 (富集)', () => {
      const turns = [
        turn({ turnIndex: 1, counselorModeId: 'expert', segment: 'head' }),
        turn({ turnIndex: 2, counselorModeId: 'cold', segment: 'tail' }),
      ];
      const items = stratifiedSample(turns, 1);
      expect(items[0]?.turn.counselorModeId).toBe('cold');
    });

    it('降级轮不进样本', () => {
      const turns = [turn({ turnIndex: 1, degraded: true }), turn({ turnIndex: 2 })];
      const items = stratifiedSample(turns, 5);
      expect(items).toHaveLength(1);
      expect(items[0]?.turn.degraded).toBe(false);
    });

    it('段内优先取尾段 (turnIndex 大的先入)', () => {
      const turns = [
        turn({ turnIndex: 1, counselorModeId: 'cold', segment: 'tail' }),
        turn({ turnIndex: 9, counselorModeId: 'cold', segment: 'tail' }),
      ];
      const items = stratifiedSample(turns, 1);
      expect(items[0]?.turn.turnIndex).toBe(9);
    });
  });

  describe('⑦ 机器候选标签 (只作候选, 不进 precision / recall)', () => {
    it('规则轨命中 → 候选即该类; 多命中标 multi', () => {
      expect(machineCandidateLabel(turn({ turnIndex: 1, eventTags: ['empathy'] }))).toBe('empathy');
      expect(machineCandidateLabel(turn({ turnIndex: 2, eventTags: ['empathy', 'open_probe'] }))).toBe('multi');
    });

    it('neutral + 连续段 + 短句 → cold_absent?', () => {
      const candidate = machineCandidateLabel(turn({ turnIndex: 1, eventTags: ['neutral'], charBucket: '1-5', neutralRunLength: 3 }));
      expect(candidate).toBe('cold_absent?');
    });

    it('neutral + 连续段 + 长句 → holding_present?', () => {
      const candidate = machineCandidateLabel(turn({ turnIndex: 1, eventTags: ['neutral'], charBucket: '41+', neutralRunLength: 2 }));
      expect(candidate).toBe('holding_present?');
    });

    it('neutral + 孤立短句 → 不给候选 (连续性不足, 单轮不作数)', () => {
      const candidate = machineCandidateLabel(turn({ turnIndex: 1, eventTags: ['neutral'], charBucket: '1-5', neutralRunLength: 1 }));
      expect(candidate).toBe('unclear');
    });
  });

  describe('⑧ 辅助口径', () => {
    it('字符数桶分档', () => {
      expect(charBucket(0)).toBe('0');
      expect(charBucket(3)).toBe('1-5');
      expect(charBucket(10)).toBe('6-15');
      expect(charBucket(30)).toBe('16-40');
      expect(charBucket(100)).toBe('41+');
    });

    it('轮次段三分', () => {
      // 12 轮 → 三等分各 4 轮: head 1-4 / middle 5-8 / tail 9-12.
      expect(segmentOf(1, 12)).toBe('head');
      expect(segmentOf(4, 12)).toBe('head');
      expect(segmentOf(5, 12)).toBe('middle');
      expect(segmentOf(8, 12)).toBe('middle');
      expect(segmentOf(9, 12)).toBe('tail');
      expect(segmentOf(12, 12)).toBe('tail');
    });

    it('isNeutralOnly 认的是"只挂了 neutral"', () => {
      expect(isNeutralOnly(turn({ turnIndex: 1, eventTags: ['neutral'] }))).toBe(true);
      expect(isNeutralOnly(turn({ turnIndex: 2, eventTags: [] }))).toBe(true);
      expect(isNeutralOnly(turn({ turnIndex: 3, eventTags: ['empathy'] }))).toBe(false);
    });

    it('turnKey 用场次 id + 轮次号', () => {
      expect(turnKey(turn({ turnIndex: 7 }))).toBe('debug_test#7');
    });
  });

  describe('⑨ 规则轨基线快照 (预研风险 F: 此前无专属 spec)', () => {
    const classifier = new RuleBasedClassifier();

    it('固定语料 → 逐字事件序列锁定旧口径', () => {
      const cases: readonly { readonly text: string; readonly expected: readonly unknown[] }[] = [
        { text: '', expected: [{ kind: 'neutral', matchedTerms: [], strength: 1 }] },
        { text: '今天天气不错', expected: [{ kind: 'neutral', matchedTerms: [], strength: 1 }] },
        {
          text: '你觉得这很难受吗',
          expected: [{ kind: 'empathy', matchedTerms: ['你觉得'], strength: 1 }],
        },
        {
          text: '没关系',
          expected: [{ kind: 'acceptance', matchedTerms: ['没关系'], strength: 1 }],
        },
        {
          text: '这很正常',
          expected: [{ kind: 'normalization', matchedTerms: ['这很正常'], strength: 1 }],
        },
        {
          text: '你觉得呢',
          expected: [
            { kind: 'empathy', matchedTerms: ['你觉得'], strength: 1 },
            { kind: 'open_probe', matchedTerms: ['你觉得呢'], strength: 1 },
          ],
        },
        {
          text: '你很勇敢',
          expected: [{ kind: 'affirmation', matchedTerms: ['你很勇敢'], strength: 1 }],
        },
        {
          text: '你就是想不开',
          expected: [{ kind: 'judgment', matchedTerms: ['你就是想不开'], strength: 1 }],
        },
        {
          text: '我建议你',
          expected: [{ kind: 'preaching', matchedTerms: ['我建议你'], strength: 1 }],
        },
        {
          text: '别想太多',
          expected: [{ kind: 'minimizing', matchedTerms: ['别想太多'], strength: 1 }],
        },
        {
          text: '私下联系',
          expected: [{ kind: 'boundary_cross', matchedTerms: ['私下联系'], strength: 1 }],
        },
      ];
      for (const item of cases) {
        expect(classifier.classify(item.text)).toEqual(item.expected);
      }
    });

    it('敏感议题走上下文词表 (不在静态词典里)', () => {
      expect(classifier.classify('说到童年', { sensitiveTopics: ['童年'] })).toEqual([
        { kind: 'sensitive_touch', matchedTerms: ['童年'], strength: 1 },
      ]);
    });

    it('strength 恒为 1 (模型轨加权的前置假设, 快照锁住)', () => {
      const events = classifier.classify('你觉得这很难受吗');
      expect(events.map((event) => event.strength)).toEqual([1]);
    });

    it('未命中任何规则 → 恰好一条 neutral (吞没点的旧口径)', () => {
      expect(classifier.classify('嗯。')).toEqual([{ kind: 'neutral', matchedTerms: [], strength: 1 }]);
    });
  });
});
