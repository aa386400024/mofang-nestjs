import { describe, expect, it } from 'vitest';

import { buildQuoteBackgroundUrl, normalizeQuoteCdnBase, QUOTE_CDN_BASE_URL_DEFAULT } from '../../src/counselor/config/quote-seeds.js';

describe('AF-567 · quote 背景图 base 不再造假域名', () => {
  it('默认值不再指向 cdn.xinsu.app', () => {
    expect(QUOTE_CDN_BASE_URL_DEFAULT).toBe('');
  });

  it('未配置 base 时归一为空串', () => {
    expect(normalizeQuoteCdnBase()).toBe('');
    expect(normalizeQuoteCdnBase(' '.repeat(3))).toBe('');
  });

  it('base 缺尾斜杠时自动补齐', () => {
    expect(normalizeQuoteCdnBase('https://static.example.com/quote')).toBe('https://static.example.com/quote/');
    expect(normalizeQuoteCdnBase(' https://static.example.com/quote/ ')).toBe('https://static.example.com/quote/');
  });

  it('base 为空时 backgroundUrl 写空串，前端回退本地 asset', () => {
    expect(buildQuoteBackgroundUrl('', 'quote_dawn_lake.jpg')).toBe('');
  });

  it('有真实 base 时才拼远端地址', () => {
    expect(buildQuoteBackgroundUrl('https://static.example.com/quote/', 'quote_dawn_lake.jpg')).toBe(
      'https://static.example.com/quote/quote_dawn_lake.jpg',
    );
  });
});
