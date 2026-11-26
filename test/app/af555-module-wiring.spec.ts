import { describe, expect, test } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { RolesGuard } from '../../src/common/index.js';
import { shouldEnableSampleApi } from '../../src/config/module-flags.js';
import { GqlModule } from '../../src/gql/gql.module.js';
import { CrudController } from '../../src/sample/controllers/crud.controller.js';
import { SampleModule } from '../../src/sample/sample.module.js';
import { JwtAuthGuard } from '../../src/user/guards/jwt-auth.guard.js';

describe('AF-555 · 模块接线', () => {
  test('AppModule 挂载 GqlModule，且 demo 挂载状态与开关一致', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];

    expect(imports).toContain(GqlModule);
    if (shouldEnableSampleApi()) {
      expect(imports).toContain(SampleModule);
    } else {
      expect(imports).not.toContain(SampleModule);
    }
  });

  test('生产环境即使 ENABLE_SAMPLE_API=true 也硬拒绝', () => {
    expect(shouldEnableSampleApi({ NODE_ENV: 'production', ENABLE_SAMPLE_API: 'true' })).toBe(false);
    expect(shouldEnableSampleApi({ NODE_ENV: 'PRODUCTION', ENABLE_SAMPLE_API: 'TRUE' })).toBe(false);
  });

  test('非生产默认关闭', () => {
    expect(shouldEnableSampleApi({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldEnableSampleApi({ NODE_ENV: 'test', ENABLE_SAMPLE_API: 'false' })).toBe(false);
  });

  test('非生产显式开启才放行', () => {
    expect(shouldEnableSampleApi({ NODE_ENV: 'development', ENABLE_SAMPLE_API: 'true' })).toBe(true);
    expect(shouldEnableSampleApi({ NODE_ENV: 'test', ENABLE_SAMPLE_API: ' TRUE ' })).toBe(true);
  });

  test('CrudController 具备 JWT + admin 双门禁', () => {
    const guards = Reflect.getMetadata('__guards__', CrudController) as unknown[];
    const roles = Reflect.getMetadata('roles', CrudController) as string[];

    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(roles).toContain('admin');
  });
});
