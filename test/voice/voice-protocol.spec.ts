// V2026-10-23 治本 (全真语音 vpt · TTS 协议纯函数单测):
//   原因: 本期新引入的纯函数里有三处"不靠运行就能测、但一旦错了后果很大"的不变量:
//     ① **切句标点集必须与官方逐字一致** (src/voice/tts/tts-sentence-splitter.ts)
//        官方《双向流式语音合成》的攒句规则: 句末标点 `。！？…；!?.` + 换行 → **立即**合成;
//        次级标点 `，、：,;:` → 攒够长度才切.
//        本端若把某个标点切早/切晚, 就会与官方攒句错位 —— 最坏情况是本端切走句末标点后,
//        官方缓冲区里只剩一个不触发合成的尾巴 → **那句永远不播** (静默卡死).
//        这个坑真实发生过一次 (把 ASCII `;` 当句末标点), 所以用测试锁死.
//     ② **握手归一的三态** (style: 合法覆盖 / 映射不上→mixed / 未提供→模板缺省)
//        spec §2.2 与 §5.2 要求"映射不上统一回退 mixed", 与"未提供用模板缺省"是两种语义;
//        混了会出现"用户传了乱值, 却被静默换成模板默认人物".
//     ③ **上游状态码 → 业务码 + retryable 的唯一映射** (tts-error.mapper.ts)
//        1004 重试一万次也没用, 2205 重连反而丢上下文 —— 判错就是重试风暴或整轮卡死.
//     这三类都是**纯函数**, 无 DI / 无 DB / 不发网络, 因此不需要起应用就能测.
//
//   范围说明: 带 DI 的部分 (WS 握手真连 / TTS 真连上游 / DB 模板查询) 不在本文件覆盖范围 ——
//     那些依赖真实环境与账号, 按项目惯例走人工联调 (见 docs/specs/ 主稿 §7).
//
//   验证:
//     1. npx jest test/voice/voice-protocol.spec.ts 全绿
//     2. 故意把切句器里的 `;` 加进 SENTENCE_TERMINATORS → "ASCII 分号不切句"用例变红
//     3. 故意把 resolveVoicePreset 的 styleUnmapped 分支删掉 → "映射不上回退 mixed"用例变红
//
//   时间戳: 2026-10-23
import { splitSentences } from '../../src/voice/tts/tts-sentence-splitter';
import { mapTtsUpstreamError } from '../../src/voice/tts/tts-error.mapper';
import { buildTtsBidiUrl } from '../../src/voice/tts/tts-protocol.config';
import { parseVoiceHandshake, resolveVoicePreset } from '../../src/voice/voice-handshake';
import type { VoiceTemplateSummary } from '../../src/voice/voice-session.types';

/** 官方明确定义的句末标点 (文档原文: `。！？…；!?.` 及换行). */
const OFFICIAL_SENTENCE_TERMINATORS = ['。', '！', '？', '…', '；', '!', '?', '.'];
/** 官方次级标点 (文档原文: `，、：,;:`) —— 它们**不**触发立即合成. */
const OFFICIAL_SECONDARY_PUNCTUATIONS = ['，', '、', '：', ',', ';', ':'];

