/**
 * Shared module barrel (心塑 + 魔方共用).
 *
 * 按 catsmiaow 项目规范 (README §Index Exporting):
 *   - 从文件夹 import
 *   - 路径最后只放一个文件名
 *
 * 注意: 这里的 user 是项目示例的 mock user, 业务账号见 `src/user/`.
 * 这里只导出基础设施层.
 */
export * from './infra';