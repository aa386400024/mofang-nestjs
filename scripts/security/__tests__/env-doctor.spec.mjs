/**
 * AF-214 · env-doctor 纯函数用例。
 *
 * 只测解析 / 差集 / 判定契约，不读真实 .env、不碰网络、不校验真实密钥。
 */
import { describe, expect, it } from 'vitest';
import { classifyValue, diffEnvKeys, judgeEnvDoctor, parseEnvEntries, parseEnvKeys } from '../env-doctor.mjs';

describe('env-doctor · 解析', () => {
  it('跳过注释与空行，兼容 export 前缀与引号，保留空值', () => {
    const text = [
      '# 注释不算契约',
      '',
      'PLAIN=value',
      'export EXPORTED=1',
      'QUOTED="a b"',
      "SINGLE='x'",
      'EMPTY=',
      'WITH_COMMENT=abc # 行尾注释',
    ].join('\n');
    const { entries } = parseEnvEntries(text);
    expect(entries.map((entry) => entry.key)).toEqual(['PLAIN', 'EXPORTED', 'QUOTED', 'SINGLE', 'EMPTY', 'WITH_COMMENT']);
    expect(entries.find((entry) => entry.key === 'QUOTED').value).toBe('a b');
    expect(entries.find((entry) => entry.key === 'SINGLE').value).toBe('x');
    expect(entries.find((entry) => entry.key === 'EMPTY').value).toBe('');
    expect(entries.find((entry) => entry.key === 'WITH_COMMENT').value).toBe('abc');
  });

  it('识别重复键但保留首次出现的顺序', () => {
    const { entries, duplicates } = parseEnvEntries('A=1\nB=2\nA=3\n');
    expect(entries.map((entry) => entry.key)).toEqual(['A', 'B', 'A']);
    expect(duplicates).toEqual(['A']);
  });

  it('parseEnvKeys 按出现顺序去重', () => {
    expect(parseEnvKeys('A=1\nB=2\nA=3\n')).toEqual(['A', 'B']);
    expect(parseEnvKeys(undefined)).toEqual([]);
  });

  it('非法行不产生条目', () => {
    const { entries } = parseEnvEntries('NOT AN ENV LINE\n1BAD=x\n');
    expect(entries).toEqual([]);
  });
});

describe('env-doctor · 差集与分类', () => {
  it('difference 分别给出缺失与多余键', () => {
    expect(diffEnvKeys(['A', 'B', 'C'], ['B', 'C', 'D'])).toEqual({ missing: ['A'], extra: ['D'] });
    expect(diffEnvKeys(['A'], ['A'])).toEqual({ missing: [], extra: [] });
    expect(diffEnvKeys(undefined, undefined)).toEqual({ missing: [], extra: [] });
  });

  it('值分类只看形态', () => {
    expect(classifyValue('')).toBe('unset');
    expect(classifyValue('   ')).toBe('unset');
    expect(classifyValue('true')).toBe('bool');
    expect(classifyValue('8080')).toBe('number');
    expect(classifyValue('https://ark.cn-beijing.volces.com/api/v3')).toBe('url');
    expect(classifyValue('plain-text')).toBe('text');
  });
});

