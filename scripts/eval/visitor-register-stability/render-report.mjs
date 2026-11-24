// AF-465 · 把 analysis.json 渲染成交付报告（不含原始心理台词）.
// 用法：node scripts/eval/visitor-register-stability/render-report.mjs --run-id <id>

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');

function parseArgs(argv) {
  const options = { runId: '', out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--run-id') {
      options.runId = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--out') {
      options.out = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function fmt(value, digits = 2) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

function pct(value) {
  return `${fmt(value, 1)}%`;
}

function yes(flag) {
  return flag ? '✅' : '❌';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.runId) throw new Error('缺少 --run-id');
  const runDir = path.join(ROOT, 'data', 'eval-reports', 'visitor-register-stability', options.runId);
  const manifest = JSON.parse(readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
  const analysis = JSON.parse(readFileSync(path.join(runDir, 'analysis.json'), 'utf8'));

  const conclusionText =
    {
      mechanism_stable_ai_proxy: '机制在 AI 代理盲评口径下稳定有效',
      mechanism_stable_ai_proxy_partial_coverage: '机制在已覆盖角色上稳定有效（角色覆盖未满 10）',
      injection_coverage_blocked: '机制在可注入角色上方向一致；注入覆盖不足，不能判机制稳定',
      direction_consistent_but_limited: '跨角色方向一致，但证据仍有限',
      not_stable: '未达到机制稳定',
    }[analysis.conclusion] ?? analysis.conclusion;

  const gateRows = [
    ['角色覆盖', analysis.gates.coverage],
    ['注入正确', analysis.gates.injection],
    ['跨角色方向', analysis.gates.direction],
    ['刻板安全', analysis.gates.stereotype],
    ['跨轮稳定', analysis.gates.stability],
    ['BDI 护栏', analysis.gates.bdiGuardrail],
    ['不回归', analysis.gates.noHarm],
    ['成本', analysis.gates.cost],
  ];

  const roleRows = analysis.roles.map((role) => {
    const base = role.metrics.base;
    const active = role.metrics.active;
    const b = role.blind.base;
    const a = role.blind.active;
    return `| \`${role.roleKey}\` | ${role.direction} | ${role.preferenceVotes.active}/${role.preferenceVotes.base}/${role.preferenceVotes.tie} | ${fmt(b.register_fit.mean)} → ${fmt(a.register_fit.mean)} (${fmt(a.register_fit.mean - b.register_fit.mean, 1)}) | ${fmt(a.stereotype_risk.mean)} | ${fmt(a.cross_turn_stability.mean)} | ${fmt(a.concreteness.mean)} | ${pct(base.metrics.signatureHitRate)} → ${pct(active.metrics.signatureHitRate)} | ${fmt(base.metrics.anchorDensity)} → ${fmt(active.metrics.anchorDensity)} | ${fmt(base.prompt.averageChars, 0)} → ${fmt(active.prompt.averageChars, 0)} | ${fmt(base.latency.p95Ms, 0)} → ${fmt(active.latency.p95Ms, 0)} (${pct((active.latency.p95Ms / base.latency.p95Ms - 1) * 100)}) | ${pct(base.usage.cacheHitRate)} → ${pct(active.usage.cacheHitRate)} | ${role.guardrail.bdiMismatchTurns} |`;
  });

  const injected = analysis.roles.filter((role) => role.metrics.active.prompt.registerTurnCount === role.metrics.active.turns);
  const uninjected = analysis.roles.filter((role) => role.metrics.active.prompt.registerTurnCount < role.metrics.active.turns);
  const fitDeltas = injected
    .map((role) => role.blind.active.register_fit.mean - role.blind.base.register_fit.mean)
    .sort((left, right) => left - right);
  const medianDelta =
    fitDeltas.length === 0
      ? 0
      : fitDeltas.length % 2 === 1
        ? fitDeltas[(fitDeltas.length - 1) / 2]
        : (fitDeltas[fitDeltas.length / 2 - 1] + fitDeltas[fitDeltas.length / 2]) / 2;

  // AF-478: 缓存命中率只做观测 —— 上游没报的角色不参与中位, 全部没报时显式说明.
  const cachePairs = analysis.roles
    .map((role) => ({
      base: role.metrics.base.usage?.cacheHitRate,
      active: role.metrics.active.usage?.cacheHitRate,
    }))
    .filter((pair) => typeof pair.base === 'number' && typeof pair.active === 'number');
  const medianOf = (values) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  };
  const cacheLine =
    cachePairs.length === 0
      ? '- 缓存命中：上游未上报 `cachedTokens`，本轮无法区分“缓存命中”与“真的多算”。'
      : `- 缓存命中：base 中位 ${pct(medianOf(cachePairs.map((pair) => pair.base)))}，active 中位 ${pct(medianOf(cachePairs.map((pair) => pair.active)))}（${cachePairs.length}/${analysis.roles.length} 角色可用）。`;

  const lines = [
    `# ${analysis.taskId ?? 'AF-465'} 来访者语域指纹机制稳定性评测（AI 盲评）`,
    '',
    `- 运行 ID：\`${analysis.runId}\`  `,
    `- 代码基线：\`${manifest.gitHead}\`  `,
    `- 固定脚本哈希：\`${manifest.counselorScriptHash}\`  `,
    `- 规模：${manifest.roles.length} 个可用标定角色 × base/active × ${manifest.turnCount} 轮，共 ${manifest.roles.length * 2} 场  `,
    `- 覆盖：${analysis.coverage.measured}/${analysis.coverage.expected}；未覆盖 ${analysis.coverage.missingRoles.length ? analysis.coverage.missingRoles.join('、') : '无'}  `,
    `- active 注入：${analysis.coverage.injectedRoles.length}/${analysis.coverage.measured}；未注入 ${analysis.coverage.uninjectedRoles.length ? analysis.coverage.uninjectedRoles.join('、') : '无'}  `,
    `- 评委：${analysis.judges.map((judge) => `${judge.label}（\`${judge.model}\`）`).join(' / ')}  `,
    `- 协议：\`${analysis.protocol}\`；状态：\`${analysis.status}\`  `,
    '',
    '> 本报告是 AI 代理盲评，不是真人语言学/督导师验收；只评“用词是否贴合社会语域”，不评诊断与疗效。',
    '',
    '## 结论',
    '',
    `**${conclusionText}**`,
    '',
    `判定口径是预注册的：跨 ${analysis.coverage.expected} 个标定角色看方向一致性，实际覆盖 ${analysis.coverage.measured} 个；同时检查刻板化、跨轮稳定、BDI 护栏、助手腔/术语/建议式回归和成本；不以平均句长作主指标。`,
    '',
    '## 门槛',
    '',
    '| 门 | 结果 | 关键数字 |',
    '| --- | --- | --- |',
    ...gateRows.map(([name, gate]) => `| ${name} | ${yes(gate.pass)} | ${gateDigits(name, gate)} |`),
    '',
    '## 注入覆盖拆分',
    '',
    `- 可注入：${injected.length} 个角色；active 占优 ${injected.filter((role) => role.direction === 'active').length}/${injected.length}；可注入集合的中位 \`register_fit\` Δ ${fmt(medianDelta)}。`,
    `- 未注入：${uninjected.length ? uninjected.map((role) => `\`${role.roleKey}\``).join('、') : '无'}${uninjected.length ? '。这些角色在 active 模式下没有语域块，active 实质等同 base，不能计入机制证据。' : '；全部角色 active 都带语域块，active 与 base 的差异可以计入机制证据。'}`,
    '',
    '## 逐角色',
    '',
    '| 角色 | 方向 | active/base/tie | 语域贴合 base→active (Δ) | 刻板安全 | 跨轮稳定 | 具体度 | 标志词命中 base→active | 锚点密度 base→active | prompt 字符 base→active | p95 ms base→active (Δ%) | 缓存命中率 base→active | BDI 不一致轮 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...roleRows,
    '',
    '## 摘要',
    '',
    `- 方向：${analysis.gates.direction.activeDirections}/${manifest.roles.length} 个角色 active 优于 base；语域贴合中位 Δ = ${fmt(analysis.gates.direction.medianFitDelta)}。`,
    `- 刻板安全：${analysis.gates.stereotype.stereotypeSafe}/${manifest.roles.length} 个角色 active 的 \`stereotype_risk\` 均值 ≥ 4；下降超过 0.5 的角色 ${analysis.gates.stereotype.stereotypeDrop} 个。`,
    `- 跨轮稳定：${analysis.gates.stability.stabilitySafe}/${manifest.roles.length} 个角色 active 的 \`cross_turn_stability\` 均值 ≥ 4；后 10 轮标志词命中达标 ${analysis.gates.stability.driftSafe}/${manifest.roles.length}。`,
    `- 护栏：BDI 不一致 ${analysis.gates.bdiGuardrail.bdiMismatchTurns} 轮；crisis 与事件分类按场记录在 \`analysis.json\`。`,
    `- 成本：prompt 字符中位 ${pct(analysis.gates.cost.promptOverheadPct)}；p95 延迟中位 ${pct(analysis.gates.cost.latencyOverheadPct)}。`,
    cacheLine,
    '',
    '## 限制',
    '',
    ...analysis.limitations.map((item) => `- ${item}`),
    '',
    '## 判定',
    '',
    conclusionText === '机制在 AI 代理盲评口径下稳定有效'
      ? '可以进入“跨角色稳定”的结论；仍保持默认 off、按角色灰度，并补重复场次后再谈全局开启。'
      : conclusionText === '机制在已覆盖角色上稳定有效（角色覆盖未满 10）'
        ? '已覆盖角色的方向与护栏通过，但覆盖度未满 10，只能称“部分覆盖下的机制稳定”；补齐缺失角色前不扩大全局灰度。'
        : conclusionText === '机制在可注入角色上方向一致；注入覆盖不足，不能判机制稳定'
          ? '机制方向在可注入角色上成立，但当前不能判稳定；先补齐未注入角色的 speech_register 资产，再重跑 active/盲评，不扩大灰度。'
          : conclusionText === '跨角色方向一致，但证据仍有限'
            ? '方向可继续投入，但不能对外称机制稳定；先定位未过门的角色/维度，再补重复或长会话。'
            : '不满足机制稳定；回标定表与渲染块，不继续扩大灰度。',
    '',
  ];

  const outPath = options.out
    ? path.resolve(ROOT, options.out)
    : path.join(ROOT, 'docs', 'worklog', 'completed', 'phase2.5', 'af465-visitor-register-stability-2026-11-24.md');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`[${analysis.taskId ?? 'AF-465'}] 报告 → ${outPath}\n`);
}

