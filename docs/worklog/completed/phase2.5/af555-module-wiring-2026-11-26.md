# AF-555 · 挂载 GraphQL 模块并隔离样例模块

日期：2026-11-26
分支：`task/AF-555-module-wiring`
基线：`c55458a992b335041afbc75709ff5c34de8fb86b`

## 改动

| 文件 | 内容 |
| --- | --- |
| `src/app.module.ts` | 挂载 `GqlModule`；`SampleModule` 改由 `demoModules` 条件注入，生产恒为空 |
| `src/config/module-flags.ts` | 新增 `shouldEnableSampleApi()`：非生产 + `ENABLE_SAMPLE_API=true` 才放行，生产硬拒绝 |
| `src/sample/controllers/crud.controller.ts` | 补 `JwtAuthGuard + RolesGuard` 与 `@Roles('admin')`，作为显式开启后的第二道门禁 |
| `src/sample/controllers/crud.controller.spec.ts` | 测试模块覆盖 guard，避免新增依赖解析失败 |
| `test/app/af555-module-wiring.spec.ts` | 5 例：`GqlModule` 接线、生产硬拒绝、默认关闭、显式开启、CRUD guard/role 元数据 |

## 设计取舍

- **GqlModule 直接挂载**：resolver 本身已有 `JwtAuthGuard + @Roles('admin')`，生产 `graphiql`/`debug` 关闭，AF-551 深度限制继续生效。
- **SampleModule 不无条件挂载**：它是脚手架 demo，`CrudController` 原本无鉴权，且 `sampletable1/2` 不是业务表。企业级做法是保留代码但生产硬隔离；本地需要联调时显式设置 `ENABLE_SAMPLE_API=true`。
- 不删除 `src/sample`，避免破坏脚手架复用性；不新增依赖，不改 GraphQL schema/深度阈值。

## 闸门

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/app test/gql src/sample/controllers/crud.controller.spec.ts` | 3 文件 / 16 例全绿 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | 0 error / 0 warning |
| `pnpm test` | 355 passed / 1 skipped（356 文件），5072 passed / 4 skipped（5076 例） |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 风险与边界

- `GqlModule` 暴露 `/graphql` 路由，仅 admin 可查询；生产 GraphiQL 关闭。
- `SampleModule` 生产永不挂载；非生产必须显式开关，且 CRUD 仍有 JWT + admin 双门禁。
- `GqlModule` 的 `SimpleService` 仍指向 `sampletable1`；若后续要把 GraphQL 做成真实业务面，需另立任务替换 schema/service，不在本任务范围。
