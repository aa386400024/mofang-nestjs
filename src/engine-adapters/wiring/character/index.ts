// V2026-10-29 治本 (WP9-A · B 层 · 角色解析包出口):
//   职责: 给 `wiring/character/` 一个**单一出口**, 装配层与单测都从这里 import.
//   边界: 纯 re-export, 零逻辑.
//
//   为什么要有这个 barrel:
//     角色解析是个**自成一块**的能力 (端口 + 内置实现 + 种子数据). 装配层要 import
//     的是"角色解析"这件事, 不是"某一个文件". 若到处深路径 import
//     (`character/builtin-character-registry` / `character/character-profile.resolver`),
//     将来 WP9-B 加了第三个实现 (db resolver), 装配层的 import 就要改 ——
//     而"换数据源不该改注入点"正是本期的核心承诺.
//
//   V2026-10-29 (WP9-B) 收紧出口范围 —— **只导出与数据源无关的部分**:
//     · `character-profile.resolver` —— 端口 + 请求/结果纯类型 (零依赖);
//     · `builtin-character-registry` —— WP9-A 的内置种子 + **唯一那份映射公式**.
//
//   反双胞胎:
//     - **不把 DB 数据源那套导进本出口**: 实体 / db resolver / 内容基线 / 管理端
//       都依赖 typeorm, 而本出口被 `EngineStreamBackend` 引用 —— 让"读一个端口常量"
//       顺带拖进整套 ORM 依赖, 会踩 WP8-A §8-9 的架构护栏 (引擎装配层零 SDK 依赖),
//       也会让"引擎侧单测"被迫牵上数据库.
//       DB 那套由 `character-pool.module.ts` 直连具体文件 import.
//     - 不把 `engine-core` 的类型再导出一份: 内核类型只有一个出口 (engine-core barrel).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9a-*.spec.ts / wp9b-*.spec.ts 从本出口 import
//
//   时间戳: 2026-10-29

export * from './builtin-character-registry';
export * from './character-profile.resolver';