function gateDigits(name, gate) {
  if (name === '角色覆盖') return `${gate.roleCount}/${gate.expected} 已标定角色；缺 ${gate.expected - gate.roleCount}`;
  if (name === '注入正确') return `active ${gate.activeCovered} 场全覆盖 / base ${gate.baseCovered} 场命中`;
  if (name === '跨角色方向') return `${gate.activeDirections} 角色占优（阈值 ${gate.threshold}），中位 Δ ${fmt(gate.medianFitDelta)}`;
  if (name === '刻板安全') return `${gate.stereotypeSafe} 角色 ≥4（阈值 ${gate.threshold}），下降 ${gate.stereotypeDrop}`;
  if (name === '跨轮稳定') return `${gate.stabilitySafe} 角色 ≥4（阈值 ${gate.threshold}），漂移达标 ${gate.driftSafe}`;
  if (name === 'BDI 护栏') return `${gate.bdiMismatchTurns} 轮不一致`;
  if (name === '不回归')
    return gate.violations?.length
      ? `越界 ${gate.violations.length} 项：${gate.violations.map((item) => `\`${item.roleKey}\` ${item.field} ${fmt(item.base)}→${fmt(item.active)}`).join('；')}`
      : '助手腔/建议/标签/抽象/术语均不超过 base+0.05';
  if (name === '成本') return `prompt ${pct(gate.promptOverheadPct)}，p95 ${pct(gate.latencyOverheadPct)}`;
  return '—';
}

main();
