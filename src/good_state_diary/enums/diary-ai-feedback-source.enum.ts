/**
 * V2026-09-11 治本 (好状态日记 · AI 反馈来源):
 *   原因: AI 反馈可来自端侧 / 云端 / 端云协同. 前端 DiaryAiFeedbackSource.name
 *         是 'onDevice' / 'cloud' / 'hybrid', 改这里必须同步改前端.
 *   修复: TS enum 严格 3 态, 字符串解析失败兜底到 onDevice (更宽容).
 *   如何验证: 云端响应 → 客户端封装 source = 'cloud' → DB 存 'cloud'.
 */

/**
 * AI 反馈来源 — 端侧 / 云端 / 端云协同.
 *
 * 跟前端 DiaryAiFeedbackSource 1:1 镜像.
 */
export enum DiaryAiFeedbackSource {
  /** 纯端侧 — tflite_flutter / onnxruntime 推理, 完全离线. */
  OnDevice = 'onDevice',

  /** 纯云端 — mofang-nestjs /ai/diary-feedback, 仅传元数据. */
  Cloud = 'cloud',

  /** 端云协同 — 端侧摘要, 云端增强问题列表. */
  Hybrid = 'hybrid',
}

export const DIARY_AI_FEEDBACK_SOURCE_VALUES: DiaryAiFeedbackSource[] = [
  DiaryAiFeedbackSource.OnDevice,
  DiaryAiFeedbackSource.Cloud,
  DiaryAiFeedbackSource.Hybrid,
];

/** 字符串解析 — 非法值兜底到 onDevice (端侧是默认离线路径). */
export function parseDiaryAiFeedbackSource(value: string | null | undefined): DiaryAiFeedbackSource {
  switch (value) {
    case DiaryAiFeedbackSource.OnDevice:
      return DiaryAiFeedbackSource.OnDevice;
    case DiaryAiFeedbackSource.Cloud:
      return DiaryAiFeedbackSource.Cloud;
    case DiaryAiFeedbackSource.Hybrid:
      return DiaryAiFeedbackSource.Hybrid;
    default:
      return DiaryAiFeedbackSource.OnDevice;
  }
}
