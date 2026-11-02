// V2026-10-28 WP1 (引擎内核 · 规则词典):
//   职责: 规则轨事件分类的**初始种子词表**, 纯 TS 常量, 集中可调, 不散落到算子里.
//   边界: 纯常量, 无 I/O. 词表是最小种子, 不追求穷尽; 漏判走 neutral (delta=0),
//         不会恶化状态. 后期模型轨替换分类器后, 本表仅作兜底 / 对照.
//
//   匹配口径: 中文按小写子串包含 (中文无大小写, toLowerCase 仅为兼容英文混入);
//   patterns 为可选补充正则. sensitive_touch 不在静态词表 —— 它来自角色
//   profile.sensitiveTopics, 由分类器按上下文命中.

import type { CounselorEventKind } from '../events/session-event';

/** 一条规则: 事件种类 + 命中词 + 可选正则. */
export interface EventRule {
  readonly kind: CounselorEventKind;
  /** 小写子串命中词. */
  readonly terms: readonly string[];
  /** 可选补充正则 (大小写不敏感). */
  readonly patterns?: readonly RegExp[];
}

/** 规则轨事件词典 (初始种子). */
export const EVENT_LEXICON: readonly EventRule[] = [
  {
    kind: 'empathy',
    terms: ['听起来你', '你觉得', '这种感受', '你现在一定', '我能理解你', '是不是觉得', '你当时感到', '这种情绪', '我理解你的'],
  },
  {
    kind: 'acceptance',
    terms: ['没关系', '我不评判', '不会评判你', '你愿意说出来', '不怪你', '我接纳', '在这里是安全的'],
  },
  {
    kind: 'normalization',
    terms: ['很多人都会', '这很正常', '这不奇怪', '换作别人', '通常都会', '一般人也会', '这种情况很常见'],
  },
  {
    kind: 'open_probe',
    terms: ['能多说一点', '当时发生了什么', '你怎么看', '能详细说说', '再讲讲', '你觉得呢', '举个例子', '能具体说说'],
  },
  {
    kind: 'affirmation',
    terms: ['你做得已经很好', '你很勇敢', '这是你的进步', '你已经很努力', '做得不错', '你很棒', '这很不容易'],
  },
  {
    kind: 'judgment',
    terms: ['你不该', '你就是太敏感', '这是你自己想多了', '你根本不', '太矫情', '你这是错', '你就是想不开'],
  },
  {
    kind: 'preaching',
    terms: ['你应该', '听我的建议', '你要学会', '我建议你', '你必须', '照我说的做', '你得', '你需要改变'],
  },
  {
    kind: 'minimizing',
    terms: ['别想太多', '没什么大不了', '至于吗', '这不算什么', '小题大做', '没那么严重', '别放在心上'],
  },
  {
    kind: 'boundary_cross',
    terms: ['私下联系', '加我微信', '我们私下', '我也有类似', '下班后找我', '跟你做朋友', '留个联系方式'],
  },
];
