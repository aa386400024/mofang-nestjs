// V2026-11-03 治本 (WP25 · Phase1 封版审查 · env 覆盖一致性):
//   目的: 把任务单 §5 验收 #3「`.env.example` 与代码 `process.env.*` 一一对应」
//         从"人工比对"变成**机器断言** ——
//           ① 代码里读的每个 env 键, 都必须在 `.env.example` 里有**生效行**
//              (漏了 = 运维照抄模板时根本不知道有这个键, 配不了);
//           ② `.env.example` 里的每个**生效行**, 都必须在代码里被读到
//              (留了却没人读 = 骗人的配置项, 运维改了以为生效了).
//
//   为什么必须是断言而不是注释:
//     `.env.example` 是**部署契约**: 它是运维和内测操作者唯一能看到的"这个服务
//     能配什么"的清单. 两头漂移的代价不对称 ——
//       · 漏键: 键存在但模板里没有 → 部署时配不上, 功能默默用默认值;
//       · 多键: 模板里配了但代码不读 → 改了半天不生效, 排查成本极高.
//     这两类漂移都不会报错, 只会静默, 所以只能靠机器守住.
//
//   为什么用 TypeScript 编译器 API 而不是正则:
//     正则抽 env 读取有三个必然翻车的点:
//       - 注释里的示例 (本仓库注释密度极高) 会被误判成读取点;
//       - 多行写法 (process.env\n  .FOO) 会漏;
//       - bracket / dot / 计算键三种访问形态要各写一条规则.
//     走 AST 是**精确**的: 注释根本不存在于 AST 里.
//
//   派生键 (计算键) 的处理:
//     有两族 env 键在代码里是**计算出来**的, AST 只能看到模板字符串:
//       · LLM_<PROVIDER>_API_KEY  (src/llm/config/provider-env.ts:59 的规律)
//       · ENGINE_CAP_<DIM>_<UP|DOWN> (WP15 时代在 src/engine-core/cognition/
//         state-transition.ts 里用计算键读 —— **WP26 P2-14 已改掉**)
//     它们按"键名规律"存在, 不在源码里逐个写出来 —— 所以在下面显式登记,
//     **登记项必须与代码里的推导口径一致**, 否则断言就形同虚设.
//
//   V2026-11-03 治本 (WP26 · P2-13/P2-14 — ENGINE_CAP_* 族退役):
//     内核不再读 env (cap 参数改注入), 18 个 `ENGINE_CAP_*` 键改由适配层
//     (src/engine-adapters/wiring/delta-cap.config.ts) **逐个字面量**读 ——
//     字面量读取能被本文件的 AST 抽取直接看到, 于是"漏写一个键"这条缺口
//     由断言① (代码读的键必须有生效行) 反向守住, 不再需要派生族登记.
//     用例③ 相应拆成: ③ 校验**仍在派生**的 LLM 族; ③b 校验 18 个 cap 键
//     已是字面量、且内核树里**不再有**任何 ENGINE_CAP_* 字符串.
//
//   V2026-11-03 治本 (WP34 — ENGINE_MOD_* 族):
//     人格调节系数 (10 个 `ENGINE_MOD_*` 键) 沿用同一治本: 适配层
//     (src/engine-adapters/wiring/personality-modulator.config.ts) 逐个字面量读,
//     内核零 env 读取. 用例③c 守着这件事.
//
//   V2026-11-04 WP53 (人格调节算子扩展到同盟三维):
//     依恋系数从 2 列扩到 4 列 (trust / resistance / safety / bond),
//     ENGINE_MOD_* 键从 10 个增到 18 个 (WP53 追加 4 依恋 × 2 同盟增益系数).
//     新增的 8 个键同样**逐个字面量**读, 清单同步扩到 18 条 ——
//     用例③c 的"一个不多一个不少"正是防"模板里躺着一条没人读的键"。
//
//   V2026-11-03 治本 (WP42 — ENGINE_ALLIANCE_* 族):
//     咨询同盟三维 (trust / safety / bond) 的系数与门槛 (25 个 `ENGINE_ALLIANCE_*` 键)
//     同一治本: 适配层 (src/engine-adapters/wiring/alliance-config.ts) 逐个字面量读,
//     内核零 env 读取. 用例③d 守着这件事.
//     cap 族同步从 18 键扩到 22 键 (新增 SAFETY / BOND 两维, 见用例③b).
//
//   V2026-11-03 治本 (WP36 — ENGINE_DECAY_* 族):
//     跨会话间隔衰减的三个半衰期 (3 个 `ENGINE_DECAY_*` 键) 同一治本: 适配层
//     (src/engine-adapters/wiring/session-decay.config.ts) 逐个字面量读, 内核零 env 读取.
//     用例③e 守着这件事.
//
//   边界: 只读文件; 不改任何代码 / 不改 .env.example; 不起 Nest 容器.
//
//   验证: npx vitest run test/config/wp25-env-example-coverage.spec.ts
//   时间戳: 2026-11-03 GMT+8

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

import ts from 'typescript';

/** 仓库根目录. */
const REPO_ROOT = path.join(__dirname, '../..');
/** 源码根目录. */
const SRC_ROOT = path.join(REPO_ROOT, 'src');
/** env 模板. */
const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');

/** env 键名形状 (大写 + 下划线). */
const ENV_KEY_SHAPE = /^[A-Z][A-Z0-9_]*$/;

/**
 * 派生族登记: 计算出来的 env 键.
 *
 * 每个条目都必须写清**推导口径的出处** —— 口径变了这里要跟着改,
 * 否则断言会替代码的漂移背书 (比没有断言更糟).
 */
