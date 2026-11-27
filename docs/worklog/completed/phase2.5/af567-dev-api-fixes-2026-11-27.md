# AF-567 · dev 接口三问题修复交付记录

- 日期：2026-11-27
- 工作树：`D:\work\Project\backend\mofang-nestjs-af070`
- 分支：`task/AF-567-dev-api-fixes`（自 `integrate`）
- baseline：`eddf560414fd82e1c630a2d51c5ad2b0d1fbae46`
- 风险级：R2 · gateProfile full

## 一、P0 · fragment logs query DTO

### 根因

`ListFragmentLogsQueryDto.limit` 只有 `@IsOptional() @IsInt() @Min(1)`，缺 `@Type(() => Number)`。全局 `ValidationPipe` 是 `{ transform: true, whitelist: true }`，没有 `transformOptions.enableImplicitConversion`，query 的 `"30"` 保持 string，`@IsInt()` 与 `@Min(1)` 双双失败。

### 修法

- `src/inner_world/dto/fragment.dto.ts`：`limit` 补 `@Type(() => Number)`（`Type` 原本已 import）。
- 未开启全局 `enableImplicitConversion`，避免影响其他 DTO 的转换语义。

### 同形扫描

扫描 `src/inner_world/dto/` 与 `src/counselor/dto/` 全部 `*QueryDto`：

- `BootstrapQueryDto`：只有 `since`（ISO 时间串），无数值字段。
- `ListFragmentLogsQueryDto`：本次唯一缺陷，已修。
- `VisitorPoolQueryDto` / `VisitorPoolAdminListQueryDto`：`limit` 已有 `@Type`；数值型 body 字段另有 `@Type`。
- `TrainingSessionListQueryDto`：`page` / `pageSize` 已有 `@Type`，文件内注释记录了同形历史坑。
- `QuoteQueryDto`：`limit` 已有 `@Type`。
- `GrowthArchiveTrendQueryDto`：`days` 已有 `@Type`。
- `TrainingExerciseQueryDto`、`CounselorExamQueryDto`、`CounselorHomeQueryDto`、`CounselorGrowthQueryDto`：无缺 `@Type` 的数值 query 字段。

结论：指定目录内没有第二个同形缺陷。`island.dto.ts` 的 `GrowElementDto` / `PlaceDecorationDto` 是 JSON body DTO，数值由 JSON 解析，不属于 query 场景，未改动。

### 回归

新增 `test/inner_world/af567-fragment-logs-query.spec.ts`，其中一条用仓库真实的 `ValidationPipe({ transform: true, whitelist: true })` 走完整 transform 链路：

| 输入 | 期望 | 结果 |
| --- | --- | --- |
| `limit=30` | 通过并转成 `30` | ✅ |
| `limit=0` | `@Min(1)` 拒绝 | ✅ |
| `limit=abc` | `@IsInt()` 拒绝（NaN） | ✅ |
| 省略 `limit` | 可选，通过 | ✅ |

## 二、P1 · quote backgroundUrl 假域名

### 方案选择

现场没有对象存储 / CDN 凭证，后端也没有 `/quote` 静态根。采用用户给的方案③：**CDN 彻底不做时不下发假域名**，seed 写空串，前端 `isRemoteBackground` 判 false 后走本地 asset。

没有选方案①（无可用存储），也没有为方案②新增 `/quote` 静态根——那会把本次修复扩大成静态资源托管改造。

### 修法

- `src/counselor/config/quote-seeds.ts`
  - `QUOTE_CDN_BASE_URL_DEFAULT` 改为空串，并写明原因。
  - 新增 `normalizeQuoteCdnBase()`：trim 后空值返回空串；非空自动补尾斜杠。
  - 新增 `buildQuoteBackgroundUrl()`：base 为空直接返回空串，避免旧逻辑把空 base 归一成 `'/'`、写出 `/quote_dawn_lake.jpg` 这类半远端路径。
