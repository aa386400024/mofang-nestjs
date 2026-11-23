/**
 * 框架契约包完整性校验（CI 与本地通用）。
 *
 * 校验点：
 *   1. PROVENANCE.json 存在且字段齐全；
 *   2. schemas/ 下文件集合与清单完全一致，无多无少；
 *   3. 每个文件 SHA-256 与清单一致（防手改 / 传输损坏）；
 *   4. versions.json 的 framework.version 与包版本一致；
 *   5. 每份 schema 的 $id 末尾版本与 versions.json 登记一致。
 *
 * 退出码：0 通过；1 失败。CI 用它把契约包变成可验证的供应链制品。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const BUNDLE_ROOT = resolve(ROOT, 'contracts', 'agent-collaboration-framework');

function resolveBundleVersion(argv) {
  const index = argv.indexOf('--bundle');
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  if (process.env.ORCH_FRAMEWORK_BUNDLE) return process.env.ORCH_FRAMEWORK_BUNDLE;
  const versions = readdirSync(BUNDLE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const left = a.split('.').map(Number);
      const right = b.split('.').map(Number);
      for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
      return 0;
    });
  if (versions.length === 0) throw new Error(`契约包目录为空：${BUNDLE_ROOT}`);
  return versions.at(-1);
}

const BUNDLE_VERSION = resolveBundleVersion(process.argv.slice(2));
const BUNDLE = resolve(BUNDLE_ROOT, BUNDLE_VERSION);
const PROVENANCE = join(BUNDLE, 'PROVENANCE.json');
const SCHEMAS = join(BUNDLE, 'schemas');

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

if (!existsSync(PROVENANCE)) fail(`来源清单不存在：${PROVENANCE}`);
if (!existsSync(SCHEMAS)) fail(`schema 目录不存在：${SCHEMAS}`);

if (existsSync(PROVENANCE) && existsSync(SCHEMAS)) {
  const provenance = readJson(PROVENANCE);
  const required = ['fileKind', 'schemaVersion', 'frameworkVersion', 'sourceRepository', 'sourceRef', 'sourceCommit', 'files'];
  for (const key of required) {
    if (provenance[key] === undefined || provenance[key] === null) fail(`PROVENANCE 缺字段：${key}`);
  }
  if (!Array.isArray(provenance.files) || provenance.files.length === 0) fail('PROVENANCE.files 必须为非空数组');
  if (!/^[0-9a-f]{40}$/.test(String(provenance.sourceCommit))) fail(`sourceCommit 非 40 位 SHA：${provenance.sourceCommit}`);

  const expected = new Set();
  for (const entry of provenance.files ?? []) {
    const rel = String(entry.path ?? '');
    if (!rel.startsWith('schemas/') || rel.includes('..')) {
      fail(`非法清单路径：${rel}`);
      continue;
    }
    const abs = join(BUNDLE, rel);
    if (!existsSync(abs)) {
      fail(`清单文件缺失：${rel}`);
      continue;
    }
    expected.add(rel.replace(/^schemas\//, ''));
    const actual = sha256(abs);
    if (actual !== String(entry.sha256).toLowerCase()) {
      fail(`哈希不一致：${rel} 期望 ${entry.sha256} 实际 ${actual}`);
    }
  }

  const actualFiles = readdirSync(SCHEMAS)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const file of actualFiles) {
    if (!expected.has(file)) fail(`schema 目录存在未登记文件：${file}`);
  }
  for (const file of expected) {
    if (!actualFiles.includes(file)) fail(`清单文件未落在 schema 目录：${file}`);
  }

  const versions = readJson(join(SCHEMAS, 'versions.json'));
  if (versions.framework?.version !== provenance.frameworkVersion) {
    fail(`versions.json framework.version=${versions.framework?.version} 与包版本 ${provenance.frameworkVersion} 不一致`);
  }

  for (const [name, contract] of Object.entries(versions.contracts ?? {})) {
    if (!contract?.path || !contract?.version) continue;
    const file = join(SCHEMAS, contract.path.replace(/^schemas\//, ''));
    if (!existsSync(file)) {
      fail(`versions.json 登记的契约文件缺失：${name} → ${contract.path}`);
      continue;
    }
    const schema = readJson(file);
    const id = String(schema.$id ?? '');
    if (!id.endsWith(`:${contract.version}`)) {
      fail(`契约 ${name} 的 $id=${id} 与 versions.json 版本 ${contract.version} 不一致`);
    }
  }

  if (!process.exitCode) {
    console.log(
      `[PASS] 框架契约包 ${provenance.frameworkVersion}（${provenance.sourceRef} / ${provenance.sourceCommit.slice(0, 7)}）：${provenance.files.length} 个文件哈希与版本一致`,
    );
  }
}
