// V2026-09-04 治本 (V6.0 §11.2 + audit P0-1):
//   危机信号检测器 — 服务端权威版.
//   关键: 端侧 CrisisDetector (前端 LLMClient) 已实装 keyword 预检.
//   服务端必须有独立二级检测 — 防 client bypass + LLM 输出反查.
//   反双胞胎: 不复用端侧 detector 代码 (前端不在服务端跑), 服务端重写
//             一份独立版本. 规则 + LLM 分类器二级叠加 (§11.2 §11.3).

import { Injectable } from '@nestjs/common';

import { CrisisLevel, CrisisSignalSource } from '../enums/ai-crisis.enums';

/**
 * 危机检测结果.
 */
export interface CrisisDetectionResult {
  level: CrisisLevel;
  source: CrisisSignalSource;
  keywords: string[];
  /** 触发该 level 的原文片段 (脱敏, 前后各 200 字). */
  contextSnippet: string | null;
  /** 推荐的危机资源 (§11.2 二级及以上响应). */
  suggestedResource: string | null;
}

/**
 * 关键词词典 — §11.2 三级风险.
//   V2026-09-04 治本: 词典按级别分组, 命中 high 关键词立即升 high;
//             命中 medium 关键词 (没 high) 升 medium; 命中 low (没
//             medium / high) 才升 low. 防止 1 条文案命中多关键词时被
//             错误降级.
 */
const HIGH_KEYWORDS = ['自杀', '想死', '轻生', '结束一切', '不想活', '活不下去', 'suicide', 'kill myself', 'end my life', 'want to die'];
const MEDIUM_KEYWORDS = ['自残', '伤害自己', '割腕', '不想活了', 'self-harm', 'hurt myself', 'cutting'];
const LOW_KEYWORDS = ['绝望', '没意义', '崩溃', '撑不住', '熬不下去', 'hopeless', 'meaningless', "can't go on"];

/** §11.2 二级及以上响应 — 推荐公益热线. */
const CRISIS_HOTLINE_CN = '全国心理援助热线: 400-161-9995';
const CRISIS_HOTLINE_EN = 'Crisis Text Line: Text HOME to 741741';

@Injectable()
export class CrisisDetectorService {
  /**
   * 检测 — 输入用户消息文本, 输出风险级别 + 触发关键词.
   *
   * V2026-09-04 治本: 命中优先级 high > medium > low. 即使一条文案
   * 同时命中 high + medium, 结果是 high (不互相覆盖).
   */
  detect(text: string): CrisisDetectionResult {
    const normalized = text.toLowerCase();
    const matchedHigh = HIGH_KEYWORDS.filter((kw) => normalized.includes(kw.toLowerCase()));
    const matchedMedium = MEDIUM_KEYWORDS.filter((kw) => normalized.includes(kw.toLowerCase()));
    const matchedLow = LOW_KEYWORDS.filter((kw) => normalized.includes(kw.toLowerCase()));

    // 高优先级优先.
    if (matchedHigh.length > 0) {
      return {
        level: CrisisLevel.HIGH,
        source: CrisisSignalSource.KEYWORD,
        keywords: matchedHigh,
        contextSnippet: this.snippet(text),
        suggestedResource: this.pickHotline(text),
      };
    }
    if (matchedMedium.length > 0) {
      return {
        level: CrisisLevel.MEDIUM,
        source: CrisisSignalSource.KEYWORD,
        keywords: matchedMedium,
        contextSnippet: this.snippet(text),
        suggestedResource: this.pickHotline(text),
      };
    }
    if (matchedLow.length > 0) {
      return {
        level: CrisisLevel.LOW,
        source: CrisisSignalSource.KEYWORD,
        keywords: matchedLow,
        contextSnippet: this.snippet(text),
        suggestedResource: null,
      };
    }
    return {
      level: CrisisLevel.NONE,
      source: CrisisSignalSource.KEYWORD,
      keywords: [],
      contextSnippet: null,
      suggestedResource: null,
    };
  }

  /**
   * 上下文摘要 — 脱敏: 前后各 200 字 + 中间截断.
   */
  private snippet(text: string): string {
    if (text.length <= 400) return text;
    return `${text.slice(0, 200)}... [truncated ${text.length - 400} chars] ...${text.slice(-200)}`;
  }

  /**
   * 公益热线选择 — 中文 / 英文粗判 (含中文字符走 CN).
   */
  private pickHotline(text: string): string {
    return /[\u4E00-\u9FA5]/.test(text) ? CRISIS_HOTLINE_CN : CRISIS_HOTLINE_EN;
  }
}
