/**
 * AF-218 · 环境变量体检（env-doctor）。
 *
 * 目的：在不打印任何密钥值的前提下，回答三个部署期问题：
 *   1. 本机 `.env` 是否按 `.env.example`（部署契约）的生效键集配齐；
 *   2. `.env` 是否被 git 跟踪 / 是否被 `.gitignore` 忽略；
 *   3. `.env.example` 里是否误填了真实密钥（模板入库 = 密钥入库）。
 *
 * 为什么需要它：`.env` 靠人工逐台填，漏一个键不会报错，功能只会默默走默认值；
 * 而「另一台机器到底配没配」在跨机协作里没有任何可验证的现场。体检把这件事
 * 变成一条命令 + 一份可审计输出。
 *
 * 用法：pnpm env:doctor [--env <path>] [--example <path>] [--strict] [--json]
 * 判定：`.env` 被跟踪、或 `--strict` 下缺键 → exit 1；其余 finding 只告警。
 * 纪律：永不打印值本身，只给键名、长度与分类。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 键名「可能承载密钥」的判定：必须同时命中密钥语义、且不命中数值/标识语义。
 * 只用 `KEY` 一刀切会把 REDIS_KEY_PREFIX（命名空间）、APPLE_KEY_ID（标识）、
 * PASSWORD_TTL_MIN（数值）全误判成密钥——误报会让体检失去可信度。
 */
const SECRET_KEY_PATTERN = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY|ACCESS_KEY|CLIENT_SECRET)/i;
const NON_SECRET_SUFFIX = /(_TTL|_TTL_MIN|_TTL_SEC|_SEC|_MIN|_MINUTES|_DAYS|_LIMIT|_BUDGET|_COUNT|_PREFIX|_KEY_ID|_MAX|_MAX_|_MS)(_|$)/i;

/** 模板里允许出现的开发占位值（明确标注「上生产必须换」）。 */
const PLACEHOLDER_PATTERN = /(change[-_ ]?(in|me)|placeholder|your[_-]|example|dummy|sample|dev[-_]only|<[^>]+>|\$\{[^}]+\})/i;

export function looksSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key ?? '')) && !NON_SECRET_SUFFIX.test(String(key ?? ''));
}

export function isPlaceholderValue(value) {
  return PLACEHOLDER_PATTERN.test(String(value ?? ''));
}

/**
 * 解析 env 文本为条目列表。
 * 兼容 `export ` 前缀、单双引号包裹、行尾注释、空值与重复键。
 * @param {string} text
 * @returns {{entries:{key:string,value:string,line:number}[], duplicates:string[]}}
 */
export function parseEnvEntries(text) {
  const entries = [];
  const seen = new Map();
  const duplicates = [];
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) return;
    const key = match[1];
    const value = unquote(match[2].trim());
    if (seen.has(key)) duplicates.push(key);
    seen.set(key, true);
    entries.push({ key, value, line: index + 1 });
  });
  return { entries, duplicates };
}

/** 只取键名集合（按出现顺序去重）。 */
export function parseEnvKeys(text) {
  return [...new Set(parseEnvEntries(text).entries.map((entry) => entry.key))];
}

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  // 未加引号时的行尾注释：`KEY=value # note` → value
  const hash = value.indexOf(' #');
  return (hash >= 0 ? value.slice(0, hash) : value).trim();
}

/**
 * 模板键集与实配键集的差集。
 * @param {string[]} exampleKeys
 * @param {string[]} envKeys
 * @returns {{missing:string[], extra:string[]}}
 */
export function diffEnvKeys(exampleKeys, envKeys) {
  const example = new Set(exampleKeys ?? []);
  const actual = new Set(envKeys ?? []);
  return {
    missing: [...example].filter((key) => !actual.has(key)),
    extra: [...actual].filter((key) => !example.has(key)),
  };
}

/** 值的形态分类（只看形态，不看内容）。 */
export function classifyValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'unset';
  if (/^(true|false)$/i.test(text)) return 'bool';
  if (/^[0-9]+(\.[0-9]+)?$/.test(text)) return 'number';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return 'url';
  return 'text';
}

