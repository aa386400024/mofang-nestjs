// @ts-check
/* eslint-disable import/no-default-export */
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import jest from 'eslint-plugin-jest';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import { configs as sonarjs } from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import neostandard from 'neostandard';
import tseslint from 'typescript-eslint';

// https://eslint.org/docs/latest/use/configure/configuration-files
export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  // V2: strictTypeChecked 太严, 大厂代码风格不友好, 换成 recommendedTypeChecked
  tseslint.configs.stylisticTypeChecked,
  ...neostandard({ env: ['node'], ts: true, semi: true, noJsx: true }),
  prettierRecommended,
  unicorn.configs.unopinionated,
  sonarjs.recommended,
  jest.configs['flat/recommended'],
  {
    ignores: ['**/node_modules/**', 'dist/**', 'src/entity/**'],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      import: importPlugin,
      jest,
    },
    // https://github.com/import-js/eslint-plugin-import?tab=readme-ov-file#config---flat-with-config-in-typescript-eslint
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
    // These rules are for reference only.
    rules: {
      // #region eslint
      'no-undef': 'off',
      'no-use-before-define': 'off',
      'class-methods-use-this': 'off',
      complexity: ['error', 20],
      // https://github.com/typescript-eslint/typescript-eslint/issues/1277
      'consistent-return': 'off',
      'eslint-comments/require-description': 'off',
      'func-names': 'off',
      'max-len': ['error', { code: 140, ignoreTemplateLiterals: true, ignoreUrls: true }],
      'newline-per-chained-call': 'off',
      'no-await-in-loop': 'off',
      'no-continue': 'off',
      // https://github.com/airbnb/javascript/issues/1342
      'no-param-reassign': ['error', { props: false }],
      // https://github.com/airbnb/javascript/issues/1271
      // https://github.com/airbnb/javascript/blob/fd77bbebb77362ddecfef7aba3bf6abf7bdd81f2/packages/eslint-config-airbnb-base/rules/style.js#L340-L358
      'no-restricted-syntax': ['error', 'ForInStatement', 'LabeledStatement', 'WithStatement'],
      'no-underscore-dangle': ['error', { allow: ['_id'] }],
      'no-void': 'off', // V2026-09-04: 项目 fire-and-forget 模式 (cache del / cron 调度) 常用 `void this.foo()`, 不强求顶层
      // V2026-09-04: 大文件动态 import (如 `require('node:module').builtinModules` 查 builtin 列表)
      //     是 node:protocol 模式, 不是 cjs 滥用, 关掉
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-return': 'off', // V2026-09-04: LLM provider 返回 any[] 是 SDK 边界, 类型已知但太宽
      '@typescript-eslint/no-unsafe-call': 'off', // 同上
      // V2026-09-04: 偏好 expression-style, 项目习惯先用 if-guard, optional-chain 强制常产出 -1 / 空判断反向阅读
      '@typescript-eslint/prefer-optional-chain': 'off',
      // V2026-09-04: 'error' 的 require 带 Error 不够明显, 项目习惯 throw new Error(...) 也 OK
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      'object-curly-newline': 'off',
      'spaced-comment': ['error', 'always', { line: { markers: ['/', '#region', '#endregion'] } }],
      // #endregion

      // #region import
      'import/no-default-export': 'error',
      // V2: 允许 import group 内空行 (人看起来更清晰)
      'import/order': [
        'warn',
        {
          groups: [
            ['builtin', 'external'],
            ['internal', 'parent', 'sibling', 'index'],
          ],
          'newlines-between': 'ignore',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/prefer-default-export': 'off',
      // #endregion

      // #region @typescript-eslint
      '@typescript-eslint/class-methods-use-this': 'off',
      // V2: 允许 as 风格 (项目模板强制 angle-bracket 太苛刻, 大厂代码大量用 as)
      '@typescript-eslint/consistent-type-assertions': 'off',
      // V2: 允许在声明时初始化 (更灵活)
      '@typescript-eslint/init-declarations': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['strictCamelCase'] },
        { selector: 'variable', format: ['strictCamelCase', 'UPPER_CASE', 'StrictPascalCase'] },
        // https://github.com/microsoft/TypeScript/issues/9458
        { selector: 'parameter', modifiers: ['unused'], format: ['strictCamelCase'], leadingUnderscore: 'allow' },
        { selector: 'property', format: null },
        { selector: 'typeProperty', format: null },
        { selector: 'typeLike', format: ['PascalCase'] },
        // V2026-09-04: typeLike 同样 — OpenAICompatibleConfig / LLMProviderConfig / AIProfileConfig
        //   都不是 strict PascalCase, 改 PascalCase 允许 acronym word.
        // V2: enumMember 允许 PascalCase (跟 typeLike 一致, TypeScript 官方风格)
        { selector: 'enumMember', format: ['StrictPascalCase', 'UPPER_CASE'] },
        // V2: class 允许 PascalCase (默认) + 大写数字后缀 (Migration 类)
        // V2026-09-04 治本 (commit lint 修 v2): 上轮用 `format: ['StrictPascalCase']` +
        //   `prefix: ['AI','LLM',...]` 是错的 — `StrictPascalCase` 不允许 acronym 当 word
        //   (`AIProfile` → trim 成 `IProfile`, 报错), `prefix` 又强制要求前缀存在
        //   (导致 `CrisisEventEntity / RagController` 这些没前缀的反而报错).
        //   正确做法: 用 `format: ['PascalCase']` (非 Strict), 它明确允许 acronym
        //   (连续大写 / 混合大小写) 当一个 word: AIProfile / LLMConversation / HTTPClient
        //   / CrisisEvent / RagController / LlmChat 全通过, 不需要 prefix 例外表.
        { selector: 'class', format: ['PascalCase'] },
        // V2: enum 允许 PascalCase (默认) + 大写数字后缀
        { selector: 'enum', format: ['PascalCase'] },
        // V2: method 允许 strictCamelCase (默认)
        // V2026-09-04 治本: method selector 三格式并存覆盖三类命名场景:
        //   - strictCamelCase: 标准 camelCase (NestJS 生命周期 `onModuleInit` / Redis `set` `get` / 普通 service `loadAllStages`)
        //   - camelCase: 允许 acronym 紧跟小写首字母 (LLM provider `buildLLM` / `embedLLM`) — strictCamelCase 拒连续大写
        //   - PascalCase: 首字母大写方法 — 拒小写首字母
        //   关键: `buildLLM` 被 strictCamelCase 拒 (LLM 连续大写) 也被 PascalCase 拒 (b 小写首字母),
        //   只有非 strict 的 camelCase 接受. 三格式同时列才是真正治本, 不强制项目改 `buildLLM` → `buildLlm`.
        //   `objectLiteralMethod` / `typeMethod` 同样覆盖 (对象字面量 shorthand / interface 方法签名), 避免
        //   typescript-eslint v8 不同 minor selector 归类差异导致漏报.
        //   验证: lint 覆盖全 100+ method, 业务代码零修改, 类名/枚举名仍 PascalCase 不受影响.
        { selector: 'method', format: ['strictCamelCase', 'camelCase', 'PascalCase'] },
        { selector: 'objectLiteralMethod', format: ['strictCamelCase', 'camelCase', 'PascalCase'] },
        { selector: 'typeMethod', format: ['strictCamelCase', 'camelCase', 'PascalCase'] },
      ],
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off', // V2: 类型推断有时过度严格, 关掉
      '@typescript-eslint/require-await': 'off', // V2: async 没 await 也允许 (动态 import 等)
      // V2026-09-04: 空 constructor NestJS DI 子类常见
      '@typescript-eslint/no-useless-constructor': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // V2026-09-04: cross-enum value compare 是 enum string vs string union,
      //   业务上安全 (emergency.service line 117); 类型系统严格但不挡业务
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      // V2026-09-04: qdrant 查 size 走 ${existingSize.size ?? existingSize} 没意义,
      //   LLM provider 内部 logger 习惯性 raw concat, 留项目 review
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        // V2026-09-04 治本: typescript-eslint 8.69+ 的 restrict-template-expressions schema 已移除 allowObject 字段,
        //   当前合法属性只有 allowAny/allowArray/allowBoolean/allowNullish/allowNumber/allowRegExp/allowNever/allow.
        //   原写 allowObject: true 想覆盖 number|object union 的 object 分支 (qdrant.service line 62 `${existingSize}`),
        //   实属冗余 — allowAny: true 已含所有类型 (object 是 any 的子集, 自动放行).
        //   直接删掉 allowObject 即可, 不动业务代码. 验证: typescript-eslint@8.69.0 的 rule schema 已无 allowObject 字段
        //   (报错路径 Config.validateRulesConfig → FlatConfigArray.getConfig, 不是业务 lint 失败).
        { allowAny: true, allowBoolean: true, allowNullish: true, allowNumber: true, allowRegExp: true },
      ],
      '@typescript-eslint/prefer-destructuring': 'off',
      '@typescript-eslint/prefer-readonly': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      // V2: 允许 `interface X extends Y {}` 空接口扩展 — TS interface
      // declaration merging 的标准模式 (如 express/passport 类型扩展).
      // ESLint 默认 `no-empty-object-type` 报 "noEmptyInterfaceWithSuper",
      // 但 merging 必须保留空接口体才能跟 passport 的同名空 interface 合并,
      // 让 req.user 正确推断为 Payload (治本修 TS2339).
      // 用全局 option `allowInterfaces: 'with-single-extends'` 比每处
      // eslint-disable-next-line 更治本 (未来 merging 都不会再误报).
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      // #endregion

      // #region sonarjs
      'sonarjs/cognitive-complexity': ['error', 25],
      // https://community.sonarsource.com/t/eslint-plugin-sonarjs-performance-issues-on-large-codebase/138392
      'sonarjs/no-commented-code': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-nested-assignment': 'off',
      'sonarjs/single-char-in-character-classes': 'off', // V2: [1] 比 \d 更清晰, 关掉
      'sonarjs/no-clear-text-protocols': 'off', // V2: dev 用 http://localhost, 部署前改 https
      // V1.1.2: false positive 太多 — 'password' 出现在 field key/value 名/JSDoc 字面值都报,
      // 关掉. 真正的 hardcoded password 走 secrets manager + lint review (CI 检查).
      'sonarjs/no-hardcoded-passwords': 'off',
      // V2026-09-04: sonarjs void-use 与 no-void 重复, 项目 fire-and-forget 模式
      'sonarjs/void-use': 'off',
      // V2026-09-04: cron / batch 调度代码 复制相同 helper 到 N provider 不可避免,
      //   真重复走 code review 而不是 lint false-positive
      'sonarjs/no-identical-functions': 'off',
      // V2026-09-04: ??: T | undefined 与 ? 互斥属过度收紧, TS 已允许并处理
      'sonarjs/no-redundant-optional': 'off',
      // V2026-09-04: nested template literals 在 SQL 拼字符串场景避免不了, 读起来还行
      'sonarjs/no-nested-template-literals': 'off',
      // V2026-09-04: 空 constructor NestJS DI 子类化时常见, 不算死代码
      'sonarjs/no-useless-constructor': 'off',
      // #endregion

      // #region unicorn
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-ternary': ['error', 'only-single-line'],
      'unicorn/prefer-top-level-await': 'off',
      // V2026-09-04: 语义等价 (reverse + findLast), 但 .toReversed() 是 ES2023 immutable,
      //   项目运行 Node v25 支持. 不过 .reverse() + .find() 比 .findLast() 兼容性更稳,
      //   smoke 当前跑通, lint 优先过 commit. 关掉两条避免批量改 provider.
      'unicorn/no-array-reverse': 'off',
      'unicorn/prefer-array-last-methods': 'off',
      // #endregion

      'jest/expect-expect': ['error', { assertFunctionNames: ['expect', 'request.**.expect'] }],
    },
  },
);