const DERIVED_ENV_KEYS: Readonly<Record<string, readonly string[]>> = {
  // src/llm/config/provider-env.ts:59 —— `LLM_${providerId.toUpperCase()}_API_KEY`
  //   (MiniMax 例外: 它走历史命名 MINIMAX_API_KEY, 不在本族里).
  'LLM_<PROVIDER>_API_KEY': ['LLM_OPENAI_API_KEY', 'LLM_DEEPSEEK_API_KEY', 'LLM_DOUBAO_API_KEY', 'LLM_QWEN_API_KEY', 'LLM_CUSTOM_API_KEY'],
};

/**
 * 单回合 delta cap 的 22 个 env 键 (WP26 · P2-13/P2-14 · WP42 加两维).
 *
 * 这族**不再是派生键**: 内核不再读 env, 适配层逐个字面量读 → 已被 AST 抽取覆盖.
 * 这里留一份清单, 是为了断言"22 个键一个不多一个不少" —— 少一个 = 那个维度的 cap
 * 永远配不上 (静默失效); 多一个 = 模板里躺着一条没人读的键 (骗人的配置项).
 */
const DELTA_CAP_ENV_KEYS: readonly string[] = [
  'ENGINE_CAP_TRUST_UP',
  'ENGINE_CAP_TRUST_DOWN',
  'ENGINE_CAP_SAFETY_UP',
  'ENGINE_CAP_SAFETY_DOWN',
  'ENGINE_CAP_BOND_UP',
  'ENGINE_CAP_BOND_DOWN',
  'ENGINE_CAP_VALENCE_UP',
  'ENGINE_CAP_VALENCE_DOWN',
  'ENGINE_CAP_AROUSAL_UP',
  'ENGINE_CAP_AROUSAL_DOWN',
  'ENGINE_CAP_VERBAL_UP',
  'ENGINE_CAP_VERBAL_DOWN',
  'ENGINE_CAP_DEPTH_UP',
  'ENGINE_CAP_DEPTH_DOWN',
  'ENGINE_CAP_STYLE_UP',
  'ENGINE_CAP_STYLE_DOWN',
  'ENGINE_CAP_POSITIVE_UP',
  'ENGINE_CAP_POSITIVE_DOWN',
  'ENGINE_CAP_NEGATIVE_UP',
  'ENGINE_CAP_NEGATIVE_DOWN',
  'ENGINE_CAP_DEPENDENCY_UP',
  'ENGINE_CAP_DEPENDENCY_DOWN',
];

/**
 * 人格调节系数的 18 个 env 键 (WP34 的 10 个 + WP53 的 8 个).
 *
 * 与 cap 族同一治本: 适配层**逐个字面量**读 → 已被 AST 抽取覆盖 (漏写一个键,
 * 断言① 立刻变红). 这里留一份清单, 是为了断言"18 个键一个不多一个不少" ——
 * 少一个 = 那个系数永远配不上 (静默失效); 多一个 = 模板里躺着一条没人读的键.
 *
 * WP53 追加的 8 个 = 4 依恋类型 × 2 个同盟增益系数 (safety / bond).
 */
const PERSONALITY_MOD_ENV_KEYS: readonly string[] = [
  'ENGINE_MOD_SECURE_TRUST_SCALE',
  'ENGINE_MOD_SECURE_RESIST_SCALE',
  'ENGINE_MOD_SECURE_SAFETY_SCALE',
  'ENGINE_MOD_SECURE_BOND_SCALE',
  'ENGINE_MOD_AVOIDANT_TRUST_SCALE',
  'ENGINE_MOD_AVOIDANT_RESIST_SCALE',
  'ENGINE_MOD_AVOIDANT_SAFETY_SCALE',
  'ENGINE_MOD_AVOIDANT_BOND_SCALE',
  'ENGINE_MOD_ANXIOUS_TRUST_SCALE',
  'ENGINE_MOD_ANXIOUS_RESIST_SCALE',
  'ENGINE_MOD_ANXIOUS_SAFETY_SCALE',
  'ENGINE_MOD_ANXIOUS_BOND_SCALE',
  'ENGINE_MOD_DISORGANIZED_TRUST_SCALE',
  'ENGINE_MOD_DISORGANIZED_RESIST_SCALE',
  'ENGINE_MOD_DISORGANIZED_SAFETY_SCALE',
  'ENGINE_MOD_DISORGANIZED_BOND_SCALE',
  'ENGINE_MOD_AGREEABLENESS_TRUST_SCALE',
  'ENGINE_MOD_AGREEABLENESS_HIGH_THRESHOLD',
];

/**
 * 咨询同盟三维的 25 个 env 键 (WP42).
 *
 * 与 cap 族 / 人格族同一治本: 适配层**逐个字面量**读 → 已被 AST 抽取覆盖 (漏写一个键,
 * 断言① 立刻变红). 这里留一份清单, 是为了断言"25 个键一个不多一个不少" ——
 * 少一个 = 那个系数 / 门槛永远配不上 (静默失效); 多一个 = 模板里躺着一条没人读的键.
 */
