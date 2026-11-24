// AF-462: 来访者语域指纹 —— 结构校验 / 有限漂移 / 灰度 / 确定性指标.
import {
  VISITOR_SPEECH_REGISTER_CALIBRATION,
  VISITOR_SPEECH_REGISTER_ROLE_KEYS,
  auditSpeechRegisterConfig,
  getVisitorSpeechRegister,
  measureSpeechRegisterFit,
  parseSpeechRegister,
  renderSpeechRegisterBlock,
  resolveCurrentRegister,
  selectSpeechRegister,
  validateSpeechRegister,
} from '../../../src/shared/speech-register/index.js';

describe('AF-462 · speech register', () => {
  it('10 条标定全部通过 schema, 角色 key 可反查', () => {
    expect(VISITOR_SPEECH_REGISTER_CALIBRATION).toHaveLength(10);
    expect(VISITOR_SPEECH_REGISTER_ROLE_KEYS).toHaveLength(10);
    for (const register of VISITOR_SPEECH_REGISTER_CALIBRATION) {
      expect(validateSpeechRegister(register)).toBeNull();
      expect(getVisitorSpeechRegister(register.roleKey)).toBe(register);
    }
    expect(getVisitorSpeechRegister('vpt_not_calibrated')).toBeUndefined();
  });

  it('评价性标签在入库前被拒', () => {
    const base = getVisitorSpeechRegister('vpt_grief_avoidance_l1');
    expect(base).toBeDefined();
    const dirty = { ...base, identity: { ...base!.identity, livingStatus: '农村人' } };
    expect(parseSpeechRegister(dirty)).toBeNull();
  });

  it('off / audit / active 三种灰度行为分明', () => {
    const base = getVisitorSpeechRegister('vpt_intimate_avoidance_l1');
    expect(selectSpeechRegister(base, 'vpt_intimate_avoidance_l1', {})).toEqual({ mode: 'off', reason: 'off' });

    const audit = selectSpeechRegister(base, 'vpt_intimate_avoidance_l1', { VISITOR_REGISTER_MODE: 'audit' });
    expect(audit.register).toBeUndefined();
    expect(audit.audit?.roleKey).toBe('vpt_intimate_avoidance_l1');

    expect(
      selectSpeechRegister(base, 'vpt_intimate_avoidance_l1', {
        VISITOR_REGISTER_MODE: 'active',
        VISITOR_REGISTER_PILOT_IDS: 'vpt_grief_avoidance_l1',
      }),
    ).toMatchObject({ mode: 'active', reason: 'not_in_pilot' });

    expect(
      selectSpeechRegister(base, 'vpt_intimate_avoidance_l1', {
        VISITOR_REGISTER_MODE: 'active',
        VISITOR_REGISTER_PILOT_IDS: 'vpt_grief_avoidance_l1 vpt_intimate_avoidance_l1',
      }).register,
    ).toBe(base);
  });

  it('风险轮压制方言词/术语/正例, 教育地域锚点不漂移', () => {
    const base = getVisitorSpeechRegister('vpt_grief_avoidance_l1');
    expect(base).toBeDefined();
    const current = resolveCurrentRegister(base!, {
      emotion: { label: 'anxious' as const, valence: -0.6, arousal: 0.8 },
      resistance: { verbal: 0.8, depth: 0.8, style: 0.5 },
      riskLevel: 'high',
    });
    expect(current.signatureLexicon).toEqual([]);
    expect(current.sampleLines).toEqual([]);
    expect(current.vocabulary.jargonBudget).toBe(0);
    expect(current.dialectStrength).toBe(base!.dialectStrength);
    expect(current.identity).toEqual(base!.identity);
    expect(current.anchors).toEqual(base!.anchors);
    expect(current.vocabulary.concreteAnchorDensity).toBeGreaterThan(base!.vocabulary.concreteAnchorDensity);
    expect(current.syntax.averageSentenceLength).toBeLessThan(base!.syntax.averageSentenceLength);
  });

  it('渲染块不含角色代号/枚举/评价标签, 且长度可控', () => {
    const base = getVisitorSpeechRegister('vpt_grief_avoidance_l1');
    expect(base).toBeDefined();
    const block = renderSpeechRegisterBlock(base!);
    expect(block).toContain('只影响用词');
    expect(block).not.toContain(base!.roleKey);
    expect(block).not.toContain('高中');
    expect(block).not.toContain('农村人');
    expect(block).not.toContain('文化水平低');
    expect(block.length).toBeLessThanOrEqual(460);
  });

  it('配置审计不给每条标定报错, 确定性指标可比较', () => {
    for (const register of VISITOR_SPEECH_REGISTER_CALIBRATION) {
      const audit = auditSpeechRegisterConfig(register);
      expect(audit.warnings).not.toContain('rendered_block_too_long');
      expect(audit.warnings).not.toContain('anchors_empty');
      expect(audit.warnings).not.toContain('avoid_lexicon_empty');
    }

    const base = getVisitorSpeechRegister('vpt_intimate_avoidance_l1');
    const concrete = measureSpeechRegisterFit('昨天又加班到十点，回去连外卖都没拆。', base!);
    const abstract = measureSpeechRegisterFit('从关系模式和内在需求层面看，我的情绪状态有结构性问题。', base!);
    expect(abstract.abstractTermRate).toBeGreaterThan(concrete.abstractTermRate);
    expect(concrete.anchorDensity).toBeGreaterThan(0);
  });
});