describe('TTS 切句 · 官方攒句标点集一致性', () => {
  it.each(OFFICIAL_SENTENCE_TERMINATORS)('句末标点 %s 触发立即成句', (terminator) => {
    const result = splitSentences(`你最近怎么样${terminator}还行`, 100);

    expect(result.sentences).toEqual([`你最近怎么样${terminator}`]);
    expect(result.rest).toBe('还行');
  });

  it('换行也算句末标点', () => {
    const result = splitSentences('第一行\n第二行', 100);

    expect(result.sentences).toEqual(['第一行\n']);
    expect(result.rest).toBe('第二行');
  });

  it.each(OFFICIAL_SECONDARY_PUNCTUATIONS)('次级标点 %s 不触发成句 (由官方攒够长度才切)', (punctuation) => {
    const result = splitSentences(`好的${punctuation}还行吧`, 100);

    expect(result.sentences).toEqual([]);
    expect(result.rest).toBe(`好的${punctuation}还行吧`);
  });

  it('ASCII 分号 (;) 绝不能被当句末标点 —— 切早会让官方那句永不合成', () => {
    const result = splitSentences('他说;然后走了', 100);

    expect(result.sentences).toEqual([]);
    expect(result.rest).toBe('他说;然后走了');
  });

  it('连续标点 (…… / ？！) 算**一个**句末, 不拆成两句', () => {
    expect(splitSentences('真的吗……', 100).sentences).toEqual(['真的吗……']);
    expect(splitSentences('真的吗？！', 100).sentences).toEqual(['真的吗？！']);
  });

  it('纯空白不成句 (官方会静默丢弃, 本端也不必单独成句)', () => {
    const result = splitSentences('   ', 100);

    expect(result.sentences).toEqual([]);
  });

  it('超长句强制切分, 且优先在次级标点处断 (不把词劈开)', () => {
    const long = `${'啊'.repeat(60)}，${'嗯'.repeat(60)}`;
    const result = splitSentences(long, 100);

    expect(result.sentences.length).toBeGreaterThanOrEqual(1);
    for (const sentence of result.sentences) {
      expect(sentence.length).toBeLessThanOrEqual(100);
    }
    // 第一段在逗号处断开 → 尾巴是完整的逗号句, 不是被硬切碎的
    expect(result.sentences[0]?.endsWith('，')).toBe(true);
  });

  it('切句不丢字 (句 + 残余 = 原串) —— 丢字就是来访者话说一半没了', () => {
    const cases = [
      '你最近怎么样？我挺好的。',
      '真的吗……还行。',
      '他说;然后走了。',
      '啊'.repeat(250),
      `${'啊'.repeat(60)}，${'嗯'.repeat(60)}`,
    ];

    for (const source of cases) {
      const result = splitSentences(source, 100);

      expect([...result.sentences, result.rest].join('')).toBe(source);
    }
  });

  it('无标点的长尾巴也会被强制切 (官方迟迟不合成, 不能一直占着不发)', () => {
    const result = splitSentences('无'.repeat(250), 100);

    expect(result.sentences.length).toBeGreaterThanOrEqual(2);
    expect(result.rest.length).toBeLessThanOrEqual(100);
  });
});

describe('WS 握手解析 · 临场参数归一', () => {
  const url =
    '/voice/training/sid-001?token=jwt&templateId=vpt_intimate_avoidance_l1&mode=voice' +
    '&difficulty=L2&style=cooperative&emotionBaseline=0.5&defenseLevel=0.1&visitorMode=fullyReal';

  it('完整参数全部解析到位', () => {
    const query = parseVoiceHandshake(url);

    expect(query.sessionId).toBe('sid-001');
    expect(query.templateId).toBe('vpt_intimate_avoidance_l1');
    expect(query.mode).toBe('voice');
    expect(query.difficulty).toBe('L2');
    expect(query.style).toBe('cooperative');
    expect(query.styleUnmapped).toBe(false);
    expect(query.emotionBaseline).toBe(0.5);
    expect(query.defenseLevel).toBe(0.1);
    expect(query.visitorMode).toBe('fullyReal');
  });

  it('缺 sid 时落到 default (与旧实现一致, 不报错)', () => {
    expect(parseVoiceHandshake('/voice/training?token=jwt').sessionId).toBe('default');
  });

  it('sessionId 优先从 query 读取 (新约定: 前端连精确路径 + ?sessionId=)', () => {
    expect(parseVoiceHandshake('/voice/training?sessionId=abc-123&token=jwt').sessionId).toBe('abc-123');
  });

  it('query 的 sessionId 优先于 path (path 只是旧格式兜底)', () => {
    expect(parseVoiceHandshake('/voice/training/legacy-sid?sessionId=query-sid').sessionId).toBe('query-sid');
  });

  it('path 旧格式仍能解析 (存量客户端兼容)', () => {
    expect(parseVoiceHandshake('/voice/training/sid-001?token=jwt').sessionId).toBe('sid-001');
  });

  it('sessionId 里的控制字符被清洗 (防日志注入) 且超长被截断', () => {
    const injected = parseVoiceHandshake('/voice/training?sessionId=abc%0A%5Bfake%5D').sessionId;
    const oversized = parseVoiceHandshake(`/voice/training?sessionId=${'x'.repeat(200)}`).sessionId;

    expect(injected).toBe('abc[fake]');
    expect(injected).not.toContain('\n');
    expect(oversized.length).toBe(64);
  });

  it('mode 非法值回退 voice; text 正常识别', () => {
    expect(parseVoiceHandshake('/voice/training/s?mode=bogus').mode).toBe('voice');
    expect(parseVoiceHandshake('/voice/training/s?mode=text').mode).toBe('text');
  });

  it('难度非法值丢弃 (交给模板缺省), 不报错', () => {
    const query = parseVoiceHandshake('/voice/training/s?difficulty=L9');

    expect(query.difficulty).toBeUndefined();
    expect(query.styleUnmapped).toBe(false);
  });

  it('比例值非数字丢弃, 交给模板缺省', () => {
    expect(parseVoiceHandshake('/voice/training/s?emotionBaseline=abc').emotionBaseline).toBeUndefined();
  });

  it('风格白名单外的值标记为映射不上 (供上层回退 mixed)', () => {
    const query = parseVoiceHandshake('/voice/training/s?style=zzz');

    expect(query.style).toBeUndefined();
    expect(query.styleUnmapped).toBe(true);
  });
});