/**
 * 合成体检结论（纯函数，供单测与 CLI 共用）。
 * @param {{
 *   exampleExists:boolean, exampleKeys:string[], exampleSecretEntries:{key:string,value:string}[],
 *   envExists:boolean, envEntries:{key:string,value:string}[], duplicates:string[],
 *   tracked:boolean, ignored:boolean, strict?:boolean, requiredKeys?:string[]
 * }} input
 * @returns {{findings:{code:string,severity:'error'|'warning'|'info',key?:string,detail?:string}[], exitCode:number}}
 */
export function judgeEnvDoctor(input) {
  const findings = [];
  const strict = input.strict === true;

  if (!input.exampleExists) {
    findings.push({ code: 'ENV_EXAMPLE_MISSING', severity: 'error', detail: '.env.example 是部署契约，缺失则无法判断键集' });
  }
  if (!input.envExists) {
    findings.push({ code: 'ENV_FILE_MISSING', severity: 'warning', detail: '.env 不存在：本机所有键将走代码默认值' });
  }
  if (input.tracked) {
    findings.push({ code: 'ENV_FILE_TRACKED', severity: 'error', detail: '.env 已被 git 跟踪：密钥已入库，必须先移除并轮换' });
  } else if (input.envExists && input.ignored === false) {
    findings.push({ code: 'ENV_FILE_NOT_IGNORED', severity: 'warning', detail: '.env 未被 .gitignore 覆盖，下一次 git add 可能入库' });
  }

  for (const entry of input.exampleSecretEntries ?? []) {
    if (!looksSecretKey(entry.key)) continue;
    const value = String(entry.value ?? '').trim();
    if (!value) continue;
    // 数值 / 布尔值是配置而不是密钥：无论键名多像，都不该报泄漏。
    const shape = classifyValue(value);
    if (shape === 'number' || shape === 'bool') continue;
    if (isPlaceholderValue(value)) {
      findings.push({
        code: 'ENV_EXAMPLE_PLACEHOLDER_VALUE',
        severity: 'info',
        key: entry.key,
        detail: '模板中为明确标注的开发占位值，上生产必须替换',
      });
      continue;
    }
    findings.push({
      code: 'ENV_EXAMPLE_SECRET_VALUE',
      severity: 'error',
      key: entry.key,
      detail: '.env.example 中该密钥键已有非占位值（模板入库即密钥入库）',
    });
  }

  const { missing, extra } = diffEnvKeys(
    input.exampleKeys,
    (input.envEntries ?? []).map((entry) => entry.key),
  );
  for (const key of missing) {
    findings.push({
      code: 'ENV_KEY_MISSING',
      severity: strict ? 'error' : 'warning',
      key,
      detail: '模板声明的生效键未在本机 .env 出现',
    });
  }
  for (const key of extra) {
    findings.push({ code: 'ENV_KEY_EXTRA', severity: 'info', key, detail: '本机 .env 有模板未声明的键（可能是预留/本地覆盖）' });
  }
  for (const entry of input.envEntries ?? []) {
    if (classifyValue(entry.value) === 'unset') {
      // 密钥键留空值得 warning（能力未启用）；普通键留空只是走默认值，记 info 免噪声。
      findings.push({
        code: 'ENV_VALUE_EMPTY',
        severity: looksSecretKey(entry.key) ? 'warning' : 'info',
        key: entry.key,
        detail: looksSecretKey(entry.key) ? '密钥键留空：相关功能会走未配置分支' : '值为空：将走代码默认值',
      });
    }
  }
  for (const key of input.duplicates ?? []) {
    findings.push({ code: 'ENV_KEY_DUPLICATE', severity: 'warning', key, detail: '同一键在 .env 中重复声明，后者生效' });
  }

  // 交接验收用的关键键子集：缺失或留空一律 error（不受 --strict 影响），
  // 这是「另一台机器到底配没配这一把」的可验证口径。
  const byKey = new Map((input.envEntries ?? []).map((entry) => [entry.key, entry.value]));
  for (const key of input.requiredKeys ?? []) {
    if (!byKey.has(key)) {
      findings.push({ code: 'ENV_REQUIRED_KEY_MISSING', severity: 'error', key, detail: '交接要求的关键键在本机 .env 中不存在' });
    } else if (classifyValue(byKey.get(key)) === 'unset') {
      findings.push({ code: 'ENV_REQUIRED_KEY_EMPTY', severity: 'error', key, detail: '交接要求的关键键存在但值为空' });
    }
  }

  const exitCode = findings.some((finding) => finding.severity === 'error') ? 1 : 0;
  return { findings, exitCode };
}

