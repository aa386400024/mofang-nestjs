"""对练矩阵结果分析 (只读 REST, 不写库).

用法: python analyze.py <result_jsonl...> --out <summary_json> [--dump <dir>] [--print]
"""
import json
import os
import re
import sys
import urllib.request
from collections import Counter

BASE = 'http://localhost:3000/admin/api'
AUTH = 'Basic YWRtaW46MTIzNDU2'
FALLBACK_COUNSELOR = '嗯，我在听。你可以接着说。'
TERMINAL = '。？！…"”』）)~～'
MD_PAT = re.compile(r'\*\*|^#{1,6}\s|^\s*[-*]\s|\[[^\]]*\]\(', re.M)
ADVICE_PAT = re.compile(r'应该|必须|你要|建议你|最好|不要|不能再|你要学会')
COUNSELOR_VOICE = re.compile(r'我们从|你可以先|咨询|你说说|能说说|请你说|聊聊你|先说说')


def get(path):
    req = urllib.request.Request(BASE + path, headers={'Authorization': AUTH})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def load_rows(files):
    rows = []
    for f in files:
        with open(f, encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if not line.startswith('{'):
                    continue
                o = json.loads(line)
                if o.get('id') and o.get('status') not in (None, 'timeout_waiting', 'create_error'):
                    rows.append(o)
    uniq = {}
    for r in rows:
        uniq[(r['characterSlug'], r['counselorModeId'])] = r
    return list(uniq.values())


def analyze_session(row, dump_dir=None):
    rec = {
        'characterSlug': row['characterSlug'],
        'counselorModeId': row['counselorModeId'],
        'practiceSessionId': row['id'],
        'status': row['status'],
        'exitReason': row.get('exitReason'),
        'turnCount': row.get('turnCount'),
        'durationSec': row.get('durationSec'),
        'crisisEnded': row.get('crisisEnded'),
        'totalCost': row.get('totalCost'),
        'errorMessage': row.get('errorMessage'),
    }
    dsid = row.get('debugSessionId')
    if not dsid:
        rec['error'] = 'no_debug_session'
        return rec
    try:
        d = get(f'/debug/sessions/{dsid}')
    except Exception as e:  # noqa: BLE001
        rec['error'] = f'detail_fetch_failed: {e}'
        return rec

    msgs = d.get('messages') or []
    rec.update({'title': d.get('title'), 'msgCount': len(msgs),
                'debugTurnCount': d.get('turnCount'), 'debugStatus': d.get('status')})

    counselor = [m for m in msgs if m.get('role') == 'counselor']
    visitor = [m for m in msgs if m.get('role') == 'visitor']

    if counselor:
        texts = [(m.get('text') or '').strip() for m in counselor]
        lens = [len(t) for t in texts]
        rec['counselorAvgLen'] = round(sum(lens) / len(lens), 1)
        rec['counselorMaxLen'] = max(lens)
        rec['counselorMinLen'] = min(lens)
        rec['counselorMd'] = sum(1 for t in texts if MD_PAT.search(t))
        rec['counselorFallback'] = sum(1 for t in texts if t == FALLBACK_COUNSELOR)
        rec['counselorTruncated'] = sum(
            1 for t in texts if t and t[-1] not in TERMINAL)
        rec['counselorQ'] = round(sum(1 for t in texts if '？' in t or '?' in t) / len(texts), 2)
        rec['counselorAdvice'] = round(sum(1 for t in texts if ADVICE_PAT.search(t)) / len(texts), 2)
        rec['counselorDupMax'] = max(Counter(texts).values())
        rec['counselorAll'] = [t[:200] for t in texts]

    if visitor:
        texts = [(m.get('text') or '').strip() for m in visitor]
        lens = [len(t) for t in texts]
        rec['visitorAvgLen'] = round(sum(lens) / len(lens), 1)
        rec['visitorEmpty'] = sum(1 for t in texts if not t)
        rec['visitorDupMax'] = max(Counter(texts).values())
        rec['visitorCounselorVoice'] = sum(1 for t in texts if COUNSELOR_VOICE.search(t))
        rec['visitorAll'] = [t[:200] for t in texts]

    n_c = len(counselor) or 1
    rec['counselorFallbackRatio'] = round(rec.get('counselorFallback', 0) / n_c, 2)
    rec['visitorDupRatio'] = round(rec.get('visitorDupMax', 0) / (len(visitor) or 1), 2)

    traces = [m.get('trace') for m in msgs if m.get('trace')]
    rec['traceCount'] = len(traces)
    bdi_first = bdi_last = None
    if traces:
        for t in traces:
            if isinstance(t, dict) and t.get('bdiSnapshot'):
                if bdi_first is None:
                    bdi_first = t['bdiSnapshot']
                bdi_last = t['bdiSnapshot']
    rec['bdiFirst'] = bdi_first
    rec['bdiLast'] = bdi_last
    if bdi_first and bdi_last:
        keys = ['trust', 'safety', 'bond', 'valence', 'arousal', 'resistance']
        rec['bdiDelta'] = {k: round(bdi_last.get(k, 0) - bdi_first.get(k, 0), 3) for k in keys}

    if dump_dir:
        os.makedirs(dump_dir, exist_ok=True)
        path = os.path.join(dump_dir, f"{row['counselorModeId']}-{row['characterSlug']}.json")
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump({'row': row, 'detail': d}, fh, ensure_ascii=False, indent=1)
    return rec


def main():
    out_path = dump_dir = None
    do_print = False
    files = []
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--out':
            out_path = args[i + 1]; i += 2
        elif args[i] == '--dump':
            dump_dir = args[i + 1]; i += 2
        elif args[i] == '--print':
            do_print = True; i += 1
        else:
            files.append(args[i]); i += 1
    rows = load_rows(files)
    results = [analyze_session(r, dump_dir) for r in rows]
    summary = {'total': len(results), 'results': results}
    if out_path:
        with open(out_path, 'w', encoding='utf-8') as fh:
            json.dump(summary, fh, ensure_ascii=False, indent=1)
    if do_print:
        hdr = ('mode', 'char', 'st', 'exit', 'turns', 'dur', 'cAvg', 'fb', 'trunc', 'md', 'vAvg', 'vdup', 'bdiΔtrust', 'degraded')
        print(' | '.join(hdr))
        for r in results:
            if r.get('error'):
                print(f"{r['counselorModeId']} | {r['characterSlug'][:22]} | ERROR {r['error']}")
                continue
            deg = (r.get('counselorFallbackRatio', 0) >= 0.5 or r.get('visitorDupRatio', 0) >= 0.4)
            print(' | '.join(str(x) for x in (
                r['counselorModeId'], r['characterSlug'][:22], r['status'], r.get('exitReason'),
                r.get('turnCount'), r.get('durationSec'), r.get('counselorAvgLen'),
                r.get('counselorFallback'), r.get('counselorTruncated'), r.get('counselorMd'),
                r.get('visitorAvgLen'), r.get('visitorDupMax'),
                r.get('bdiDelta', {}).get('trust'), 'DEGRADED' if deg else 'ok')))
    else:
        print(f'analyzed {len(results)}')


if __name__ == '__main__':
    main()
