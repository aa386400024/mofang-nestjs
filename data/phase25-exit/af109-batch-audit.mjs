import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const batchId = process.argv[2] ?? 'q_35XnpvLWLr-Yocr8kJh';
const indexPath = path.join(repo, 'data', 'debug-sessions', '_batches', `${batchId}.json`);
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const strip = (t) => String(t).replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').replace(/<think\b[^>]*>[\s\S]*$/gi, '').trim();

const rows = [];
const totals = { sessions: 0, messages: 0, visitorMessages: 0, counselorMessages: 0, visitorThink: 0, counselorThink: 0, visitorEmpty: 0, counselorEmpty: 0, visibleEmptyAfterStrip: 0 };
for (const s of index.sessions) {
  if (s.status !== 'completed') continue;
  totals.sessions += 1;
  const file = path.join(repo, 'data', 'debug-sessions', `${s.debugSessionId}.json`);
  if (!fs.existsSync(file)) continue;
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  let v = 0, c = 0, vt = 0, ct = 0, ve = 0, ce = 0, se = 0;
  const counselorTexts = [];
  for (const m of t.messages ?? []) {
    totals.messages += 1;
    const text = String(m.text ?? '');
    if (m.role === 'visitor') {
      v += 1; totals.visitorMessages += 1;
      if (/<think\b/i.test(text)) { vt += 1; totals.visitorThink += 1; }
      if (strip(text).length === 0) { se += 1; totals.visibleEmptyAfterStrip += 1; }
    } else if (m.role === 'counselor') {
      c += 1; totals.counselorMessages += 1;
      if (/<think\b/i.test(text)) { ct += 1; totals.counselorThink += 1; }
      if (text.trim().length === 0) { ce += 1; totals.counselorEmpty += 1; }
      if (strip(text).length === 0) { se += 1; totals.visibleEmptyAfterStrip += 1; }
      counselorTexts.push(text.trim());
    }
  }
  const dup = counselorTexts.length - new Set(counselorTexts).size;
  rows.push({ ...s, messages: t.messages?.length ?? 0, visitor: v, counselor: c, visitorThink: vt, counselorThink: ct, counselorEmpty: ce, emptyAfterStrip: se, duplicateCounselor: dup });
}
console.log(JSON.stringify({ batchId, totals, rows }, null, 2));