describe('env-doctor · 判定', () => {
  const base = {
    exampleExists: true,
    exampleKeys: ['A', 'B'],
    exampleSecretEntries: [],
    envExists: true,
    envEntries: [
      { key: 'A', value: '1' },
      { key: 'B', value: 'x' },
    ],
    duplicates: [],
    tracked: false,
    ignored: true,
  };

  it('配齐且未被跟踪时通过', () => {
    const { findings, exitCode } = judgeEnvDoctor(base);
    expect(exitCode).toBe(0);
    expect(findings).toEqual([]);
  });

  it('非 strict 下缺键只告警，strict 下失败', () => {
    const input = { ...base, envEntries: [{ key: 'A', value: '1' }] };
    expect(judgeEnvDoctor(input).exitCode).toBe(0);
    const strict = judgeEnvDoctor({ ...input, strict: true });
    expect(strict.exitCode).toBe(1);
    expect(strict.findings.map((finding) => finding.code)).toContain('ENV_KEY_MISSING');
  });

  it('.env 被跟踪时无论 strict 都失败', () => {
    const { exitCode, findings } = judgeEnvDoctor({ ...base, tracked: true });
    expect(exitCode).toBe(1);
    expect(findings.map((finding) => finding.code)).toContain('ENV_FILE_TRACKED');
  });

  it('.env 未被忽略但未被跟踪时只告警', () => {
    const { exitCode, findings } = judgeEnvDoctor({ ...base, ignored: false });
    expect(exitCode).toBe(0);
    expect(findings.map((finding) => finding.code)).toContain('ENV_FILE_NOT_IGNORED');
  });

  it('空值与重复键只告警，不抬高退出码', () => {
    const { exitCode, findings } = judgeEnvDoctor({
      ...base,
      envEntries: [
        { key: 'A', value: '' },
        { key: 'B', value: 'x' },
        { key: 'B', value: 'y' },
      ],
      duplicates: ['B'],
    });
    expect(exitCode).toBe(0);
    expect(findings.map((finding) => finding.code)).toEqual(['ENV_VALUE_EMPTY', 'ENV_KEY_DUPLICATE']);
  });

  it('.env.example 中出现非占位密钥值视为泄漏，直接失败', () => {
    const { exitCode, findings } = judgeEnvDoctor({
      ...base,
      exampleSecretEntries: [{ key: 'LLM_DOUBAO_API_KEY', value: 'ark-real-credential-1234' }],
    });
    expect(exitCode).toBe(1);
    expect(findings[0]).toMatchObject({ code: 'ENV_EXAMPLE_SECRET_VALUE', severity: 'error', key: 'LLM_DOUBAO_API_KEY' });
  });

  it('模板里的明确开发占位值只记 info，不抬高退出码', () => {
    const { exitCode, findings } = judgeEnvDoctor({
      ...base,
      exampleSecretEntries: [{ key: 'JWT_SECRET', value: 'xin-su-dev-secret-change-in-production' }],
    });
    expect(exitCode).toBe(0);
    expect(findings[0]).toMatchObject({ code: 'ENV_EXAMPLE_PLACEHOLDER_VALUE', severity: 'info' });
  });

  it('数值型与标识型键名不误判为密钥（PASSWORD_TTL_MIN / APPLE_KEY_ID / REDIS_KEY_PREFIX）', () => {
    const { exitCode, findings } = judgeEnvDoctor({
      ...base,
      exampleSecretEntries: [
        { key: 'PASSWORD_TTL_MIN', value: '30' },
        { key: 'APPLE_KEY_ID', value: 'ABC123' },
        { key: 'REDIS_KEY_PREFIX', value: 'mofang' },
      ],
    });
    expect(exitCode).toBe(0);
    expect(findings).toEqual([]);
  });

  it('模板缺失是错误，.env 缺失只是告警', () => {
    const noExample = judgeEnvDoctor({ ...base, exampleExists: false, exampleKeys: [] });
    expect(noExample.exitCode).toBe(1);
    const noEnv = judgeEnvDoctor({ ...base, envExists: false, envEntries: [] });
    expect(noEnv.findings.map((finding) => finding.code)).toContain('ENV_FILE_MISSING');
    expect(noEnv.exitCode).toBe(0);
  });

  it('关键键子集：缺失或留空一律失败（交接验收口径）', () => {
    const requiredCodes = (list) => list.filter((finding) => finding.code.startsWith('ENV_REQUIRED_KEY_')).map((finding) => finding.code);

    const missing = judgeEnvDoctor({ ...base, requiredKeys: ['LLM_DOUBAO_API_KEY', 'ENGINE_RENDER_FALLBACK_PROVIDERS'] });
    expect(missing.exitCode).toBe(1);
    expect(requiredCodes(missing.findings)).toEqual(['ENV_REQUIRED_KEY_MISSING', 'ENV_REQUIRED_KEY_MISSING']);

    const empty = judgeEnvDoctor({
      ...base,
      envEntries: [
        { key: 'A', value: '1' },
        { key: 'B', value: '2' },
        { key: 'LLM_DOUBAO_API_KEY', value: '' },
      ],
      requiredKeys: ['LLM_DOUBAO_API_KEY'],
    });
    expect(empty.exitCode).toBe(1);
    expect(requiredCodes(empty.findings)).toEqual(['ENV_REQUIRED_KEY_EMPTY']);

    const ok = judgeEnvDoctor({
      ...base,
      envEntries: [
        { key: 'A', value: '1' },
        { key: 'B', value: '2' },
        { key: 'LLM_DOUBAO_API_KEY', value: 'ark-xxxx' },
      ],
      requiredKeys: ['LLM_DOUBAO_API_KEY'],
    });
    expect(ok.exitCode).toBe(0);
  });

  it('findings 不含任何值字段（只允许键名与说明）', () => {
    const input = { ...base, envEntries: [{ key: 'SECRET_TOKEN', value: 'super-secret-value' }], strict: true };
    const { findings } = judgeEnvDoctor(input);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(JSON.stringify(finding)).not.toContain('super-secret-value');
      expect(Object.keys(finding).every((key) => ['code', 'severity', 'key', 'detail'].includes(key))).toBe(true);
    }
  });
});
