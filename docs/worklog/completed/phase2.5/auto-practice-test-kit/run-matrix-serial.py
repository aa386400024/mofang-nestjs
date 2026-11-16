"""串行补跑: 缺失组合 + 降级场次 (并发 1, 每场间隔 8s).

输出 matrix3.jsonl, 字段与前面一致 + vFallbackRatio.
"""
import glob
import json
import os
import time
import urllib.request

LOG_DIR = 'C:/Users/41391/AppData/Local/Doubao/User Data/Profile 5/.doubao/agent_mode/workspace/logs'
BASE = 'http://localhost:3000/admin/api'
AUTH = 'Basic YWRtaW46MTIzNDU2'
OUT = os.path.join(LOG_DIR, 'matrix3.jsonl')

CHARS = [
    'vpt_self_worth_intellectualization_l1',
    'vpt_grief_avoidance_l1',
    'vpt_intimate_avoidance_l1',
    'vpt_workplace_intellectualization_l1',
]
MODES = ['expert', 'intermediate', 'novice', 'chatty', 'cold', 'preachy', 'nonsense']
VB = [
    '嗯……让我想想，该怎么说。',
    '……我先缓一下，我们接着说。',
    '我不太想现在讲清楚，能先聊点别的吗？',
    '最近确实有点难说出口……我们慢慢聊吧。',
]


def req(path, method='GET', body=None, attempts=6):
    """带重试的请求 (后端重启窗口内不致命)."""
    data = None if body is None else json.dumps(body).encode('utf-8')
    last = None
    for i in range(attempts):
        try:
            r = urllib.request.Request(BASE + path, data=data, method=method,
                                       headers={'Authorization': AUTH, 'Content-Type': 'application/json'})
            return json.loads(urllib.request.urlopen(r, timeout=40).read().decode('utf-8'))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(6 * (i + 1))
    raise last


# 1. 现有覆盖 + 降级比例 (用 detail2 离线结果)
covered = {}
for f in ['matrix.jsonl', 'matrix2.jsonl']:
    p = os.path.join(LOG_DIR, f)
    if not os.path.exists(p):
        continue
    for line in open(p, encoding='utf-8'):
        line = line.strip()
        if not line.startswith('{'):
            continue
        o = json.loads(line)
        if o.get('id') and o.get('status') not in (None, 'timeout_waiting', 'create_error'):
            covered[(o['characterSlug'], o['counselorModeId'])] = o

vfb = {}
for path in glob.glob(os.path.join(LOG_DIR, 'detail2', '*.json')):
    name = os.path.basename(path)[:-5]
    mode, char = name.split('-', 1)
    d = json.load(open(path, encoding='utf-8'))
    msgs = d['detail']['messages']
    v = [(m.get('text') or '').strip() for m in msgs if m['role'] == 'visitor']
    n = len(v) or 1
    vfb[(char, mode)] = sum(1 for t in v if t in VB) / n

todo = []
for c in CHARS:
    for m in MODES:
        if (c, m) not in covered:
            todo.append((c, m, 'missing'))
        elif vfb.get((c, m), 0) >= 0.5:
            todo.append((c, m, f'degraded({vfb.get((c, m)):.0%})'))

# 断点续跑: 已在 matrix3 里成功落地的组合跳过
if os.path.exists(OUT):
    done3 = set()
    for line in open(OUT, encoding='utf-8'):
        line = line.strip()
        if not line.startswith('{'):
            continue
        o = json.loads(line)
        if o.get('id') and o.get('status'):
            done3.add((o['characterSlug'], o['counselorModeId']))
    todo = [t for t in todo if (t[0], t[1]) not in done3]

print(f'待补跑 {len(todo)} 场: ' + ', '.join(f'{m}@{c.split("_")[1]}({r})' for c, m, r in todo))

max_turns = 12
for idx, (char, mode, why) in enumerate(todo, 1):
    t0 = time.time()
    created = req('/auto-practice/sessions', 'POST',
                  {'characterSlug': char, 'counselorModeId': mode, 'maxTurns': max_turns})
    sid = created['practiceSessionId']
    s = None
    for _ in range(90):
        time.sleep(6)
        s = req(f'/auto-practice/sessions/{sid}')
        if s['status'] != 'running':
            break
    dur = round(time.time() - t0)
    extra = {}
    try:
        d = req(f'/debug/sessions/{s["debugSessionId"]}')
        msgs = d['messages']
        v = [(m.get('text') or '').strip() for m in msgs if m['role'] == 'visitor']
        n = len(v) or 1
        extra = {'vFallbackRatio': round(sum(1 for t in v if t in VB) / n, 2),
                 'vUniq': len(set(v))}
    except Exception as e:  # noqa: BLE001
        extra = {'detailError': str(e)}
    row = {
        'characterSlug': s['characterSlug'],
        'counselorModeId': s['counselorModeId'],
        'id': s['id'],
        'debugSessionId': s['debugSessionId'],
        'status': s['status'],
        'exitReason': s.get('exitReason'),
        'turnCount': s.get('turnCount'),
        'maxTurns': s.get('maxTurns'),
        'crisisEnded': s.get('crisisEnded'),
        'totalCost': s.get('totalCost'),
        'errorMessage': s.get('errorMessage'),
        'durationSec': dur,
        'retryOf': why,
        **extra,
    }
    with open(OUT, 'a', encoding='utf-8') as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + '\n')
    print(f'[{idx}/{len(todo)}] {mode}@{char} -> {s["status"]}/{s.get("exitReason")} '
          f'turns={s.get("turnCount")} dur={dur}s vFallback={extra.get("vFallbackRatio")}')
    time.sleep(8)

print('RETRY DONE')
