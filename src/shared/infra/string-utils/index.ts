// V2026-11-13 (TD-9 · T-3): 共享纯函数工具出口.
//
//   只放**纯函数** (无 DI、无装配注册、无全局状态) —— 业务层与测试层都可直接引用.
export * from './safe-string.js';
export * from './ws-frame-text.js';
