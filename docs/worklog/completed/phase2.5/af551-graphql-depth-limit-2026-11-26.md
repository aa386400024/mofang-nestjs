# AF-551 · GraphQL 查询深度限制与资源域返修

日期：2026-11-26
分支：`task/AF-551-graphql-depth-limit`
基线：`31c26d0aa6c81a4729d62307ba6204a5864a183b`（AF-549 分支 HEAD，堆叠）
前置：AF-547（认证与授权加固）、AF-549（executor 资源域补 `pnpm-lock.yaml`）

## 交付内容

### 1. 依赖

| 包 | 版本 | 类型 |
| --- | --- | --- |
| `graphql-depth-limit` | `1.1.0` | dependencies |
| `@types/graphql-depth-limit` | `1.1.6` | devDependencies |

`pnpm-lock.yaml` 已更新；lockfile 经 Prettier 归一化，实际新增 4 个包条目，未做无关重排。

### 2. 深度限制接入

- 新增 `src/gql/gql-options.ts`：
  - `GRAPHQL_MAX_QUERY_DEPTH = 10` 单一常量；
  - `withGraphqlDepthLimit(options)` 在已有 `validationRules` 尾部追加 `depthLimit(10)`，不覆盖 ConfigService 传入配置。
- `src/gql/gql.module.ts`：
  - `GraphQLModule.forRootAsync<ApolloDriverConfig>`；
  - 工厂返回 `withGraphqlDepthLimit(config.get('graphql'))`。

深度规则参与 GraphQL `validate` 阶段，超深文档在进入 resolver 前失败；错误信息包含 `maximum operation depth of 10`。

### 3. 测试

`test/gql/af551-depth-limit.spec.ts`，7 例：

1. 阈值内 10 层普通嵌套通过；
2. 11 层普通嵌套被拒绝；
3. 命名片段 11 层不能绕过；
4. 内联片段 11 层不能绕过；
5. 每层别名 11 层不能绕过；
6. 已有 `validationRules` 保留且深度规则追加在其后；
7. 无配置时仍生成带深度规则的选项。

## 与任务单的偏差

- 任务单原写「AF-550 取消后由本任务承接」；实际 AF-550 也是被取消的中间任务，最终承接为 AF-551。已在任务单背景说明。
- 依赖安装使用共享 virtual store 参数，避免重建整棵 node_modules；`package.json` 与 lockfile 是本仓真实变更。

## 闸门

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/gql` | 1 文件 / 7 例全绿 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | 0 error / 0 warning |
| `pnpm test` | 354 passed / 1 skipped（355 文件）；5067 passed / 4 skipped（5071 例） |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 未做

- 未把 `GqlModule` 挂回 `AppModule`：会改变对外路由面，需产品决策。
- 未做复杂度/成本评分、分页强制、持久化查询，均在任务单非目标内。
