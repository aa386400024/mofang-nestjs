#!/usr/bin/env node
// AF-127 · 长会谈开场框架与收束的规则化结构审计 CLI:
//   职责: 只读 pack 目录里的 packets/packet-*.md, 跑结构审计, 输出**无整段原文**的 JSON + Markdown.
//   边界: 只读 pack 目录; 只写 --out 目录; 不调 LLM / 不连 DB / 不改仓库状态 / 不接硬门.
//
//   用法:
//     pnpm exec tsx bin/session-structure-audit.ts run --pack-dir <pack目录> --out <输出目录>
//   例:
//     pnpm exec tsx bin/session-structure-audit.ts run \
//       --pack-dir %TEMP%\af125-pack16 --out %TEMP%\af127-audit
//
//   ⚠️ 输出纪律: 状态固定 candidate, gateEligible 固定 false, 免责声明固定带上;
//     产物里的"证据"只是命中的短句, 不等于临床质量结论.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  aggregateSessionStructure,
  auditSessionStructure,
  CLOSING_MODE_KEYS,
  parsePacketMarkdown,
  RISK_CLOSING_ELEMENT_KEYS,
  SESSION_STRUCTURE_AUDIT_VERSION,
  SESSION_STRUCTURE_DISCLAIMER,
  type ClosingElementKey,
  type OpeningElementKey,
  type SessionStructureAggregate,
  type SessionStructureAudit,
} from '../src/auto-practice/metrics/session-structure-audit.js';

/** 产物文件名。 */
const JSON_FILE = 'session-structure-audit.json';
const MD_FILE = 'session-structure-audit.md';

/** 开场要素键（报告里固定按这个顺序排）。 */
const OPENING_KEYS: readonly OpeningElementKey[] = ['confidentiality', 'boundary', 'duration', 'pauseRefusal', 'recording'];

/** 收束要素键（报告里固定按这个顺序排）。 */
const CLOSING_KEYS: readonly ClosingElementKey[] = ['summary', 'takeaway', 'nextStep'];

/** 取命令行参数值。 */
function arg(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return null;
  return argv[index + 1];
}