const ALLIANCE_ENV_KEYS: readonly string[] = [
  'ENGINE_ALLIANCE_EMPATHY_SAFETY',
  'ENGINE_ALLIANCE_EMPATHY_BOND',
  'ENGINE_ALLIANCE_ACCEPTANCE_SAFETY',
  'ENGINE_ALLIANCE_ACCEPTANCE_BOND',
  'ENGINE_ALLIANCE_NORMALIZATION_SAFETY',
  'ENGINE_ALLIANCE_NORMALIZATION_BOND',
  'ENGINE_ALLIANCE_OPEN_PROBE_SAFETY',
  'ENGINE_ALLIANCE_OPEN_PROBE_BOND',
  'ENGINE_ALLIANCE_AFFIRMATION_SAFETY',
  'ENGINE_ALLIANCE_AFFIRMATION_BOND',
  'ENGINE_ALLIANCE_JUDGMENT_SAFETY',
  'ENGINE_ALLIANCE_JUDGMENT_BOND',
  'ENGINE_ALLIANCE_PREACHING_SAFETY',
  'ENGINE_ALLIANCE_PREACHING_BOND',
  'ENGINE_ALLIANCE_MINIMIZING_SAFETY',
  'ENGINE_ALLIANCE_MINIMIZING_BOND',
  'ENGINE_ALLIANCE_BOUNDARY_CROSS_SAFETY',
  'ENGINE_ALLIANCE_BOUNDARY_CROSS_BOND',
  'ENGINE_ALLIANCE_SENSITIVE_TOUCH_SAFETY',
  'ENGINE_ALLIANCE_SENSITIVE_TOUCH_BOND',
  'ENGINE_ALLIANCE_NEUTRAL_SAFETY',
  'ENGINE_ALLIANCE_NEUTRAL_BOND',
  'ENGINE_ALLIANCE_OPEN_THRESHOLD',
  'ENGINE_ALLIANCE_RESIST_TRUST_THRESHOLD',
  'ENGINE_ALLIANCE_RESIST_SAFETY_THRESHOLD',
];

/**
 * 跨会话间隔衰减的 3 个 env 键 (WP36).
 *
 * 与 cap 族 / 人格族 / 同盟族同一治本: 适配层**逐个字面量**读 → 已被 AST 抽取覆盖
 * (漏写一个键, 断言① 立刻变红). 这里留一份清单, 是为了断言"3 个键一个不多一个不少" ——
 * 少一个 = 那一维的半衰期永远配不上 (静默失效); 多一个 = 模板里躺着一条没人读的键.
 */
const SESSION_DECAY_ENV_KEYS: readonly string[] = [
  'ENGINE_DECAY_EMOTION_HALF_LIFE_MS',
  'ENGINE_DECAY_RESISTANCE_HALF_LIFE_MS',
  'ENGINE_DECAY_ALLIANCE_HALF_LIFE_MS',
];

/**
 * 会话摘要的 3 个 env 键 (WP37).
 *
 * 与 cap 族 / 人格族 / 同盟族同一治本: 适配层**逐个字面量**读 → 已被 AST 抽取覆盖
 * (漏写一个键, 断言① 立刻变红). 这里留一份清单, 是为了断言"3 个键一个不多一个不少" ——
 * 少一个 = 那一项永远配不上 (静默失效); 多一个 = 模板里躺着一条没人读的键.
 */
const SESSION_SUMMARY_ENV_KEYS: readonly string[] = [
  'SESSION_SUMMARY_BATCH_SIZE',
  'SESSION_SUMMARY_ROLLING_IMPORTANCE',
  'SESSION_SUMMARY_FINAL_IMPORTANCE',
];

/**
 * delta 规则表的 11 个 env 键 (WP60).
 *
 * 与 cap 族 / 人格族 / 同盟族 / 衰减族同一治本: 适配层**逐个字面量**读 →
 * 已被 AST 抽取覆盖 (漏写一个键, 断言① 立刻变红). 这里留一份清单, 是为了断言
 * "11 个键一个不多一个不少" —— 少一个 = 那个事件永远配不上 (静默失效);
 * 多一个 = 模板里躺着一条没人读的键 (骗人的配置项).
 *
 * ⚠️ 键名是**事件**级 (每事件一个 JSON 键), 不是维度级 —— 维度级要 121 个键.
 */
const DELTA_TABLE_ENV_KEYS: readonly string[] = [
  'ENGINE_DELTA_EMPATHY',
  'ENGINE_DELTA_ACCEPTANCE',
  'ENGINE_DELTA_NORMALIZATION',
  'ENGINE_DELTA_OPEN_PROBE',
  'ENGINE_DELTA_AFFIRMATION',
  'ENGINE_DELTA_JUDGMENT',
  'ENGINE_DELTA_PREACHING',
  'ENGINE_DELTA_MINIMIZING',
  'ENGINE_DELTA_BOUNDARY_CROSS',
  'ENGINE_DELTA_SENSITIVE_TOUCH',
  'ENGINE_DELTA_NEUTRAL',
];

/**
 * 递归收集目录下的 .ts 文件.
 */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) files.push(fullPath);
  }
  return files;
}

/**
 * 全仓的 `export const NAME = '字面量'` 索引 (常量 → 字面量).
 *
 * 为什么需要: 有些 env 键名是**用常量传进去**的, AST 里看到的是标识符而不是字符串:
 *   src/counselor/providers/llm-json.client.ts → this.config.get<string>(COUNSELOR_LLM_MODEL_ENV_KEY)
 *   src/counselor/config/counselor-llm.config.ts:40 → export const COUNSELOR_LLM_MODEL_ENV_KEY = 'MINIMAX_COUNSELOR_LLM_MODEL'
 * 不解析常量就会把它误判成"代码没读这个键" → 模板里那行被当成孤儿 → 断言报错.
 */
const CONST_LITERALS = new Map<string, string>();

/** 扫一遍全仓, 收集 `export const NAME = '字面量'`. */
function collectConstLiterals(files: readonly string[]): void {
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (declaration.initializer === undefined || !ts.isStringLiteral(declaration.initializer)) continue;
        CONST_LITERALS.set(declaration.name.text, declaration.initializer.text);
      }
    }
  }
}

