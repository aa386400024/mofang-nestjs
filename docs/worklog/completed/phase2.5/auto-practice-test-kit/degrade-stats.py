"""离线统计 detail2 里的降级情况 (不请求后端)."""
import json
import os
import glob

BASE = 'C:/Users/41391/AppData/Local/Doubao/User Data/Profile 5/.doubao/agent_mode/workspace/logs/detail2'
CB = '嗯，我在听。你可以接着说。'
VISITOR_FB = [
    '嗯……让我想想，该怎么说。',
    '……我先缓一下，我们接着说。',
    '我不太想现在讲清楚，能先聊点别的吗？',
    '最近确实有点难说出口……我们慢慢聊吧。',
]
TERMINAL = '。？！…"”』）)~～'

rows = []
for path in sorted(glob.glob(os.path.join(BASE, '*.json'))):
    d = json.load(open(path, encoding='utf-8'))
    msgs = d['detail']['messages']
    c = [(m.get('text') or '').strip() for m in msgs if m['role'] == 'counselor']
    v = [(m.get('text') or '').strip() for m in msgs if m['role'] == 'visitor']
    cf = sum(1 for t in c if t == CB)
    vf = sum(1 for t in v if t in VISITOR_FB)
    trunc = [t for t in c if t and t[-1] not in TERMINAL]
    row = {
        'file': os.path.basename(path),
        'status': d['row'].get('status'),
        'turns': d['row'].get('turnCount'),
        'c': len(c), 'v': len(v),
        'cFallback': cf, 'vFallback': vf,
        'cTrunc': len(trunc), 'vUniq': len(set(v)),
    }
    rows.append(row)
    print(json.dumps(row, ensure_ascii=False))
    for t in trunc:
        print('   TRUNC >>', t[:120])