describe('临场参数合并 · 三态优先级', () => {
  const summary: VoiceTemplateSummary = {
    templateId: 'vpt_x',
    codename: '晚晴',
    ageRange: '28-35',
    presentingComplaint: '先讨好, 事后委屈',
    difficulty: 'L2',
    styleHint: 'cooperative',
    emotionBaselineDefault: 0.35,
    defenseLevelDefault: 0.2,
    defenseType: 'avoidance',
  };

  it('无模板无覆盖 → 内置兜底', () => {
    const preset = resolveVoicePreset(parseVoiceHandshake('/voice/training/s'), null);

    expect(preset.difficulty).toBe('L1');
    expect(preset.style).toBe('mixed');
    expect(preset.emotionBaseline).toBe(0.35);
    expect(preset.defenseLevel).toBe(0.2);
  });

  it('有模板无覆盖 → 用模板缺省', () => {
    const preset = resolveVoicePreset(parseVoiceHandshake('/voice/training/s'), summary);

    expect(preset.difficulty).toBe('L2');
    expect(preset.style).toBe('cooperative');
    expect(preset.emotionBaseline).toBe(0.35);
    expect(preset.defenseLevel).toBe(0.2);
  });

  it('握手覆盖优先于模板缺省', () => {
    const preset = resolveVoicePreset(parseVoiceHandshake('/voice/training/s?difficulty=L3&style=avoidant'), summary);

    expect(preset.difficulty).toBe('L3');
    expect(preset.style).toBe('avoidant');
  });

  it('风格映射不上 → 回退 mixed (**不是**模板缺省)', () => {
    const preset = resolveVoicePreset(parseVoiceHandshake('/voice/training/s?style=zzz'), summary);

    expect(preset.style).toBe('mixed');
  });

  it('比例值越界裁剪到 [0, 1]', () => {
    expect(resolveVoicePreset(parseVoiceHandshake('/voice/training/s?emotionBaseline=5'), null).emotionBaseline).toBe(1);
    expect(resolveVoicePreset(parseVoiceHandshake('/voice/training/s?defenseLevel=-3'), null).defenseLevel).toBe(0);
  });
});

describe('上游状态码 → 业务错误归一', () => {
  it('1004 鉴权失败不可重试', () => {
    const error = mapTtsUpstreamError(1004, 'invalid api key');

    expect(error.code).toBe('tts_auth_failed');
    expect(error.retryable).toBe(false);
    expect(error.upstreamStatus).toBe(1004);
  });

  it.each([
    [1002, 'tts_rate_limited'],
    [1039, 'tts_concurrent_limited'],
    [1001, 'tts_upstream_timeout'],
    [2201, 'tts_idle_disconnect'],
    [2205, 'tts_queue_overflow'],
  ] as const)('可重试码 %i → %s', (status, code) => {
    const error = mapTtsUpstreamError(status);

    expect(error.code).toBe(code);
    expect(error.retryable).toBe(true);
  });

  it.each([
    [1042, 'tts_illegal_characters'],
    [2013, 'tts_invalid_params'],
    [2202, 'tts_illegal_event'],
    [2206, 'tts_event_order'],
  ] as const)('不可重试码 %i → %s', (status, code) => {
    const error = mapTtsUpstreamError(status);

    expect(error.code).toBe(code);
    expect(error.retryable).toBe(false);
  });

  it('未知码按可重试处理 (上游抖动是常态, 不该把整轮会谈判死)', () => {
    const error = mapTtsUpstreamError(9999);

    expect(error.code).toBe('tts_upstream_error');
    expect(error.retryable).toBe(true);
  });
});

describe('官方 bidi 端点拼装', () => {
  it('https → wss, http → ws, 且拼上官方路径', () => {
    expect(buildTtsBidiUrl('https://api.minimax.cn')).toBe('wss://api.minimax.cn/ws/v1/t2a_v2_bidi');
    expect(buildTtsBidiUrl('http://api.minimax.cn')).toBe('ws://api.minimax.cn/ws/v1/t2a_v2_bidi');
  });

  it('去掉结尾斜杠 (不产生双斜杠路径)', () => {
    expect(buildTtsBidiUrl('https://api.minimax.cn/')).toBe('wss://api.minimax.cn/ws/v1/t2a_v2_bidi');
    expect(buildTtsBidiUrl('https://api.minimax.cn///')).toBe('wss://api.minimax.cn/ws/v1/t2a_v2_bidi');
  });
});
