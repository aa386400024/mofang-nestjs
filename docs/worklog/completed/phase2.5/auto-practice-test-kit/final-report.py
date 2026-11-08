"""汇总最终矩阵: 合并三批结果 (matrix3 优先), 拉逐字稿算质量指标, 输出 Markdown 表格 + summary."""
import json
import os
import urllib.request

LOG_DIR = 'C:/Users/41391/AppData/Local/Doubao/User Data/Profile 5/.doubao/agent_mode/workspace/logs'
BASE = 'http://localhost:3000/admin/api'
AUTH = 'Basic YWRtaW46MTIzNDU2'
VB = ['嗯……让我想想，该怎么说。', '……我先缓一下，我们接着说。',
      '我不太想现在讲清楚，能先聊点别的吗？', '最近确实有点难说出口……我们慢慢聊吧。']
CB = '嗯，我在听。你可以接着说。'
TERM = '。？！…"”』）)~～'

CHARS = {'vpt_self_worth_intellectualization_l1': '小满', 'vpt_grief_avoidance_l1': '念安',
         'vpt_intimate_avoidance_l1': '晚晴', 'vpt_workplace_intellectualization_l1': '亦舟'}
MODES = ['expert', 'intermediate', 'novice', 'chatty', 'cold', 'preachy', 'nonsense']


def req(path):
    r = urllib.request.Request(BASE + path, headers={'Authorization': AUTH})
    return json.loads(urllib.request.urlopen(r, timeout=30).read().decode('utf-8'))


rows = {}
for f in ['matrix.jsonl', 'matrix2.jsonl', 'matrix3.jsonl']:  # 后面的覆盖前面的
    p = os.path.join(LOG_DIR, f)
    if not os.path.exists(p):
        continue
    for line in open(p, encoding='utf-8'):
        line = line.strip()
        if not line.startswith('{'):
            continue
        o = json.loads(line)
        if not o.get('id') or o.get('status') in ('timeout_waiting', 'create_error'):
            continue
        rows[(o['characterSlug'], o['counselorModeId'])] = o

final = []
for char in CHARS:
    for mode in MODES:
        o = rows.get((char, mode))
        if not o:
            final.append({'char': char, 'mode': mode, 'missing': True})
            continue
        d = req(f'/debug/sessions/{o["debugSessionId"]}')
        msgs = d['messages']
        c = [(m.get('text') or '').strip() for m in msgs if m['role'] == 'counselor']
        v = [(m.get('text') or '').strip() for m in msgs if m['role'] == 'visitor']
        traces = [m.get('trace') or {} for m in msgs if m['role'] == 'visitor']
        trusts = [((t.get('delta') or {}).get('trust')) for t in traces]
        trusts = [x for x in trusts if isinstance(x, (int, float))]
        tokens = sum((t.get('llmUsage') or {}).get('promptTokens', 0) + (t.get('llmUsage') or {}).get('completionTokens', 0)
                     for t in traces)
        crisis_turns = sum(1 for t in traces if (t.get('crisis') or {}).get('detected'))
        final.append({
            'char': char, 'mode': mode, 'id': o['id'], 'status': o['status'],
            'exitReason': o.get('exitReason'), 'turns': o.get('turnCount'),
            'dur': o.get('durationSec'), 'totalCost': o.get('totalCost'),
            'crisis': o.get('crisisEnded'),
            'cFallback': sum(1 for t in c if t == CB),
            'vFallback': sum(1 for t in v if t in VB),
            'cTrunc': sum(1 for t in c if t and t[-1] not in TERM),
            'cAvg': round(sum(len(t) for t in c) / len(c)) if c else 0,
            'vAvg': round(sum(len(t) for t in v) / len(v)) if v else 0,
            'vUniq': len(set(v)),
            'bdiTrust': round(sum(trusts), 3) if trusts else None,
            'tokens': tokens, 'crisisTurns': crisis_turns,
        })

out = {
    'combos': len(final),
    'missing': [f'{r["mode"]}@{r["char"]}' for r in final if r.get('missing')],
    'rows': final,
}
with open(os.path.join(LOG_DIR, 'final.json'), 'w', encoding='utf-8') as fh:
    json.dump(out, fh, ensure_ascii=False, indent=2)

print('| 角色 | 模式 | 状态 | 退出原因 | 轮数 | 耗时(s) | 咨询师均字 | 咨询师兜底 | 咨询师截断 | 来访均字 | 来访兜底 | 来访唯一句 | ΣΔtrust | Σtokens |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for r in final:
    if r.get('missing'):
        print(f'| {CHARS[r["char"]]} | {r["mode"]} | ❌ 缺 | - | - | - | - | - | - | - | - | - | - | - |')
        continue
    print(f'| {CHARS[r["char"]]} | {r["mode"]} | {r["status"]} | {r["exitReason"]} | '
          f'{r["turns"]} | {r["dur"]} | {r["cAvg"]} | {r["cFallback"]}/{r["turns"]} | {r["cTrunc"]} | '
          f'{r["vAvg"]} | {r["vFallback"]}/{r["turns"]} | {r["vUniq"]} | {r["bdiTrust"]} | {r["tokens"]} |')

print()
print('## 模式维度汇总')
print('| 模式 | 场次 | 平均轮数 | 平均耗时 | 咨询师均字 | 咨询师兜底合计 | 咨询师截断合计 | 来访兜底合计 |')
print('|---|---|---|---|---|---|---|---|')
for m in MODES:
    rs = [r for r in final if r['mode'] == m and not r.get('missing')]
    n = len(rs)
    if not n:
        continue
    print(f'| {m} | {n} | {round(sum(r["turns"] for r in rs) / n, 1)} | {round(sum(r["dur"] for r in rs) / n)} | '
          f'{round(sum(r["cAvg"] for r in rs) / n)} | {sum(r["cFallback"] for r in rs)} | '
          f'{sum(r["cTrunc"] for r in rs)} | {sum(r["vFallback"] for r in rs)} |')
