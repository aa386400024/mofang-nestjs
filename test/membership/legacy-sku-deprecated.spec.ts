import { describe, expect, it, vi } from 'vitest';

import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { BillingService } from '../../src/counselor/providers/billing.service.js';

function createService() {
  return new BillingService({} as never, {} as never);
}

describe('AF-516 旧单次 SKU 下线', () => {
  it('列表保留兼容条目但明确标记下线与替代方案', async () => {
    const skus = await createService().listSkus();

    expect(skus).toHaveLength(4);
    for (const sku of skus) {
      expect(sku.deprecated).toBe(true);
      expect(sku.deprecationMessage).toContain('会员订阅');
    }
  });

  it('旧 SKU 下单直接返回 410，不再生成 pending 订单', async () => {
    await expect(createService().createOrder({ skuCode: 'sku_voice_session', paymentMethod: 'mock' }, 'u-1')).rejects.toBeInstanceOf(
      BizException,
    );

    try {
      await createService().createOrder({ skuCode: 'sku_voice_session', paymentMethod: 'mock' }, 'u-1');
    } catch (error) {
      expect((error as BizException).getStatus()).toBe(410);
    }
  });
});
