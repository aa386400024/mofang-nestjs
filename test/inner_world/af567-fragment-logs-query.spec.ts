import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ListFragmentLogsQueryDto } from '../../src/inner_world/dto/fragment.dto.js';

async function check(query: Record<string, unknown>) {
  const dto = plainToInstance(ListFragmentLogsQueryDto, query);
  return { dto, errors: await validate(dto) };
}

describe('AF-567 · GET /inner-world/fragments/logs query DTO', () => {
  it('在仓库实际的 ValidationPipe({ transform, whitelist }) 下 limit=30 通过', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const dto = (await pipe.transform({ limit: '30' }, { type: 'query', metatype: ListFragmentLogsQueryDto })) as ListFragmentLogsQueryDto;
    expect(dto.limit).toBe(30);
  });

  it('limit=30 从 query string 转成 number 并通过校验', async () => {
    const { dto, errors } = await check({ limit: '30' });
    expect(dto.limit).toBe(30);
    expect(errors).toHaveLength(0);
  });

  it('limit=0 被 @Min(1) 拒绝', async () => {
    const { dto, errors } = await check({ limit: '0' });
    expect(dto.limit).toBe(0);
    expect(errors.map((item) => item.property)).toContain('limit');
  });

  it('limit=abc 转成 NaN 后被 @IsInt 拒绝', async () => {
    const { dto, errors } = await check({ limit: 'abc' });
    expect(dto.limit).toBeNaN();
    expect(errors.map((item) => item.property)).toContain('limit');
  });

  it('省略 limit 时保持可选', async () => {
    const { dto, errors } = await check({});
    expect(dto.limit).toBeUndefined();
    expect(errors).toHaveLength(0);
  });
});
