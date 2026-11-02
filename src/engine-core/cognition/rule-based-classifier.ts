// V2026-10-28 WP1 (引擎内核 · 规则轨事件分类器):
//   职责: EventClassifier 的规则实现 —— 用静态词典把咨询师文本分类成标准事件.
//   边界: 纯函数, 无 I/O, 无随机, 可复现. 模型微调轨后期实现同接口替换, 本类可退役.

import { EVENT_LEXICON } from '../domain/events/event-lexicon';
import type { ClassifyContext, EventClassifier, SessionEvent } from '../domain/events/session-event';

/** 规则轨分类器: 关键词 / 正则兜底, 一条文本可命中多类, 未命中归 neutral. */
export class RuleBasedClassifier implements EventClassifier {
  classify(text: string, context?: ClassifyContext): readonly SessionEvent[] {
    const haystack = text.trim().toLowerCase();
    if (!haystack) {
      return [{ kind: 'neutral', matchedTerms: [], strength: 1 }];
    }

    const events: SessionEvent[] = [];

    for (const rule of EVENT_LEXICON) {
      const matched: string[] = [];
      for (const term of rule.terms) {
        if (haystack.includes(term.toLowerCase())) matched.push(term);
      }
      for (const pattern of rule.patterns ?? []) {
        if (pattern.test(haystack)) matched.push(pattern.source);
      }
      if (matched.length > 0) {
        events.push({ kind: rule.kind, matchedTerms: matched, strength: 1 });
      }
    }

    // sensitive_touch 来自角色敏感议题词表 (上下文), 不在静态词典里.
    const sensitive = (context?.sensitiveTopics ?? []).filter(
      (topic) => topic.trim().length > 0 && haystack.includes(topic.trim().toLowerCase()),
    );
    if (sensitive.length > 0) {
      events.push({ kind: 'sensitive_touch', matchedTerms: sensitive, strength: 1 });
    }

    if (events.length === 0) {
      return [{ kind: 'neutral', matchedTerms: [], strength: 1 }];
    }
    return events;
  }
}
