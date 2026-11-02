/**
 * V2026-09-14 治本 (Stage C 后端契约): 启动期契约 assert.
 *
 * 校验 3 件事:
 *   1. TOOL_COMPLETION_SOURCES 长度 = 9 (跟前端 mapper enum 一致)
 *   2. FRAGMENT_TYPE_CODES 长度 = 5 (跟前端 FragmentType enum 一致)
 *   3. ALLOWED_EXACT_PATHS 长度 = 47 (跟前端 staticPaths 一致)
 *
 * 设计:
 *   - 走 NestJS OnModuleInit (module init 时自动调)
 *   - 任一 assert 失败 → throw Error → NestJS 启动失败 → CI fail-fast
 *   - 后续 V2.1 加 source / path 时, 改 3 个长度 + 对应期望值 (47 → N)
 *
 * 反双胞胎:
 *   - 不写 9 个 source 的 case 测试 (那是单元测试职责), 只校验长度契约
 *   - 不在 controller 写契约校验 (启动期一次过, 运行时不再校验长度)
 *
 * 用法 (在 practice.module.ts 的 providers 加 OnModuleInit 钩子):
 *   { provide: GrowthContractInit, useClass: GrowthContractInit }
 *   或者在 AppModule 里挂一次 (全局启动期)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ALLOWED_EXACT_PATHS, assertLinkRouteWhitelistSync } from './constants/allowed-link-routes';
import { assertFragmentTypeContract } from './constants/fragment-type-code';
import { assertToolCompletionSourceContract } from './constants/tool-completion-source';

@Injectable()
export class GrowthContractInit implements OnModuleInit {
  private readonly logger = new Logger(GrowthContractInit.name);

  onModuleInit(): void {
    this.logger.log('[V2026-09-14 Stage C] 启动期契约校验...');

    // 1. 9 source 完整性
    try {
      assertToolCompletionSourceContract();
      this.logger.log('  ✓ TOOL_COMPLETION_SOURCES = 9 (跟前端 mapper 1:1)');
    } catch (e) {
      this.logger.error(`  ✗ TOOL_COMPLETION_SOURCES contract violation: ${(e as Error).message}`);
      throw e;
    }

    // 2. 5 fragment code 完整性
    try {
      assertFragmentTypeContract();
      this.logger.log('  ✓ FRAGMENT_TYPE_CODES = 5 (跟前端 FragmentType 1:1)');
    } catch (e) {
      this.logger.error(`  ✗ FRAGMENT_TYPE_CODES contract violation: ${(e as Error).message}`);
      throw e;
    }

    // 3. 47 linkRoute 静态 path 完整性 (默认期望 47, V2.1 加 path 时改此值).
    try {
      assertLinkRouteWhitelistSync();
      this.logger.log(`  ✓ ALLOWED_EXACT_PATHS = ${String(ALLOWED_EXACT_PATHS.size)} paths (跟前端 staticPaths 1:1 由 CI 脚本校验)`);
    } catch (e) {
      this.logger.error(`  ✗ ALLOWED_EXACT_PATHS contract violation: ${(e as Error).message}`);
      throw e;
    }

    this.logger.log('[V2026-09-14 Stage C] 启动期契约校验通过 ✓');
  }
}
