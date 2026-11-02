// V2026-10-26 治本 (官方音色目录代理 — 协议事实层, spec §任务 2):
//   原因: 音色列表端点 (`GET /counselor/voices`) 要调 MiniMax 的
//     `POST /v1/get_voice` 拿账号可用音色. 上游的**协议事实** (端点路径 / 音色类型枚举
//     / 响应体字段名) 与**本地怎么跑** (超时 / 缓存时长) 必须分开:
//       - 协议事实写成 env → 换上游契约变成"改个环境变量", 静默走错协议, 且没有审计痕迹
//       - 本地参数写成常量 → 调参要改代码发版
//     本文件只放协议事实; 超时 / TTL 走 env (见 src/config/envs/default.ts).
//   上游响应体 (节选, 官方《查询可用音色ID》文档):
//     {
//       "system_voice": [
//         { "voice_id": "Chinese (Mandarin)_Lyrical_Voice",
//           "voice_name": "抒情女声",
//           "description": ["一位温柔抒情的普通话女声……"],
//           "created_time": "1970-01-01" }
//       ],
//       "base_resp": { "status_code": 0, "status_msg": "success" }
//     }
//   反双胞胎:
//     - 不把 `voice_type` 做成自由字符串: 官方只有 4 个取值, 写死枚举才能在编译期拦住笔误
//     - 不把域名写死: 基址走全局 env `MINIMAX_BASE_URL` (国内 / 国际站是部署环境的事)
//   验证:
//     1. tsc 0 错
//     2. grep -rn "/v1/get_voice" src → 只命中本文件与 voices.client.ts
//   时间戳: 2026-10-26

/**
 * 上游音色目录端点 (相对全局基址).
 */
export const VOICE_CATALOG_UPSTREAM_PATH = '/v1/get_voice';

/**
 * 上游音色类型枚举 (官方《查询可用音色ID》).
 *
 * - `system`: 系统音色 (官方预置) —— **本期只开这个**
 * - `voice_cloning`: 快速复刻音色 (仅在成功用于语音合成后才可查询)
 * - `voice_generation`: 文生音色 (仅在成功用于语音合成后才可查询)
 * - `all`: 以上全部
 */
export const VOICE_CATALOG_TYPES = ['system', 'voice_cloning', 'voice_generation', 'all'] as const;

export type VoiceCatalogType = (typeof VOICE_CATALOG_TYPES)[number];

/**
 * 本期对外开放的音色类型 (系统音色).
 */
export const VOICE_CATALOG_TYPE_SYSTEM: VoiceCatalogType = 'system';

/**
 * 把请求方传入的 `type` 归一成上游音色类型.
 *
 * 需求原文: 「`type` 本期只接受 `system`; 传其他值或缺省按 `system` 处理即可
 * (克隆 / 文生列表后期才开)」.
 *
 * 为什么不报错而是回退 `system`: 这是**只读展示型**端点, 前端传错一个枚举值不该
 * 让整个选择器挂掉 —— 回退到系统音色列表, 用户照样能用. 真正的"不支持"语义留给
 * 后期开克隆 / 文生列表时再收紧 (那时要能区分"不支持"与"没传").
 *
 * @param raw 原始值 (可为空 / 任意字符串)
 * @returns 归一后的音色类型 (恒不为空)
 */
export function resolveVoiceCatalogType(raw: string | undefined | null): VoiceCatalogType {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value.length === 0) {
    return VOICE_CATALOG_TYPE_SYSTEM;
  }
  return VOICE_CATALOG_TYPES.find((item) => item === value) ?? VOICE_CATALOG_TYPE_SYSTEM;
}
