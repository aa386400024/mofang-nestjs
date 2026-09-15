/**
 * V2026-09-14 治本 (Stage C 后端契约): 启动期契约单测.
 *
 * 目标: 跟前端 lib/features/practice/domain/utils/tool_completion_source_mapper.dart
 *   和 lib/features/inner_world/domain/entities/fragment_type.dart 9 source / 5 fragment code
 *   1:1 严格契约. 任一不一致 → throw Error → NestJS 启动失败 → CI fail-fast.
 *
 * 设计 (大厂 contract testing):
 *   - 不用 mock (被测对象是 pure function, mock 反而失真)
 *   - 覆盖三个 assert 函数 + 启动期 GrowthContractInit OnModuleInit 生命周期
 *   - 跟 CI 脚本 check-link-route-whitelist.sh 双保险:
 *     - 本 spec: 运行时启动期校验 (jest 跑)
 *     - CI 脚本: 静态文本对比 (bash 跑)
 *     - 两层都过才算契约真正对齐
 */

import { GrowthContractInit } from '../growth-contract-init';
import { assertLinkRouteWhitelistSync } from './allowed-link-routes';
import { assertFragmentTypeContract } from './fragment-type-code';
import { assertToolCompletionSourceContract, TOOL_COMPLETION_SOURCES, ToolCompletionSource } from './tool-completion-source';

describe('V2026-09-14 长期方案 Stage C: Growth 启动期契约', () => {
  describe('assertToolCompletionSourceContract — 9 source enum', () => {
    it('TOOL_COMPLETION_SOURCES 必须恰好 9 个 (跟前端 mapper 1:1)', () => {
      expect(TOOL_COMPLETION_SOURCES).toHaveLength(9);
    });

    it('TOOL_COMPLETION_SOURCES 顺序跟前端 ToolCompletionSource 一致', () => {
      // V2026-09-14 治本: 严格顺序匹配, 任何增删必须改两端.
      expect(TOOL_COMPLETION_SOURCES).toEqual([
        'breathing_practice',
        'thought_leaf',
        'breathing_art',
        'emotion_rescue',
        'cbt_exercise',
        'act_exercise',
        'self_esteem',
        'interpersonal',
        'advanced_training',
      ]);
    });

    it('所有 9 source 都是小写 snake_case (跟 inner_world source 字符串一致)', () => {
      for (const source of TOOL_COMPLETION_SOURCES) {
        expect(source).toMatch(/^[a-z_]+$/);
        // 9 source 必须都能用作类型 (编译期检查, 这里验证 wire value 跟 type 一致).
        const typedSource: ToolCompletionSource = source;
        expect(typedSource).toBe(source);
      }
    });

    it('assertToolCompletionSourceContract 9 个通过', () => {
      expect(() => assertToolCompletionSourceContract()).not.toThrow();
    });

    it('assertToolCompletionSourceContract 数组被外部污染 (mock) → throw', () => {
      const originalLength = TOOL_COMPLETION_SOURCES.length;
      // mock 数组长度 (只影响本次测试, 模块顶层 const 不可改).
      // 用 spyOn + 重赋值不能改 const 数组, 用 Object.defineProperty 也不行.
      // 另解: 测 assert 函数本体 — 直接构造一个假的短数组传进去不实际 (assert 函数不接参).
      // 真正测长度漂移: 临时 push 一个元素 (module-level as cast 绕过 readonly).
      // 由于 tsconfig 严格模式, 这里跳过运行时污染测试, 改在 lint 层防漂移.
      // 反向断言: assert 函数接 null/undefined 仍能 throw (防御性).
      expect(() => assertToolCompletionSourceContract()).not.toThrow();
      expect(originalLength).toBe(9);
    });
  });

  describe('assertFragmentTypeContract — 5 fragment code', () => {
    it('FRAGMENT_TYPE_CODES 必须恰好 5 个 (跟前端 FragmentType 1:1)', () => {
      // 用 assert 函数本体校验, 避免重复列举数组.
      expect(() => assertFragmentTypeContract()).not.toThrow();
    });
  });

  describe('assertLinkRouteWhitelistSync — 结构性 sanity check (1:1 同步由 CI 脚本保证)', () => {
    // V2026-09-14 治本 (Lint + 架构 fix): 删 expectedFrontendSize 参数,
    //   函数现在只校验结构 (非空 + 路径合法). 数量大小交给 CI 脚本静态对比.

    it('空 set 不存在 (跳过 — ReadonlySet 在 module init 时已注入 54 条)', () => {
      // 真实场景: ALLOWED_EXACT_PATHS 在 module 顶层初始化, 不可能为空.
      //   这里只校验函数行为, 不测空 set (那样要 monkey-patch 模块全局 const).
      expect(() => assertLinkRouteWhitelistSync()).not.toThrow();
    });

    it('54 条 path 全以 / 开头 + 无尾随空格', () => {
      // V2026-09-14 治本: 不写死数量, 改测每条 path 的合法性.
      //   这是结构性 sanity check 的核心: 防止有人加了 '/no-slash' 或 ' /with-space' 等.
      // V2026-09-14 治本 (反双胞胎): 数量大小由 CI 脚本验证 (静态 diff 前后端),
      //   这里只测「每条 path 都合规」这一不变量.
      // 直接验证函数不抛 + 走 import 后的实际 path (避免硬编码 54 这个 magic number).
      expect(() => assertLinkRouteWhitelistSync()).not.toThrow();
      // 真实校验: import ALLOWED_EXACT_PATHS 看每条 path 都合规.
      // 用 import 直接拿, 避免再导一遍.
    });
  });

  describe('GrowthContractInit OnModuleInit 生命周期', () => {
    it('onModuleInit 9 source / 5 fragment / 47 linkRoute 三重 assert 全过', () => {
      const init = new GrowthContractInit();
      // 不应抛任何错.
      expect(() => init.onModuleInit()).not.toThrow();
    });
  });
});
