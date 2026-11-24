// AF-459: 文本清洗 / MiniMax 渲染 / 流式标签拆分.
import { ProsodyStreamSanitizer, renderMiniMaxText, stripProsodyMarkers } from '../../../src/shared/prosody/index.js';

describe('AF-459 · prosody text', () => {
  describe('stripProsodyMarkers', () => {
    it('剥掉语义标记、厂商停顿与白名单语气词', () => {
      const raw = '嗯，[pause:0.4]我最近<#0.3#>（叹气）(sighs)睡不好。';
      expect(stripProsodyMarkers(raw)).toBe('嗯，我最近（叹气）睡不好。');
    });

    it('普通圆括号内容不被误删', () => {
      const raw = '他说（其实我也不确定）就走了。';
      expect(stripProsodyMarkers(raw)).toBe(raw);
    });
  });

  describe('renderMiniMaxText', () => {
    it('句内停顿 → <#x#>', () => {
      expect(renderMiniMaxText('我最近，[pause:0.4]工作压力挺大的。')).toBe('我最近，<#0.4#>工作压力挺大的。');
    });

    it('时长夹到 0.1–1 秒，两位小数', () => {
      expect(renderMiniMaxText('我[pause:0.05]最近')).toBe('我<#0.1#>最近');
      expect(renderMiniMaxText('我[pause:5]最近')).toBe('我<#1#>最近');
    });

    it('句首/句尾停顿丢弃（官方要求夹在可发音文本之间）', () => {
      expect(renderMiniMaxText('[pause:0.3]你好')).toBe('你好');
      expect(renderMiniMaxText('你好[pause:0.3]')).toBe('你好');
    });

    it('连续停顿只保留一条（不能连用）', () => {
      const out = renderMiniMaxText('你好[pause:0.3][pause:0.4]世界');
      expect(out.match(/<#/g)).toHaveLength(1);
    });

    it('无标记文本原样返回', () => {
      const text = '我不知道，可能就是这样。';
      expect(renderMiniMaxText(text)).toBe(text);
    });

    it('AF-460: 思考段 beat → 0.5–3s 停顿', () => {
      expect(renderMiniMaxText('我[beat:1.8]最近')).toBe('我<#1.8#>最近');
      expect(renderMiniMaxText('我[beat:9]最近')).toBe('我<#3#>最近');
      expect(renderMiniMaxText('我[beat:0.1]最近')).toBe('我<#0.5#>最近');
    });

    it('AF-460: 长沉默 silence → 1–10s（句末仍会被官方规则丢弃）', () => {
      expect(renderMiniMaxText('我不知道。[silence:5.2]可能吧。')).toBe('我不知道。<#5.2#>可能吧。');
      expect(renderMiniMaxText('我不知道。[silence:20]可能吧。')).toBe('我不知道。<#10#>可能吧。');
      // 句末/句首停顿无法落地，长度信息由 voice-delivery 的队列延迟承接.
      expect(renderMiniMaxText('我不知道。[silence:5.2]')).toBe('我不知道。');
    });

    it('AF-460: 副语言只在句首/句末落地，不塞进句子中间', () => {
      expect(renderMiniMaxText('(breath)我有点累。')).toBe('(breath)我有点累。');
      expect(renderMiniMaxText('我有点累。(sigh)')).toBe('我有点累。(sigh)');
      expect(renderMiniMaxText('我(breath)有点累。')).toBe('我有点累。');
    });
  });

  describe('ProsodyStreamSanitizer', () => {
    it('跨 chunk 的标签不会漏到正文', () => {
      const sanitizer = new ProsodyStreamSanitizer();
      expect(sanitizer.feed('[pa')).toBe('');
      expect(sanitizer.feed('use:0.5]我最近')).toBe('我最近');
      expect(sanitizer.flush()).toBe('');
    });

    it('跨 chunk 的语气词不会被念出来', () => {
      const sanitizer = new ProsodyStreamSanitizer();
      expect(sanitizer.feed('我有点累(sig')).toBe('我有点累');
      expect(sanitizer.feed('hs)，想休息')).toBe('，想休息');
      expect(sanitizer.flush()).toBe('');
    });

    it('未闭合的残片在轮末丢弃，不拼进正文', () => {
      const sanitizer = new ProsodyStreamSanitizer();
      expect(sanitizer.feed('我最近[pause:0.3')).toBe('我最近');
      expect(sanitizer.flush()).toBe('');
    });

    it('正常文本立即放行，不被扣留', () => {
      const sanitizer = new ProsodyStreamSanitizer();
      expect(sanitizer.feed('我最近睡得不太好。')).toBe('我最近睡得不太好。');
    });
  });
});
