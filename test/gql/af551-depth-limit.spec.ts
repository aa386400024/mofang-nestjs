import { buildSchema, parse, specifiedRules, validate } from 'graphql';
import { describe, expect, it } from 'vitest';

import { GRAPHQL_MAX_QUERY_DEPTH, withGraphqlDepthLimit } from '../../src/gql/gql-options.js';

const MAX_SUPPORTED_TYPE_DEPTH = 12;

function buildDepthSchema() {
  const types = ['type Query { level1: Level1 }'];
  for (let level = 1; level <= MAX_SUPPORTED_TYPE_DEPTH; level += 1) {
    if (level === MAX_SUPPORTED_TYPE_DEPTH) {
      types.push(`type Level${level} { value: String }`);
    } else {
      types.push(`type Level${level} { level${level + 1}: Level${level + 1} value: String }`);
    }
  }
  return buildSchema(types.join('\n'));
}

function nestedSelection(levels: number): string {
  let selection = 'value';
  for (let level = levels; level >= 1; level -= 1) {
    selection = `level${level} { ${selection} }`;
  }
  return selection;
}

function aliasedSelection(levels: number): string {
  let selection = 'value';
  for (let level = levels; level >= 1; level -= 1) {
    selection = `alias${level}: level${level} { ${selection} }`;
  }
  return selection;
}

const schema = buildDepthSchema();

function validateWithDepthRule(query: string) {
  return validate(schema, parse(query), [...specifiedRules, ...(withGraphqlDepthLimit().validationRules ?? [])]);
}

describe('AF-551 GraphQL 查询深度限制', () => {
  it('阈值内的普通嵌套查询通过', () => {
    const errors = validateWithDepthRule(`query { ${nestedSelection(GRAPHQL_MAX_QUERY_DEPTH)} }`);
    expect(errors).toHaveLength(0);
  });

  it('超过阈值的普通嵌套查询在校验阶段被拒绝', () => {
    const errors = validateWithDepthRule(`query { ${nestedSelection(GRAPHQL_MAX_QUERY_DEPTH + 1)} }`);
    expect(errors.some((error) => error.message.includes('maximum operation depth'))).toBe(true);
  });

  it('命名片段不能绕过深度限制', () => {
    const errors = validateWithDepthRule(`query { ...Root } fragment Root on Query { ${nestedSelection(GRAPHQL_MAX_QUERY_DEPTH + 1)} }`);
    expect(errors.some((error) => error.message.includes('maximum operation depth'))).toBe(true);
  });

  it('内联片段不能绕过深度限制', () => {
    const errors = validateWithDepthRule(`query { ... on Query { ${nestedSelection(GRAPHQL_MAX_QUERY_DEPTH + 1)} } }`);
    expect(errors.some((error) => error.message.includes('maximum operation depth'))).toBe(true);
  });

  it('别名不能绕过深度限制', () => {
    const errors = validateWithDepthRule(`query { ${aliasedSelection(GRAPHQL_MAX_QUERY_DEPTH + 1)} }`);
    expect(errors.some((error) => error.message.includes('maximum operation depth'))).toBe(true);
  });

  it('保留 ConfigService 已有 validationRules，并追加深度规则', () => {
    const existingRule = () => ({});
    const options = withGraphqlDepthLimit({ validationRules: [existingRule] });

    expect(options.validationRules).toHaveLength(2);
    expect(options.validationRules?.[0]).toBe(existingRule);
  });

  it('未提供配置时也能生成带深度规则的选项', () => {
    expect(withGraphqlDepthLimit().validationRules).toHaveLength(1);
  });
});