- `bin/seed-quotes.ts`：改用上述 helper；启动日志打印 `(empty → local asset)`；更新文件头注释，不再声称默认指向 `cdn.xinsu.app`。
- `src/counselor/dto/quote.dto.ts`：`backgroundUrl` 的 Swagger 示例改为空串，说明前端回退本地 asset。
- 未改 `quotes.background_url` 列定义：该列是 `VARCHAR(500) NOT NULL`，空串合法，`null` 不合法。

### 数据面

执行 `pnpm seed:quotes`：

```
[seed:quotes] 目标库 117.72.30.78:3306 / schema mofang_dev
[seed:quotes] 背景图 CDN base (empty → local asset)
[seed:quotes] 新增 0 / 更新 16 / 未变 0（合计 16）
```

落库后核对：

```
{ total: 16, empty_count: '16', remote_count: '0' }
```

即 16 行 `background_url` 全部为空串，没有任何 `http%` 远端地址。

### 回归

新增 `test/counselor/af567-quote-cdn-base.spec.ts`，覆盖默认值为空、空 base 归一、尾斜杠补齐、空 base 不拼路径、有真实 base 才拼远端地址。

## 三、P2 · 两条 500 与构建 / DI 核对

### 结论

当前代码侧未发现 DI 缺失，也没有可复现的 500 证据；更像 09:35 之前旧实例或数据库瞬时 reset。

### DI 证据

- `src/user/user.module.ts` 的 `exports` 已包含 `JwtBlacklistService`、`JwtModule`、`JwtAuthGuard`；文件内注释记录了历史上“只导出 JwtModule、漏导 JwtAuthGuard”导致首次请求 `UnknownDependenciesException` → `code 1000` 的问题，已修。
- `src/inner_world/inner_world.module.ts` `imports` 包含 `UserModule`，controller 使用 `JwtAuthGuard`；`BadgesService` 在 providers / exports 中。
- `src/counselor/counselor.module.ts` `imports` 包含 `UserModule`；`QUOTE_REPOSITORY`、`QUOTE_FAVORITE_REPOSITORY`、`QuoteService` 均已注册，`QuoteController` 依赖可解析。

### 构建证据

- 原 watch 父进程 PID 3612，启动于 09:15:31；app 子进程 PID 11596，启动于 09:35:35；`dist/app.js` 构建时间 09:16:10。说明 09:35 子进程加载的是 09:16 那次成功构建。
- 现有 stdout 日志（`%TEMP%\mofang-dev-3000g.*.log` 等）最后写入停在 08:35，无法回溯 09:35 那次增量编译的完整输出；日志里没有 `UnknownDependenciesException` / `JwtAuthGuard` 解析失败。
- 本次改代码后实测 watch 链路正常：`dist/inner_world/dto/fragment.dto.js` 09:49:20 重建，`dist/counselor/config/quote-seeds.js` 09:53:32 重建，app 子进程于 09:53:32 重启；`GET http://localhost:3000/health` 返回 200（database / redis 均 up）。说明当前 watch 增量编译与重启是干净的。

### 建议

09:35 之前那版无法从日志定案；以后排查“改了没生效 / 旧代码 500”时，先同时核对 `dist` 文件时间与子进程启动时间，并在重启前跑一次 `pnpm typecheck`。

## 四、闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| Lint | `pnpm lint` | 0 error |
| Typecheck | `pnpm typecheck` | 0 error |
| 定向测试 | `pnpm exec vitest run test/inner_world/af567-fragment-logs-query.spec.ts test/counselor/af567-quote-cdn-base.spec.ts test/counselor/quote-engine.spec.ts` | 3 files / 22 tests passed |
| 全量测试 | `pnpm test` | 361 passed / 1 skipped（files）；5121 passed / 4 skipped（tests） |
| engine-core | `git diff --stat HEAD -- src/engine-core` | 空 |

## 五、提交

- commit message：`fix(af567): 修 fragment logs query 数字转换并停止下发假 quote CDN`
- 备注：`quotes` 表 16 行数据已刷新为空串；本次未改 `.env`，未新增对象存储 / 静态根。
