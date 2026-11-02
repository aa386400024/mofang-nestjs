// V2026-10-30 治本 (WP10 · B 层 · 轨迹剧本包出口):
//   职责: 给 `wiring/trajectory/` 一个**单一出口**, 装配层与单测都从这里 import.
//   边界: 纯 re-export, 零逻辑.
//
//   为什么要有这个 barrel:
//     剧本解析是个**自成一块**的能力 (端口 + 静态实现 + 剧本数据). 装配层要 import
//     的是"剧本解析"这件事, 不是"某一个文件". 若到处深路径 import
//     (`trajectory/script-resolver` / `trajectory/ethical-scripts`), 将来 Phase2 加了
//     第三个实现 (db resolver), 装配层的 import 就要改 —— 而"换数据源不该改注入点"
//     正是本期的核心承诺.
//
//   反双胞胎:
//     - **只导出与数据源无关的部分**: 端口 + token + 静态实现 + 剧本数据.
//       未来的 DB 数据源实现 (实体 / 仓储 / 管理端) 不进本出口 —— 它们依赖 typeorm,
//       让"读一个端口常量"顺带拖进整套 ORM 依赖, 会踩 WP8-A §8-9 的架构护栏.
//     - 不把 `engine-core` 的类型再导出一份: 内核类型只有一个出口 (engine-core barrel).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. npx jest test/engine-adapters/wp10-ethical-scripts.spec.ts 从本出口 import
//
//   时间戳: 2026-10-30

export * from './ethical-scripts';
export * from './script-resolver';
