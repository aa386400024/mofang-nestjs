// V2026-10-29 治本 (WP18 · 结构化输出 · JSON 载荷抽取):
//   覆盖"从模型原始响应里抠出 JSON 对象"这条公共前置工序:
//     ① 纯 JSON 原样抠出;
//     ② ```json ... ``` 围栏 (模型爱加) → 照样抠出;
//     ③ 前后废话说明 ("以下是督导报告: {...}") → 照样抠出;
//     ④ 内联 <think>...</think> 思考块 (M3 系列) → 剥掉后照样抠出;
//     ⑤ 抠不出 (无花括号 / 只有半截) → null, **不抛异常**, **不补括号造半截数据**.
//
//   这条工序是**双胞胎收敛点**: counselor 侧 (llm-json.client.ts) 与 agent 侧主报告
//   (supervisor.service.ts) 现在共用同一份实现 —— 所以本套件同时钉住两边.
//
//   验证: npx jest test/shared/wp18-llm-json-payload.spec.ts
//   时间戳: 2026-10-29 GMT+8

import { extractJsonPayload, stripThinkingTags } from '../../src/shared/llm/llm-json-payload';

describe('WP18 · JSON 载荷抽取 (shared 唯一真相源)', () => {
  describe('① 纯 JSON', () => {
    it('原样抠出对象文本', () => {
      const raw = '{"overallScore": 72, "dimensions": {"empathy": 80}}';

      expect(extractJsonPayload(raw)).toBe(raw);
    });

    it('抠出后能 JSON.parse 且字段不变', () => {
      const parsed = JSON.parse(extractJsonPayload('{"overallScore": 72}') ?? '{}') as { overallScore: number };

      expect(parsed.overallScore).toBe(72);
    });
  });

  describe('② ```json 围栏', () => {
    it('模型加的代码围栏不影响抽取', () => {
      const raw = '```json\n{"overallScore": 66}\n```';

      expect(extractJsonPayload(raw)).toBe('{"overallScore": 66}');
    });

    it('无语言标注的裸围栏也能抠', () => {
      const raw = '```\n{"overallScore": 55}\n```';

      expect(extractJsonPayload(raw)).toBe('{"overallScore": 55}');
    });
  });

  describe('③ 前后废话说明', () => {
    it('前缀说明 + 后缀说明都剔掉', () => {
      const raw = '以下是督导报告: {"overallScore": 61} 以上是本次分析结果.';

      expect(extractJsonPayload(raw)).toBe('{"overallScore": 61}');
    });
  });

  describe('④ 内联 <think> 思考块', () => {
    it('成对的 think 块被剥掉', () => {
      const raw = '<think>让我想想…</think>{"overallScore": 70}';

      expect(extractJsonPayload(raw)).toBe('{"overallScore": 70}');
    });

    it('未闭合的 think 块 (流被截断) 后半截也剥掉', () => {
      const raw = '<think>想到一半就断了';

      expect(stripThinkingTags(raw)).toBe('');
    });

    it('think 块里带花括号也不能把 JSON 抠错', () => {
      const raw = '<think>{"draft": 1}</think>{"overallScore": 70}';

      expect(extractJsonPayload(raw)).toBe('{"overallScore": 70}');
    });
  });

  describe('⑤ 抠不出 → null (不抛, 不补括号)', () => {
    it('纯文本没有花括号 → null', () => {
      expect(extractJsonPayload('抱歉，我无法生成该报告。')).toBeNull();
    });

    it('空串 → null', () => {
      expect(extractJsonPayload('')).toBeNull();
    });

    it('截断的 JSON (缺右括号) → null, 不补括号', () => {
      // 上游按长度截断时正文是半截的 —— 补上右括号会"编造"出一份看似合法的数据.
      const raw = '{"overallScore": 61, "dimensions": {"empathy": 5';

      expect(extractJsonPayload(raw)).toBeNull();
    });

    it('只有开括号没有闭括号 → null', () => {
      expect(extractJsonPayload('{')).toBeNull();
    });
  });
});
