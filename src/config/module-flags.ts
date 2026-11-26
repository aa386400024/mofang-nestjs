/**
 * 可选 demo 模块开关（AF-554）。
 *
 * `SampleModule` 是脚手架自带的 CRUD 示例，表结构 `sampletable1/2` 不属于业务库，
 * 且历史上 `CrudController` 没有鉴权。它可以保留用于本地联调，但**绝不能**
 * 进入生产路由表：
 *   - 生产环境硬拒绝，即使误设 `ENABLE_SAMPLE_API=true` 也不挂载；
 *   - 非生产环境也必须显式 `ENABLE_SAMPLE_API=true`，默认关闭。
 *
 * 该函数独立于 AppModule 导出，便于单测覆盖四种组合而不启动 Nest。
 */
export function shouldEnableSampleApi(env: Record<string, string | undefined> = process.env): boolean {
  const nodeEnv = (env['NODE_ENV'] ?? '').trim().toLowerCase();
  const flag = (env['ENABLE_SAMPLE_API'] ?? '').trim().toLowerCase();

  return nodeEnv !== 'production' && flag === 'true';
}