/** 这个表达式是不是 `process.env`. */
function isProcessEnv(node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node)) return false;
  return node.name.text === 'env' && ts.isIdentifier(node.expression) && node.expression.text === 'process';
}

/**
 * AST 级抽取: 一个文件里真实存在的 env 键读取点.
 *
 * 三种读取形态:
 *   ① process.env.FOO              (点访问)
 *   ② process.env['FOO']           (静态 bracket 访问)
 *   ③ config.get('FOO')            (ConfigService 读 env 直键 —— 上游键名是大写的)
 *      ③ 的参数也可能是**常量标识符** (见 CONST_LITERALS 的说明), 一并解析.
 */
function extractEnvKeys(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    // ① process.env.FOO
    if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
      keys.add(node.name.text);
    }
    // ② process.env['FOO']
    if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression) && ts.isStringLiteral(node.argumentExpression)) {
      keys.add(node.argumentExpression.text);
    }
    // ③ config.get('FOO') / config.getOrThrow('FOO')
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === 'get' || method === 'getOrThrow') {
        const args = node.arguments;
        if (args.length > 0) {
          const firstArg = args[0];
          if (ts.isStringLiteral(firstArg) && ENV_KEY_SHAPE.test(firstArg.text)) {
            keys.add(firstArg.text);
          } else if (ts.isIdentifier(firstArg)) {
            const literal = CONST_LITERALS.get(firstArg.text);
            if (literal !== undefined && ENV_KEY_SHAPE.test(literal)) keys.add(literal);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...keys];
}

/** 代码里读到的全部 env 键 (含登记的派生族). */
function collectCodeEnvKeys(): Set<string> {
  const files = collectTsFiles(SRC_ROOT);
  collectConstLiterals(files);
  const keys = new Set<string>();
  for (const file of files) {
    for (const key of extractEnvKeys(file)) keys.add(key);
  }
  for (const family of Object.values(DERIVED_ENV_KEYS)) {
    for (const key of family) keys.add(key);
  }
  return keys;
}

/**
 * 读 `.env.example` 里的**生效行** (未注释的 `KEY=`).
 *
 * 为什么只认生效行:
 *   注释行是"说明 / 预留 / 可选提示", 不是配置项 —— 拿它当契约等于把
 *   "这里将来会有个键" 也算进"现在配得上", 断言就失去意义了.
 */
function collectEffectiveEnvKeys(): Set<string> {
  const keys = new Set<string>();
  const lines = readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

/** config 装配层 (default.ts) —— "@unused-read" 标记的所在处. */
const DEFAULT_CONFIG_TS = path.join(SRC_ROOT, 'config/envs/default.ts');

/** "@unused-read" 标记 (机器可读的"这个字段读到了但没人消费"声明). */
const UNUSED_READ_MARKER = '@unused-read';

/** .env.example 里「预留键 (读得到但未消费)」区的**标题**形状. */
const RESERVED_SECTION_HEADER = /^#\s*预留键.*读得到/;

/** .env.example 里的分隔横幅 (# ====== ...). */
const SECTION_BANNER = /^#\s*={10,}\s*$/;

/**
 * 一个 "@unused-read" 标记条目.
 */
interface UnusedReadEntry {
  /** env 键名 (如 QDRANT_COLLECTION). */
  readonly envKey: string;
  /** config 路径 (如 qdrant.collection). */
  readonly configPath: string;
}

/**
 * 找 default.ts 里 `export const config = {...}` 的对象字面量.
 *
 * @param sourceFile default.ts 的 AST
 * @returns config 对象字面量; 找不到返 undefined
 */
function findConfigObjectLiteral(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'config') continue;
      const initializer = declaration.initializer;
      if (initializer && ts.isObjectLiteralExpression(initializer)) return initializer;
    }
  }
  return undefined;
}

/**
 * 一个节点子树里读到的 env 键 (只看 process.env.X 两种形态).
 *
 * @param node 起始节点
 * @returns env 键名
 */
function extractEnvKeysFromNode(node: ts.Node): string[] {
  const keys = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && isProcessEnv(n.expression)) {
      keys.add(n.name.text);
    }
    if (ts.isElementAccessExpression(n) && isProcessEnv(n.expression) && ts.isStringLiteral(n.argumentExpression)) {
      keys.add(n.argumentExpression.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...keys];
}

/**
 * 扫 default.ts, 收集所有带 "@unused-read" 标记的 config 字段.
 *
 * 为什么用 AST 而不是正则:
 *   标记是**注释**, 正则看不到"这个注释属于哪个字段" —— 只能靠"标记行往下找第一个
 *   代码行"这种脆弱推断. AST 的 `getLeadingCommentRanges` 直接给出"这个属性前面挂了
 *   哪些注释", 是精确归属.
 *
 * @returns 标记条目 (一个字段可能读多个 env 键, 那就多条)
 */
