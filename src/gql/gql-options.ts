import type { ApolloDriverConfig } from '@nestjs/apollo';
import depthLimit from 'graphql-depth-limit';

/** GraphQL 查询最大字段嵌套深度；超过即在校验阶段拒绝，不进入 resolver。 */
export const GRAPHQL_MAX_QUERY_DEPTH = 10;

/**
 * 在 Apollo 驱动的校验规则链尾部追加深度限制。
 *
 * 保留 ConfigService 已有 validationRules，避免后续配置被覆盖；深度规则作为
 * 自定义规则参与 GraphQL validate 阶段，超深文档在解析执行前就失败。
 */
export function withGraphqlDepthLimit(options?: ApolloDriverConfig): ApolloDriverConfig {
  const base = options ?? {};
  const existingRules = base.validationRules ?? [];

  return {
    ...base,
    validationRules: [...existingRules, depthLimit(GRAPHQL_MAX_QUERY_DEPTH)],
  };
}
