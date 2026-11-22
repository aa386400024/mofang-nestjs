/**
 * AF-323 · 真实语料分类器影子审计的纯统计层。
 *
 * 职责: 把分类器观测记录压成可复核的计数与比率。
 * 边界: 不读文件、不发网络、不接触对话原文；输入只允许是标签 / 布尔 / 置信度。
 */

/** 8 场目标 trace（AF-322 调试批次）。 */
export const DEFAULT_TARGET_SESSION_IDS = [
  'debug_zenPFZu7VbSAW4LCC0_rN',
  'debug_PNbYXZIn3MQQt-EOlUVvm',
  'debug_xw7uAJodsn6o3ln9FGL_Q',
  'debug_s6HNZ_d_YYBHCLF2PLHNd',
  'debug_q_VTpzjWZQwWDcAjUuJY0',
  'debug_5fF1I9GduTiJN0B_mkuZi',
  'debug_aV8cenevSHfgmGB2Zkflf',
  'debug_PqbSdWdJDumFk6LULjVvv',
];

/**
 * 解析逗号分隔的场次 id。
 *
 * @param {string|undefined} raw 原值
 * @returns {string[]} 去空去重后的 id
 */
export function parseTargetIds(raw) {
  const source = typeof raw === 'string' && raw.trim() ? raw : DEFAULT_TARGET_SESSION_IDS.join(',');
  return [...new Set(source.split(',').map((id) => id.trim()).filter(Boolean))];
}

/**
 * 计算两个标签集合的 Jaccard（都为空时按 1 处理：两轨都没判出事件也是一致）。
 *
 * @param {readonly string[]} left 集合 A
 * @param {readonly string[]} right 集合 B
 * @returns {number} [0,1]
 */