function collectUnusedReadEntries(): UnusedReadEntry[] {
  const source = readFileSync(DEFAULT_CONFIG_TS, 'utf8');
  const sourceFile = ts.createSourceFile(DEFAULT_CONFIG_TS, source, ts.ScriptTarget.Latest, true);
  const root = findConfigObjectLiteral(sourceFile);
  if (!root) return [];
  const entries: UnusedReadEntry[] = [];
  const nameOf = (name: ts.PropertyName): string => name.getText(sourceFile).replaceAll(/^['"]|['"]$/g, '');
  for (const topProp of root.properties) {
    if (!ts.isPropertyAssignment(topProp)) continue;
    const namespace = nameOf(topProp.name);
    const initializer = topProp.initializer;
    if (!ts.isObjectLiteralExpression(initializer)) continue;
    for (const innerProp of initializer.properties) {
      if (!ts.isPropertyAssignment(innerProp)) continue;
      const comments = ts.getLeadingCommentRanges(source, innerProp.getFullStart()) ?? [];
      const marked = comments.some((range) => source.slice(range.pos, range.end).includes(UNUSED_READ_MARKER));
      if (!marked) continue;
      const field = nameOf(innerProp.name);
      for (const envKey of extractEnvKeysFromNode(innerProp.initializer)) {
        entries.push({ envKey, configPath: `${namespace}.${field}` });
      }
    }
  }
  return entries;
}

/**
 * 这个调用是不是 "从 config 里取值" —— `config.get('...')` / `config.getOrThrow('...')`.
 *
 * 为什么限定接收者名字里带 config:
 *   `someMap.get('key')` / `headers.get('x')` 也是 `.get()`, 不限定就会把
 *   Map / Headers 的取值误判成"消费了 config 字段" —— 那样守卫会**永远绿**, 形同虚设.
 *
 * @param node 待判断节点
 * @returns 是否是 config 取值调用
 */
function isConfigGetCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  if (method !== 'get' && method !== 'getOrThrow') return false;
  if (node.arguments.length === 0 || !ts.isStringLiteral(node.arguments[0])) return false;
  const receiver = node.expression.expression;
  const name = ts.isIdentifier(receiver) ? receiver.text : ts.isPropertyAccessExpression(receiver) ? receiver.name.text : '';
  return /config/i.test(name);
}

/**
 * 一个文件里 config 的**消费形态索引**.
 */
interface ConfigUsageIndex {
  /** 直接命中的 config 路径 (get('ns.field') / get('ns').field / 解构出来的字段). */
  readonly paths: Set<string>;
  /** 命名空间 → 持有它的变量名 (const v = get('ns')). */
  readonly nsVars: Map<string, Set<string>>;
  /** 变量字段访问 (v.field). */
  readonly varFields: Set<string>;
}

/**
 * 文件 → 消费形态索引 的**缓存** (V2026-11-06 · WP69 扩面后加).
 *
 * 为什么需要: `findConfigConsumptions` 是"每个待查字段扫一遍全 src/"的形状 ——
 *   标记的字段越多, 重复解析次数线性增长. WP48 时只有 2 个标记 (扫 2 遍) 约 21s 还能过;
 *   WP69 把标记扩到 8 个 (扫 8 遍) → 约 36s > vitest 默认 30s 超时, 守卫直接变红.
 *   缓存后每个文件只解析一次 —— 8 个标记与 2 个标记耗时相同.
 *
 * ⚠️ 缓存生命周期 = 一次测试进程; 测试里不改源码, 不会读到过期结果.
 */
const USAGE_INDEX_CACHE = new Map<string, ConfigUsageIndex>();

/**
 * 扫一个文件, 索引它对 config 的所有消费形态.
 *
 * 覆盖五种形态 (缺一种 = 守卫会漏判"已经接线了"):
 *   ① get('ns.field')              嵌套路径直读;
 *   ② get('ns').field               先取命名空间再点字段 (直接链);
 *   ③ const v = get('ns'); v.field  先取命名空间存变量再点字段;
 *   ④ const { field } = get('ns')   解构;
 *   ⑤ get('field')                  顶层平铺字段 (无命名空间).
 *
 * @param file 源文件路径
 * @returns 消费形态索引
 */
function analyzeConfigUsage(file: string): ConfigUsageIndex {
  const cached = USAGE_INDEX_CACHE.get(file);
  if (cached) return cached;
  const sourceFile = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const paths = new Set<string>();
  const nsVars = new Map<string, Set<string>>();
  const varFields = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (isConfigGetCall(node)) {
      collectConfigGetUsage(node, paths, nsVars);
    }
    // 变量字段访问 (v.field) —— 配合 nsVars 还原成 'ns.field'
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      varFields.add(`${node.expression.text}.${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const index: ConfigUsageIndex = { paths, nsVars, varFields };
  USAGE_INDEX_CACHE.set(file, index);
  return index;
}

/**
 * 把一次 "从 config 取值" 的调用记进消费形态索引.
 *
 * @param node 取值调用节点
 * @param paths 直接命中的 config 路径 (输出)
 * @param nsVars 命名空间 → 变量名 (输出)
 */
function collectConfigGetUsage(node: ts.Node, paths: Set<string>, nsVars: Map<string, Set<string>>): void {
  const call = node as ts.CallExpression;
  const key = (call.arguments[0] as ts.StringLiteral).text;
  const parent = node.parent;
  // ① 嵌套路径直读: get('ns.field')
  if (key.includes('.')) {
    paths.add(key);
    return;
  }
  // ⑤ 顶层平铺键名: get('jwtSecret') —— key 本身就是完整路径.
  //   (先记下来: 不带点的键既可能是"平铺字段", 也可能是"命名空间" —— 后面两种形态再往上拼)
  paths.add(key);
  // ② 直接链: get('ns').field
  if (ts.isPropertyAccessExpression(parent)) {
    paths.add(`${key}.${parent.name.text}`);
    return;
  }
  // ③ / ④ 赋值给变量或解构.
  //   注: parent 是 VariableDeclaration 时, 它的唯一 CallExpression 子节点**就是** initializer
  //   (另一个子节点 name 是 Identifier) —— 所以这里不需要再比一次 initializer === node.
  //   ⚠️ 但 initializer 常被包一层 (const v = config.get('ns') as T / config.get('ns')!),
  //     那时直接父节点是 AsExpression / NonNullExpression —— 要先剥一层再找 owner.
  const owner =
    ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isNonNullExpression(parent) ? parent.parent : parent;
  if (!ts.isVariableDeclaration(owner)) return;
  const name = owner.name;
  if (ts.isIdentifier(name)) {
    const vars = nsVars.get(key) ?? new Set<string>();
    vars.add(name.text);
    nsVars.set(key, vars);
    return;
  }
  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      const bound = element.propertyName ?? element.name;
      if (ts.isIdentifier(bound)) paths.add(`${key}.${bound.text}`);
    }
  }
}

/**
 * 找某个 config 字段的**消费点** (有人读它 = 这个键配了就会生效).
 *
 * 边界: 检测不到"消费点读错路径"的 bug (如 config.get('consentCurrentVersion')
 *   想读的是 consent.currentVersion) —— 那是另一个类型的问题, 见 WP48 任务单 §1.2.1.
 *
 * @param configPath config 路径 (如 qdrant.collection)
 * @returns 消费点所在文件 (相对仓库根)
 */
function findConfigConsumptions(configPath: string): string[] {
  const parts = configPath.split('.');
  const field = parts.at(-1) ?? '';
  const namespace = parts.length > 1 ? parts.slice(0, -1).join('.') : '';
  const hits: string[] = [];
  for (const file of collectTsFiles(SRC_ROOT)) {
    if (file === DEFAULT_CONFIG_TS) continue;
    const index = analyzeConfigUsage(file);
    let found = index.paths.has(configPath);
    if (!found && namespace !== '') {
      const vars = index.nsVars.get(namespace);
      if (vars) {
        for (const varName of vars) {
          if (index.varFields.has(`${varName}.${field}`)) {
            found = true;
            break;
          }
        }
      }
    }
    if (found) hits.push(path.relative(REPO_ROOT, file).replaceAll('\\', '/'));
  }
  return hits;
}

/**
 * 读 `.env.example` 里「预留键 (读得到但未消费)」区的**生效键**.
 *
 * 为什么单独找这一区:
 *   .env.example 里有两类"预留键" (代码查无读取点 / 读到了但没人消费),
 *   只有第二类对应 "@unused-read" 标记 —— 断言要对着**对的那一区**打.
 *
 * @returns 该区的生效键
 */
function collectReservedSectionKeys(): Set<string> {
  const lines = readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/);
  const headerIndex = lines.findIndex((raw) => RESERVED_SECTION_HEADER.test(raw.trim()));
  if (headerIndex === -1) return new Set();
  let start = headerIndex;
  while (start > 0 && !SECTION_BANNER.test(lines[start].trim())) start -= 1;
  let end = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (SECTION_BANNER.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  const keys = new Set<string>();
  for (let index = start; index < end; index += 1) {
    const line = lines[index].trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

describe('WP25 · .env.example 与代码 env 读取点一一对应', () => {
  const codeKeys = collectCodeEnvKeys();
  const exampleKeys = collectEffectiveEnvKeys();

  it('① 代码里读的每个 env 键, .env.example 都有生效行', () => {
    // NODE_ENV 例外: 代码读它, 但模板里**必须**是注释行 (见用例④) ——
    //   本地照抄模板不能开 production 模式, 所以它不该进"生效行"契约.
    const missing = [...codeKeys].filter((key) => key !== 'NODE_ENV' && !exampleKeys.has(key)).sort();
    expect(missing, `以下 env 键被代码读取, 但 .env.example 里没有生效行:\n${missing.join('\n')}`).toEqual([]);
  });

  it('② .env.example 的每个生效行, 代码里都真的读它', () => {
    const orphans = [...exampleKeys].filter((key) => !codeKeys.has(key)).sort();
    expect(orphans, `以下 .env.example 生效行在代码里查无读取点 (配了也不生效):\n${orphans.join('\n')}`).toEqual([]);
  });

  it('③ 派生族登记与代码推导口径一致 (5 个 LLM_*_API_KEY)', () => {
    // 防"登记表自己漂了": 登记的族名必须与源码里出现的模板字符串对得上.
    const providerEnv = readFileSync(path.join(SRC_ROOT, 'llm/config/provider-env.ts'), 'utf8');
    expect(providerEnv).toContain(`LLM_\${providerId.toUpperCase()}_API_KEY`);
    // 登记的键数不能比推导口径少 (少一个 = 漏登记 = 断言放行了一个真实缺口).
    expect(DERIVED_ENV_KEYS['LLM_<PROVIDER>_API_KEY']).toHaveLength(5);
  });

  it('③b 22 个 ENGINE_CAP_* 键已改字面量读取, 内核树不再有 cap 键 (WP26 · P2-13/P2-14 · WP42 加两维)', () => {
    // 适配层逐个字面量读 → AST 抽取看得到 → 少写一个键, 断言① 立刻变红.
    const deltaCapConfigFile = path.join(SRC_ROOT, 'engine-adapters/wiring/delta-cap.config.ts');
    expect(existsSync(deltaCapConfigFile)).toBe(true);
    const literalKeys = extractEnvKeys(deltaCapConfigFile).filter((key) => key.startsWith('ENGINE_CAP_'));
    expect([...literalKeys].sort()).toEqual([...DELTA_CAP_ENV_KEYS].sort());

    // 内核树里**不许**再出现任何 ENGINE_CAP_* 字符串 (计算键也算): 内核零 env 读取.
    const kernelRoot = path.join(SRC_ROOT, 'engine-core');
    const kernelCapKeys: string[] = [];
    for (const file of collectTsFiles(kernelRoot)) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('ENGINE_CAP_')) {
        kernelCapKeys.push(path.relative(kernelRoot, file).replaceAll('\\', '/'));
      }
    }
    expect(kernelCapKeys).toEqual([]);
  });

  it('③c 18 个 ENGINE_MOD_* 键已改字面量读取, 内核树不再有人格系数键 (WP34 · WP53 加 8 个)', () => {
    // 人格调节系数与 cap 同款治本: 适配层逐个字面量读 → AST 抽取看得到.
    const personalityConfigFile = path.join(SRC_ROOT, 'engine-adapters/wiring/personality-modulator.config.ts');
    expect(existsSync(personalityConfigFile)).toBe(true);
    const literalKeys = extractEnvKeys(personalityConfigFile).filter((key) => key.startsWith('ENGINE_MOD_'));
    expect([...literalKeys].sort()).toEqual([...PERSONALITY_MOD_ENV_KEYS].sort());

    // 内核树里**不许**再出现任何 ENGINE_MOD_* 字符串 (计算键也算): 内核零 env 读取.
    const kernelRoot = path.join(SRC_ROOT, 'engine-core');
    const kernelModKeys: string[] = [];
    for (const file of collectTsFiles(kernelRoot)) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('ENGINE_MOD_')) {
        kernelModKeys.push(path.relative(kernelRoot, file).replaceAll('\\', '/'));
      }
    }
    expect(kernelModKeys).toEqual([]);
  });

  it('③d 25 个 ENGINE_ALLIANCE_* 键已改字面量读取, 内核树不再有同盟系数键 (WP42)', () => {
    // 同盟三维的系数与门槛与 cap 族同一治本: 适配层逐个字面量读 → AST 抽取看得到.
    const allianceConfigFile = path.join(SRC_ROOT, 'engine-adapters/wiring/alliance-config.ts');
    expect(existsSync(allianceConfigFile)).toBe(true);
    const literalKeys = extractEnvKeys(allianceConfigFile).filter((key) => key.startsWith('ENGINE_ALLIANCE_'));
    expect([...literalKeys].sort()).toEqual([...ALLIANCE_ENV_KEYS].sort());

    // 内核树里**不许**再出现任何 ENGINE_ALLIANCE_* 字符串 (计算键也算): 内核零 env 读取.
    const kernelRoot = path.join(SRC_ROOT, 'engine-core');
    const kernelAllianceKeys: string[] = [];
    for (const file of collectTsFiles(kernelRoot)) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('ENGINE_ALLIANCE_')) {
        kernelAllianceKeys.push(path.relative(kernelRoot, file).replaceAll('\\', '/'));
      }
    }
    expect(kernelAllianceKeys).toEqual([]);
  });

  it('③e 3 个 ENGINE_DECAY_* 键已改字面量读取, 内核树不再有衰减半衰期键 (WP36)', () => {
    // 跨会话衰减的三个半衰期与 cap 族同一治本: 适配层逐个字面量读 → AST 抽取看得到.
    const sessionDecayConfigFile = path.join(SRC_ROOT, 'engine-adapters/wiring/session-decay.config.ts');
    expect(existsSync(sessionDecayConfigFile)).toBe(true);
    const literalKeys = extractEnvKeys(sessionDecayConfigFile).filter((key) => key.startsWith('ENGINE_DECAY_'));
    expect([...literalKeys].sort()).toEqual([...SESSION_DECAY_ENV_KEYS].sort());

    // 内核树里**不许**再出现任何 ENGINE_DECAY_* 字符串 (计算键也算): 内核零 env 读取.
    const kernelRoot = path.join(SRC_ROOT, 'engine-core');
    const kernelDecayKeys: string[] = [];
    for (const file of collectTsFiles(kernelRoot)) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('ENGINE_DECAY_')) {
        kernelDecayKeys.push(path.relative(kernelRoot, file).replaceAll('\\', '/'));
      }
    }
    expect(kernelDecayKeys).toEqual([]);
  });

  it('③f 3 个 SESSION_SUMMARY_* 键已改字面量读取, 内核树不再有摘要参数键 (WP37)', () => {
    // 会话摘要参数与 cap 族同一治本: 适配层逐个字面量读 → AST 抽取看得到.
    const summaryConfigFile = path.join(SRC_ROOT, 'engine-adapters/wiring/session-summary.config.ts');
    expect(existsSync(summaryConfigFile)).toBe(true);
    const literalKeys = extractEnvKeys(summaryConfigFile).filter((key) => key.startsWith('SESSION_SUMMARY_'));
    expect([...literalKeys].sort()).toEqual([...SESSION_SUMMARY_ENV_KEYS].sort());

    // 内核树里**不许**再出现任何 SESSION_SUMMARY_* 字符串 (计算键也算): 内核零 env 读取.
    const kernelRoot = path.join(SRC_ROOT, 'engine-core');
    const kernelSummaryKeys: string[] = [];
    for (const file of collectTsFiles(kernelRoot)) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('SESSION_SUMMARY_')) {
        kernelSummaryKeys.push(path.relative(kernelRoot, file).replaceAll('\\', '/'));
      }
    }
    expect(kernelSummaryKeys).toEqual([]);
  });

  it('③g 11 个 ENGINE_DELTA_* 键已改字面量读取, 内核树不再有 delta 表键 (WP60)', () => {
    // delta 规则表系数与 cap 族同一治本: 适配层逐个字面量读 → AST 抽取看得到.
    const deltaTableConfigFile = path.join(SRC_ROOT, 'engine-adapters/wiring/delta-table.config.ts');
    expect(existsSync(deltaTableConfigFile)).toBe(true);
    const literalKeys = extractEnvKeys(deltaTableConfigFile).filter((key) => key.startsWith('ENGINE_DELTA_'));
    expect([...literalKeys].sort()).toEqual([...DELTA_TABLE_ENV_KEYS].sort());

    // 内核树里**不许**再出现任何 ENGINE_DELTA_* 字符串 (计算键也算): 内核零 env 读取.
    const kernelRoot = path.join(SRC_ROOT, 'engine-core');
    const kernelDeltaTableKeys: string[] = [];
    for (const file of collectTsFiles(kernelRoot)) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('ENGINE_DELTA_')) {
        kernelDeltaTableKeys.push(path.relative(kernelRoot, file).replaceAll('\\', '/'));
      }
    }
    expect(kernelDeltaTableKeys).toEqual([]);
  });

  it('④ NODE_ENV 必须被注释掉 (本地照抄模板不能开 production 模式)', () => {
    const lines = readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/);
    const effective = lines.filter((raw) => {
      const line = raw.trim();
      return line !== '' && !line.startsWith('#') && /^NODE_ENV\s*=/.test(line);
    });
    expect(effective, 'NODE_ENV 在 .env.example 里必须是注释行').toEqual([]);
    // 但它得**看得见** —— 注释行里必须提到它, 否则运维不知道这个开关存在.
    const mentioned = lines.some((raw) => raw.trim().startsWith('#') && raw.includes('NODE_ENV'));
    expect(mentioned, 'NODE_ENV 必须在 .env.example 的注释里出现 (可发现性)').toBe(true);
  });

  // V2026-11-06 治本 (WP48 · env 守卫盲区 — 分不出「读进 config」与「真被消费」):
  //   ①② 两条断言守的是"代码读没读这个 env 键" —— 但**读进 config 命名空间 ≠ 有人消费**.
  //   读进命名空间却没人消费的那些键 (QDRANT_COLLECTION / VOICE_SESSION_IDLE_TIMEOUT_MS)
  //   在断言①里一路绿灯 (代码确实读了), 可运维配了等于白配 —— 静默失效, 最费时间的排障陷阱.
  //   用例⑤ 把这一类**单列**出来守住.
  it('⑤ @unused-read 标记的键: 确实无人消费, 且在 .env.example 预留区登记', () => {
    const entries = collectUnusedReadEntries();
    expect(entries.length, 'default.ts 里至少要有一个 @unused-read 标记的字段 (否则本用例形同虚设)').toBeGreaterThan(0);

    const reservedKeys = collectReservedSectionKeys();
    const markedEnvKeys = new Set(entries.map((entry) => entry.envKey));

    // 断言 A: 标记过的键必须在 .env.example 的「预留键 (读得到但未消费)」区里登记.
    //   不登记 = "标记了但没告诉运维" —— 运维照抄生效区还是会把值配上, 照旧踩坑.
    const notRegistered = entries
      .map((entry) => entry.envKey)
      .filter((key) => !reservedKeys.has(key))
      .sort();
    expect(
      notRegistered,
      `以下键标了 @unused-read, 但没在 .env.example 预留区登记 (运维看不到"配了不生效"):\n${notRegistered.join('\n')}`,
    ).toEqual([]);

    // 断言 B: 标记过的键**确实**没人消费 —— 有人消费了 = 标记过时 = 该把它接上线了.
    const consumed: string[] = [];
    for (const entry of entries) {
      const hits = findConfigConsumptions(entry.configPath);
      if (hits.length > 0) {
        consumed.push(`${entry.envKey} (config.${entry.configPath}) 已被消费: ${hits.join(', ')}`);
      }
    }
    expect(
      consumed,
      `以下键标了 @unused-read, 但已经有人消费了 —— 标记过时, 请接线后把它挪回生效区并去掉标记:\n${consumed.join('\n')}`,
    ).toEqual([]);

    // 断言 B 的**正对照** —— 检测器必须能看见仓库里**确实**有人消费的字段.
    //   少了这一条, 断言 B 可能因为"检测器坏了"而永远绿 (那比没有守卫更糟).
    //   这两个字段在仓库里确实有消费点, 检测器必须找到 —— 找到 = 检测器活着.
    const positiveControls: readonly (readonly [string, string])[] = [
      ['voice.sessionIdleTimeoutMinutes', 'src/voice/voice.service.ts'],
      ['jwtSecret', 'src/auth/strategies/jwt.strategy.ts'],
    ];
    for (const [configPath, expectedFile] of positiveControls) {
      const hits = findConfigConsumptions(configPath);
      expect(hits, `检测器失灵: ${configPath} 在 ${expectedFile} 明明有人消费, 却没检测到`).toContain(expectedFile);
    }

    // 断言 C: 预留区里的每个生效键都必须有 @unused-read 标记 (两处不许漂移).
    //   反双胞胎: "哪些键没人消费" 只在 default.ts 注释 + .env.example 预留区两处,
    //   守卫守住两边一致 —— 少标记一个 = 那个键悄悄脱离守卫.
    const unmarked = [...reservedKeys].filter((key) => !markedEnvKeys.has(key)).sort();
    expect(
      unmarked,
      `以下键在 .env.example 预留区, 但 default.ts 里没有 @unused-read 标记 (守卫会漏掉它):\n${unmarked.join('\n')}`,
    ).toEqual([]);
  });
});
