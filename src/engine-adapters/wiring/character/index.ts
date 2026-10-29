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
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9a-*.spec.ts 从本出口 import

export * from './builtin-character-registry';
export * from './character-profile.resolver';