function isTracked(relPath) {
  try {
    execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--error-unmatch', relPath], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function isIgnored(relPath) {
  try {
    execFileSync('git', ['-C', REPO_ROOT, 'check-ignore', '-q', relPath], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function secretEntriesInExample(text) {
  return parseEnvEntries(text).entries;
}

/** 解析 `--flag value` 与布尔开关。 */
function parseArgs(argv) {
  const result = { env: '.env', example: '.env.example', strict: false, json: false, verbose: false, keys: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict') result.strict = true;
    else if (arg === '--json') result.json = true;
    else if (arg === '--verbose') result.verbose = true;
    else if (arg === '--env') result.env = argv[++index] ?? result.env;
    else if (arg === '--example') result.example = argv[++index] ?? result.example;
    else if (arg === '--keys') {
      result.keys = String(argv[++index] ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = resolve(REPO_ROOT, args.env);
  const examplePath = resolve(REPO_ROOT, args.example);
  const exampleText = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '';
  const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const { entries, duplicates } = parseEnvEntries(envText);

  const report = judgeEnvDoctor({
    exampleExists: existsSync(examplePath),
    exampleKeys: parseEnvKeys(exampleText),
    exampleSecretEntries: secretEntriesInExample(exampleText),
    envExists: existsSync(envPath),
    envEntries: entries,
    duplicates,
    tracked: isTracked(args.env),
    ignored: isIgnored(args.env),
    strict: args.strict,
    requiredKeys: args.keys,
  });

  if (args.json) {
    console.log(JSON.stringify({ env: args.env, example: args.example, strict: args.strict, ...report }, null, 2));
  } else {
    // 批量型 finding（缺键 / 多余键 / 空值）默认折叠成一行计数 + 样例，避免 200 行刷屏；
    // --verbose 才逐条展开。错误与结构性告警永远逐条打印。
    const MASS_CODES = new Set(['ENV_KEY_MISSING', 'ENV_KEY_EXTRA', 'ENV_VALUE_EMPTY']);
    const singles = [];
    const groups = new Map();
    for (const finding of report.findings) {
      if (!args.verbose && MASS_CODES.has(finding.code)) {
        const key = `${finding.code}|${finding.severity}`;
        const bucket = groups.get(key) ?? { finding, items: [] };
        bucket.items.push(finding);
        groups.set(key, bucket);
      } else {
        singles.push(finding);
      }
    }
    const counts = (list) => list.reduce((acc, finding) => ({ ...acc, [finding.severity]: (acc[finding.severity] ?? 0) + 1 }), {});
    const summary = counts(report.findings);
    console.log(
      `[env-doctor] env=${args.env} example=${args.example} strict=${args.strict}${args.keys.length ? ` keys=${args.keys.join(',')}` : ''}`,
    );
    console.log(`[env-doctor] 键数：模板=${parseEnvKeys(exampleText).length} 实配=${entries.length}`);
    for (const finding of singles) {
      const key = finding.key ? ` ${finding.key}` : '';
      console.log(`[${finding.severity.toUpperCase()}] ${finding.code}${key} — ${finding.detail}`);
    }
    for (const { finding, items } of groups.values()) {
      const sample = items
        .map((item) => item.key)
        .filter(Boolean)
        .slice(0, 5)
        .join('、');
      console.log(
        `[${finding.severity.toUpperCase()}] ${finding.code} ×${items.length}${sample ? ` — 示例：${sample}` : ''}（--verbose 展开）`,
      );
    }
    console.log(
      `[env-doctor] ${report.exitCode === 0 ? 'PASS' : 'FAIL'}（error=${summary.error ?? 0} warning=${summary.warning ?? 0} info=${summary.info ?? 0}）`,
    );
  }
  process.exitCode = report.exitCode;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main();
}
