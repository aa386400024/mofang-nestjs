// @ts-check
/**
 * 运维脚本专用 lint 配置。
 *
 * scripts/**\/*.mjs|cjs 不属于任何 tsconfig project，也不参与 build；它们是运维/
 * 编排工具，语法与正确性优先。根 eslint.config.mjs 的 TS 严格规则（type-aware、
 * prettier、unicorn/sonarjs 风格）不适用于这类脚本：直接套用会产生上万条行尾/
 * 风格噪声，反而掩盖真实缺陷。
 *
 * 本配置只启用 ESLint recommended 的正确性规则 + Node 环境 globals，不启用
 * type-aware、prettier 与风格类插件；`pnpm lint` 会显式调用它。
 */
import eslint from '@eslint/js';
import pluginN from 'eslint-plugin-n';
import { defineConfig } from 'eslint/config';

const moduleLanguageOptions = pluginN.configs['flat/recommended-module'].languageOptions;
const scriptLanguageOptions = pluginN.configs['flat/recommended-script'].languageOptions;

const correctnessRules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
};

export default defineConfig(
  {
    ignores: ['**/node_modules/**', 'scripts/orchestration/eslint-scripts.config.mjs'],
  },
  eslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: moduleLanguageOptions,
    rules: correctnessRules,
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: scriptLanguageOptions,
    rules: correctnessRules,
  },
);
