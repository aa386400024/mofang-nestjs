// V2026-11-13 (TD-9 · T-1/T-4): 共享测试工具出口.
//
//   只放**纯函数 / 无状态工具** (不装夹具、不硬编码业务阈值、不做 module 装配).
export * from './git-probe.js';
export * from './isolation.js';