export function jaccard(left, right) {
  const a = new Set(left ?? []);
  const b = new Set(right ?? []);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * 汇总观测记录。
 *
 * 质量指标只统计 `degraded=false` 的可用轮；降级轮单独计数，避免把回落当模型能力。
 *
 * @param {Array<object>} records 观测记录（只含标签/布尔/置信度）
 * @param {string[]} expectedSessionIds 期望场次 id
 * @returns {object} 汇总
 */
export function summarizeAudit(records, expectedSessionIds = DEFAULT_TARGET_SESSION_IDS) {
  const total = records.length;
  const degraded = records.filter((record) => record.degraded === true).length;
  const usable = records.filter((record) => record.degraded !== true);
  const exactAgreement = usable.filter((record) => record.agreement === true).length;
  const jaccardValues = usable.map((record) => jaccard(record.ruleKinds, record.modelKinds));
  const meanJaccard = jaccardValues.length > 0 ? jaccardValues.reduce((sum, value) => sum + value, 0) / jaccardValues.length : null;
  const confidenceValues = usable.map((record) => record.confidence).filter((value) => Number.isFinite(value));
  const meanConfidence =
    confidenceValues.length > 0 ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : null;
  const ruleNeutral = usable.filter((record) => (record.ruleKinds ?? []).includes('neutral')).length;
  const modelNeutral = usable.filter((record) => (record.modelKinds ?? []).includes('neutral')).length;
  const bothNeutral = usable.filter(
    (record) => (record.ruleKinds ?? []).includes('neutral') && (record.modelKinds ?? []).includes('neutral'),
  ).length;
  const modelIds = [...new Set(records.map((record) => record.modelId).filter(Boolean))];
  const ruleLabelCounts = {};
  const modelLabelCounts = {};
  for (const record of usable) {
    for (const kind of record.ruleKinds ?? []) ruleLabelCounts[kind] = (ruleLabelCounts[kind] ?? 0) + 1;
    for (const kind of record.modelKinds ?? []) modelLabelCounts[kind] = (modelLabelCounts[kind] ?? 0) + 1;
  }

  const expected = new Set(expectedSessionIds);
  const seen = new Set(records.map((record) => record.sessionId));
  const bySession = {};
  for (const sessionId of expectedSessionIds) {
    const rows = records.filter((record) => record.sessionId === sessionId);
    const sessionUsable = rows.filter((record) => record.degraded !== true);
    bySession[sessionId] = {
      present: seen.has(sessionId),
      total: rows.length,
      degraded: rows.filter((record) => record.degraded === true).length,
      exactAgreement: sessionUsable.filter((record) => record.agreement === true).length,
      meanJaccard:
        sessionUsable.length > 0
          ? sessionUsable.reduce((sum, record) => sum + jaccard(record.ruleKinds, record.modelKinds), 0) / sessionUsable.length
          : null,
      modelId: rows.find((record) => record.modelId)?.modelId ?? null,
    };
  }
  const missingSessions = expectedSessionIds.filter((id) => !seen.has(id));

  return {
    total,
    degraded,
    degradedRate: total > 0 ? degraded / total : null,
    usable: usable.length,
    exactAgreement,
    exactAgreementRate: usable.length > 0 ? exactAgreement / usable.length : null,
    meanJaccard,
    meanConfidence,
    ruleNeutral,
    modelNeutral,
    bothNeutral,
    ruleNeutralRate: usable.length > 0 ? ruleNeutral / usable.length : null,
    modelNeutralRate: usable.length > 0 ? modelNeutral / usable.length : null,
    modelIds,
    ruleLabelCounts,
    modelLabelCounts,
    sessions: expected.size,
    seenSessions: seen.size,
    missingSessions,
    bySession,
  };
}

/**
 * 固定 4 位小数格式化；null 输出 n/a。
 *
 * @param {number|null} value 值
 * @returns {string} 文本
 */
export function formatRatio(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

/**
 * 把两轨标签分布拼成表格行。
 *
 * @param {Record<string, number>} ruleCounts 规则轨计数
 * @param {Record<string, number>} modelCounts 模型轨计数
 * @returns {string[]} 表格行
 */
function labelRows(ruleCounts = {}, modelCounts = {}) {
  const labels = [...new Set([...Object.keys(ruleCounts), ...Object.keys(modelCounts)])].toSorted();
  if (labels.length === 0) return ['| （无） | 0 | 0 |'];
  return labels.map((label) => `| ${label} | ${ruleCounts[label] ?? 0} | ${modelCounts[label] ?? 0} |`);
}

/**
 * 把汇总结果转成无原文的 Markdown 表格。
 *
 * @param {object} summary summarizeAudit 输出
 * @returns {string} Markdown
 */
export function renderAuditMarkdown(summary) {
  const lines = [
    '| 指标 | 值 |',
    '| --- | --- |',
    `| 观测轮数 | ${summary.total} |`,
    `| 可用轮 | ${summary.usable} |`,
    `| 降级轮 | ${summary.degraded}（${formatRatio(summary.degradedRate)}） |`,
    `| exact agreement | ${summary.exactAgreement} / ${summary.usable}（${formatRatio(summary.exactAgreementRate)}） |`,
    `| mean Jaccard | ${formatRatio(summary.meanJaccard)} |`,
    `| mean confidence | ${formatRatio(summary.meanConfidence)} |`,
    `| 规则轨 neutral 率 | ${formatRatio(summary.ruleNeutralRate)} |`,
    `| 模型轨 neutral 率 | ${formatRatio(summary.modelNeutralRate)} |`,
    `| 两轨同判 neutral | ${summary.bothNeutral} |`,
    `| 模型标识 | ${summary.modelIds.join('、') || 'n/a'} |`,
    `| 缺失场次 | ${summary.missingSessions.length > 0 ? summary.missingSessions.join('、') : '无'} |`,
    '',
    '### 标签分布（按轮次计数，可多标签）',
    '',
    '| 标签 | 规则轨 | 模型轨 |',
    '| --- | --- | --- |',
    ...labelRows(summary.ruleLabelCounts, summary.modelLabelCounts),
    '',
    '| 场次 | 轮数 | 降级 | exact | mean Jaccard |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const [sessionId, row] of Object.entries(summary.bySession)) {
    lines.push(`| ${sessionId} | ${row.total} | ${row.degraded} | ${row.exactAgreement} | ${formatRatio(row.meanJaccard)} |`);
  }
  return `${lines.join('\n')}\n`;
}