/** 打印错误并退出。 */
function fail(message: string): never {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

/** 读一个 pack 目录, 产出逐 packet 审计。 */
function readPackAudits(packDir: string): SessionStructureAudit[] {
  const packetsDir = join(packDir, 'packets');
  if (!existsSync(packetsDir)) fail(`找不到 packets 目录：${packetsDir}`);
  const files = readdirSync(packetsDir)
    .filter((name) => /^packet-.*\.md$/i.test(name))
    .toSorted((left, right) => left.localeCompare(right));
  if (files.length === 0) fail(`packets 目录里没有 packet-*.md：${packetsDir}`);
  return files.map((name) => {
    const packetId = name.replace(/\.md$/i, '');
    const markdown = readFileSync(join(packetsDir, name), 'utf8');
    return auditSessionStructure(packetId, parsePacketMarkdown(markdown));
  });
}

/** 覆盖率的一行摘要。 */
function coverageLine(label: string, stat: { covered: number; total: number; rate: number }): string {
  return `  ${label.padEnd(16, ' ')} ${String(stat.covered).padStart(3, ' ')}/${String(stat.total).padEnd(3, ' ')}  ${(stat.rate * 100).toFixed(1)}%`;
}

/** 渲染一组覆盖率。 */
function renderCoverage(
  title: string,
  keys: readonly string[],
  coverage: Record<string, { covered: number; total: number; rate: number }>,
): string[] {
  return [`### ${title}`, '', '```', ...keys.map((key) => coverageLine(key, coverage[key])), '```', ''];
}

/** 渲染完整性摘要。 */
function renderCompleteness(aggregate: SessionStructureAggregate): string[] {
  return [
    '## 完整性',
    '',
    `- 开场 5 项全覆盖：${aggregate.openingCompletePackets}/${aggregate.packetCount} 个 packet`,
    `- 收束按模式完整：${aggregate.closingCompletePackets}/${aggregate.packetCount} 个 packet`,
    `- 常规收束 3 项全覆盖：${aggregate.routineClosingCompletePackets}/${aggregate.packetCount} 个 packet`,
    `- 检测到危机信号：${aggregate.riskDetectedPackets}/${aggregate.packetCount} 个 packet`,
    `- 危机收束覆盖：${aggregate.riskClosingCompletePackets}/${aggregate.packetCount} 个 packet`,
    `- 收束模式计数：${CLOSING_MODE_KEYS.map((mode) => `${mode}=${aggregate.closingModeCounts[mode]}`).join(' / ')}`,
    `- 开场+收束全全覆盖：${aggregate.fullyCoveredPackets}/${aggregate.packetCount} 个 packet`,
    `- 部分覆盖（至少命中 1 个结构子组但未全项覆盖）：${aggregate.partiallyCoveredPackets}/${aggregate.packetCount} 个 packet`,
    '',
  ];
}

/** 风险收束的表格标签。 */
function riskClosingLabel(audit: SessionStructureAudit): string {
  if (!audit.crisisDetected) return '—';
  return audit.riskClosingComplete ? '覆盖' : '不完整';
}

/** 渲染逐 packet 表。 */
function renderPacketTable(audits: readonly SessionStructureAudit[]): string[] {
  const lines = [
    '## 逐 packet 结果',
    '',
    '| packet | 轮数 | 咨询师轮 | 开场 | 收束模式 | 风险收束 | 缺失要素 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const audit of audits) {
    const missing = [
      ...OPENING_KEYS.filter((key) => !audit.opening[key].covered).map((key) => `开场:${key}`),
      ...CLOSING_KEYS.filter((key) => !audit.closing[key].covered).map((key) => `收束:${key}`),
      ...(audit.crisisDetected
        ? RISK_CLOSING_ELEMENT_KEYS.filter((key) => !audit.riskClosing[key].covered).map((key) => `风险:${key}`)
        : []),
    ];
    lines.push(
      `| ${audit.packetId} | ${audit.turnCount} | ${audit.counselorTurns} | ${audit.openingComplete ? '完整' : '不完整'} | ${
        audit.closingMode
      } | ${riskClosingLabel(audit)} | ${missing.join('、') || '—'} |`,
    );
  }
  return lines;
}

/** 渲染命中证据。 */
function renderEvidence(audits: readonly SessionStructureAudit[]): string[] {
  const lines = ['', '## 命中证据（短句）', ''];
  for (const audit of audits) {
    lines.push(`### ${audit.packetId}`, '');
    const rows: string[] = [];
    for (const key of OPENING_KEYS) {
      const element = audit.opening[key];
      if (element.covered) rows.push(`- 开场·${key}（轮 ${element.evidenceTurns.join(', ')}）：${element.evidence}`);
    }
    for (const key of CLOSING_KEYS) {
      const element = audit.closing[key];
      if (element.covered) rows.push(`- 收束·${key}（轮 ${element.evidenceTurns.join(', ')}）：${element.evidence}`);
    }
    if (audit.crisisDetected) {
      for (const key of RISK_CLOSING_ELEMENT_KEYS) {
        const element = audit.riskClosing[key];
        if (element.covered) rows.push(`- 风险·${key}（轮 ${element.evidenceTurns.join(', ')}）：${element.evidence}`);
      }
    }
    lines.push(rows.length === 0 ? '- （无要素覆盖）' : rows.join('\n'), '');
  }
  return lines;
}

/** 渲染 Markdown 报告。 */
function renderMarkdown(audits: readonly SessionStructureAudit[], aggregate: SessionStructureAggregate, packDir: string): string {
  const lines: string[] = [
    '# AF-127 · 长会谈开场框架与收束结构审计（候选口径）',
    '',
    `> ${SESSION_STRUCTURE_DISCLAIMER}`,
    '',
    `- 口径版本：${SESSION_STRUCTURE_AUDIT_VERSION}`,
    `- pack 目录：${packDir}`,
    `- packet 数：${aggregate.packetCount}`,
    `- 状态：${aggregate.status}（gateEligible=${aggregate.gateEligible}）`,
    '',
    ...renderCoverage('开场知情框架（前 10 轮）', OPENING_KEYS, aggregate.openingCoverage),
    ...renderCoverage('结束收束（后 10 轮）', CLOSING_KEYS, aggregate.closingCoverage),
    ...renderCoverage('危机收束（后 10 轮）', RISK_CLOSING_ELEMENT_KEYS, aggregate.riskClosingCoverage),
    ...renderCompleteness(aggregate),
    ...renderPacketTable(audits),
    ...renderEvidence(audits),
    `> ${SESSION_STRUCTURE_DISCLAIMER}`,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

/** run 子命令。 */
function commandRun(argv: readonly string[]): void {
  const packDir = arg(argv, '--pack-dir');
  if (!packDir) fail('用法：session-structure-audit run --pack-dir <pack目录> --out <输出目录>');
  const outDir = arg(argv, '--out');
  if (!outDir) fail('用法：session-structure-audit run --pack-dir <pack目录> --out <输出目录>');
  const audits = readPackAudits(packDir);
  const aggregate = aggregateSessionStructure(audits);
  const payload = {
    version: SESSION_STRUCTURE_AUDIT_VERSION,
    generatedAt: new Date().toISOString(),
    status: aggregate.status,
    gateEligible: aggregate.gateEligible,
    disclaimer: SESSION_STRUCTURE_DISCLAIMER,
    packDir,
    packets: audits,
    aggregate,
  };
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, JSON_FILE);
  const mdPath = join(outDir, MD_FILE);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, renderMarkdown(audits, aggregate, packDir), 'utf8');
  console.log(`[OK] ${audits.length} 个 packet → ${outDir}`);
  console.log('[开场覆盖率 · 前 10 轮]');
  for (const key of OPENING_KEYS) console.log(coverageLine(key, aggregate.openingCoverage[key]));
  console.log('[收束覆盖率 · 后 10 轮]');
  for (const key of CLOSING_KEYS) console.log(coverageLine(key, aggregate.closingCoverage[key]));
  console.log(
    `[完整性] 开场全项 ${aggregate.openingCompletePackets}/${aggregate.packetCount} · 收束全项 ${aggregate.closingCompletePackets}/${aggregate.packetCount} · 全覆盖 ${aggregate.fullyCoveredPackets}/${aggregate.packetCount}`,
  );
  console.log(`[产物] ${jsonPath}`);
  console.log(`[产物] ${mdPath}`);
  console.log(`[提示] ${SESSION_STRUCTURE_DISCLAIMER}`);
}

const sub: string | undefined = process.argv[2];
if (sub === 'run') {
  commandRun(process.argv.slice(3));
} else if (sub === '--help' || sub === '-h') {
  console.log('用法：session-structure-audit run --pack-dir <pack目录> --out <输出目录>');
  process.exit(0);
} else {
  console.error('用法：session-structure-audit run --pack-dir <pack目录> --out <输出目录>');
  process.exit(2);
}
