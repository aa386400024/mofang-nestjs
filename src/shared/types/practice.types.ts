/**
 * 共享枚举与常量 —「我的」Tab V2.0 二级页专用.
 *
 * 设计原则:
 *   - 业务模块之间共享的枚举抽到这里, 避免循环依赖
 *   - 命名跟设计文档 V2.0 §Tab4 严格一致
 *   - TS const enum 编译期擦除, 零运行时开销
 *
 * 范围限定:
 *   - 仅含"我的" Tab 4 个新页面 (ai-conversations / dashboard / life-map / embodied)
 *     + 隐私授权管理所涉及的枚举.
 *   - 其他业务场景 (练习/评估/危机/微干预等) 的枚举后续按需添加.
 */

/** 仪表板时间范围. */
export const DASHBOARD_RANGES = ['1w', '1m', '3m', '6m', '1y'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

/** 心理健身 4 大训练模块 — V2.0 §Tab2 分类7 (仪表板展示). */
export const GYM_MODULES = [
  'physical_basics', // 基础体能训练
  'cognitive_muscle', // 认知肌肉训练
  'self_esteem_gain', // 自尊增肌训练
  'interpersonal_efficacy', // 人际效能训练
] as const;
export type GymModule = (typeof GYM_MODULES)[number];

/** 人生阶段 — V2.0 §Tab2 分类6 (life-map 时间轴缩略). */
export const LIFE_STAGES = [
  'adolescence', // 青春期 12-18
  'emerging_adulthood', // 成年初显期 18-28
  'transition', // 转型期 28-35
  'midlife', // 成年中期 35+
] as const;
export type LifeStage = (typeof LIFE_STAGES)[number];

/** 具身设备类型 — V2.0 §Tab4 embodied. */
export const EMBODIED_DEVICE_TYPES = [
  'heart_rate_band', // 心率手环
  'hrv_monitor', // HRV 监测器
  'smartwatch', // 智能手表
  'breath_sensor', // 呼吸传感器
] as const;
export type EmbodiedDeviceType = (typeof EMBODIED_DEVICE_TYPES)[number];

/** 具身设备状态. */
export const EMBODIED_DEVICE_STATUS = [
  'connected', // 已连接 · 信号强
  'unstable', // 信号弱
  'disconnected', // 已断开
] as const;
export type EmbodiedDeviceStatus = (typeof EMBODIED_DEVICE_STATUS)[number];

/** 具身数据权限类型 — V2.0 §Tab4 embodied 权限管理. */
export const EMBODIED_PERMISSION_KEYS = [
  'practice_realtime_guide', // 练习实时引导 (心率/HRV)
  'fitness_analytics', // 心理健身分析
  'emotion_passive_recognition', // 情绪被动识别
  'anonymous_trend_share', // 匿名化趋势分享
] as const;
export type EmbodiedPermissionKey = (typeof EMBODIED_PERMISSION_KEYS)[number];

/** AI 陪伴会话摘要模式 — V2.0 §5.5. */
export const AI_COMPANION_MODES = [
  'normal', // 普通陪伴
  'inner_voice_coach', // 内部声音教练 (V2.0 新增)
] as const;
export type AiCompanionMode = (typeof AI_COMPANION_MODES)[number];

/** 隐私授权管理类型 — V2.0 §Tab4 隐私授权管理. */
export const PRIVACY_AUTHORIZATION_TYPES = [
  'oauth_google', // Google 登录
  'oauth_wechat', // 微信登录
  'oauth_apple', // Apple 登录
  'device_camera', // 设备摄像头
  'device_microphone', // 设备麦克风
  'device_location', // 设备位置
  'device_health_sensor', // 健康传感器
  'notification_push', // 推送通知
] as const;
export type PrivacyAuthorizationType = (typeof PRIVACY_AUTHORIZATION_TYPES)[number];

/** 授权状态. */
export const PRIVACY_AUTHORIZATION_STATUS = [
  'active', // 已授权
  'revoked', // 已撤销
  'expired', // 已过期
] as const;
export type PrivacyAuthorizationStatus = (typeof PRIVACY_AUTHORIZATION_STATUS)[number];
