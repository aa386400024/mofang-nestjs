// V2026-10-29 治本 (WP9-C · B 层 · 本地危机探测器单测):
//   覆盖任务单 §2.3 的判定链:
//     ① 咨询师输入面的危机语言能被识别 (内核规则层在咨询师面**没有**危机词典,
//        所以这句话在内核眼里是干净的 —— 这正是要补的缺口);
//     ② 普通训练对话不误报 (宁少勿滥: 误报会把正常对话变成危机轮);
//     ③ 类别用内核 PsyGUARD 口径, 等级走内核映射表;
//     ④ 内核来访侧词典已覆盖的说法, 由探测器**复用**而不是另抄一份.
//
//   全 mock, 不起 NestJS 容器, 不发网络.
//
//   验证: npx jest test/engine-adapters/wp9c-risk-probe.spec.ts
//   时间戳: 2026-10-29 GMT+8

import { LocalCrisisProbe, detectCrisisCategories } from '../../src/engine-adapters/wiring/risk/local-crisis.probe';
import { assessSafety } from '../../src/engine-core';

describe('WP9-C · 本地危机探测器 (内核 RiskProbePort 扩展点)', () => {
  const probe = new LocalCrisisProbe();

  describe('① 危机语言能被识别', () => {
    it('咨询师输入面的自伤意念 → passive_ideation (warn)', async () => {
      const result = await probe.probe('我活着没什么意思，想结束', 'counselor_input');

      expect(result.categories).toContain('passive_ideation');
      expect(result.level).toBe('warn');
    });

    it('行动层信号 (我要去死) → block', async () => {
      const result = await probe.probe('我要去死', 'counselor_input');

      expect(result.categories).toContain('active_ideation');
      expect(result.level).toBe('block');
    });

    it('复用内核来访侧词典的说法 (不用另抄一份)', async () => {
      const result = await probe.probe('活着没意思', 'counselor_input');

      expect(result.categories).toContain('passive_ideation');
    });
  });

  describe('② 普通训练对话不误报', () => {
    it('中性咨询师发言 → pass / 无类别', async () => {
      const result = await probe.probe('最近睡得不太好，能跟我说说吗？', 'counselor_input');

      expect(result.level).toBe('pass');
      expect(result.categories).toEqual([]);
    });

    it('"结束"这类日常词不误判 (词典宁少勿滥)', async () => {
      const result = await probe.probe('我想结束这段关系，但不知道怎么说', 'counselor_input');

      expect(result.level).toBe('pass');
    });
  });

  describe('③ 与内核编排串起来 (探测器 → 内核判定 → 风险信号)', () => {
    it('注入探测器后, 内核 turn 判定能给出 warn 级危机信号', async () => {
      const verdict = await assessSafety({ text: '我活着没什么意思，想结束', side: 'counselor_input', probe });

      expect(verdict.level).toBe('warn');
      expect(verdict.categories).toContain('passive_ideation');
      expect(verdict.source).toBe('probe');
    });

    it('不注入探测器时, 内核对同一句话判 pass (证明缺口确实存在)', async () => {
      const verdict = await assessSafety({ text: '我活着没什么意思，想结束', side: 'counselor_input' });

      expect(verdict.level).toBe('pass');
    });
  });

  describe('④ 类别顺序稳定', () => {
    it('命中多个类别时按内核清单顺序输出 (结果不随命中顺序抖动)', () => {
      expect(detectCrisisCategories('我要去死，活着没意思')).toEqual(['active_ideation', 'passive_ideation']);
    });
  });
});
