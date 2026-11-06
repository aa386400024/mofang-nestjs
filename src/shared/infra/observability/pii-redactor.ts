// V2026-11-06 治本 (WP46 · Sentry 通道脱敏 · 心理数据合规闭环):
//   原因 (2026-11-06 实扫):
//     ① 脱敏函数原本是 src/common/filters/biz-exception.filter.ts 的**私有副本** ——
//        本地日志在用, Sentry 通道完全没用. 两套口径迟早分叉 (反双胞胎红线).
//     ② Sentry v11 (实测 @sentry/node 11.10.0) 已**删除** sendDefaultPii 选项,
//        改用 dataCollection 模型; 且 dataCollection.httpBodies **默认开启**
//        入站请求体采集 —— 心理原文 (日记正文 / 危机备注 / 对话消息) 会以**原始字符串**
//        进 Sentry 事件. 这不是"未来可能泄漏", 是**正在泄漏**.
//   修法: 把脱敏逻辑抽成本**纯函数模块** (零 @nestjs / 零 @sentry / 零网络 / 零 process.env),
//         本地日志与 Sentry 通道共用同一份口径.
//   反双胞胎: 本模块是**唯一**脱敏实现 —— biz-exception.filter.ts 的私有副本已删除,
//         全仓的 PHONE_PATTERN / ID_CARD_PATTERN / EMAIL_PATTERN 只在这里定义.
//   边界: 本模块**不 import** 任何 Sentry 类型 —— 与 Sentry 通道解耦, 便于单测;
//         也不 import @nestjs —— 纯 TS, 谁都能用.
//   时间戳: 2026-11-06

/** 单条日志 / 单段文本的最大长度 (超了截断) —— 一条日志不该无限长. */
export const MAX_LOG_TEXT_LENGTH = 2000;

/** 命中敏感字段名后的占位符. */
export const REDACTED = '[REDACTED]';

/** 请求体整体被替换时的占位符 —— body 内容完全不可控, 不留任何片段. */
export const REDACTED_BODY = '[REDACTED body]';

/** SQL 原文整句遮蔽时的占位符. */
export const REDACTED_SQL = '[SQL 原文已脱敏]';

/**
 * SQL 原文的形状 —— 命中即整句遮蔽.
 *
 * 为什么是"整句遮蔽"而不是"逐个抠字面量":
 *   逐个抠容易漏 (转义 / 嵌套引号 / 数字字面量), 而"整句遮蔽"的口径简单可验证 ——
 *   宁可少一条线索, 也不能让 SQL 原文进日志.
 */
export const SQL_STATEMENT_PATTERNS: readonly RegExp[] = [
  /\bSELECT\b[\s\S]{0,400}?\bFROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\b[\s\S]{0,200}?\bSET\s+/i,
  /\bDELETE\s+FROM\b/i,
];

/** `Bearer xxx` / `Basic xxx` 形态的凭据. */
export const CREDENTIAL_SCHEME_PATTERN = /\b(bearer|basic)\s+[\w.\-+/=]+/gi;

/** key=value 形态的凭据 (password / token / secret / api key / cookie ...). */
export const SENSITIVE_KEY_VALUE_PATTERN =
  /\b(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|authorization|cookie)\b(\s*[:=]\s*)\S+/gi;

/** 中国大陆手机号. */
export const PHONE_PATTERN = /\b1[3-9]\d{9}\b/g;

/** 身份证号 (18 位). */
export const ID_CARD_PATTERN = /\b\d{17}[\dXx]\b/g;

/** 邮箱. */
export const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/** 递归脱敏的最大深度 —— 超过即整体遮蔽 (防构造出超深对象把栈打爆). */
const MAX_REDACT_DEPTH = 12;

/**
 * 凭据类字段名 —— **任何位置**都遮 (event.request.data / event.extra / breadcrumbs / stack vars).
 *
 * 为什么单独一层:
 *   凭据 (密码 / token / 密钥) 在任何上下文里都是**纯泄漏面**, 没有任何"调试需要"的理由 ——
 *   业务 id (userId / sessionId / code) 才是调试必需的, 而它们不在这个集合里.
 */
export const SENSITIVE_KEY_NAMES: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'pwd',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'api_key',
  'access_key',
  'authorization',
  'cookie',
]);

/**
 * 业务内容类字段名 —— **只在 event.request.data 里**递归遮.
 *
 * 为什么不在 extra 里遮:
 *   extra 是业务代码手动传的, 里面装的是调试必需的**业务 id**; 一旦在这里遮业务内容类字段,
 *   正常的调试数据 (如 `{ code: 0, data: { userId: 'u123' } }`) 会被误伤.
 *   业务代码若把心理原文塞进 extra, 那是业务代码的问题 (dev 模式会 warn 提示),
 *   由 dev 模式的 console.warn + 业务侧自律兜住, 不在这里自动遮.
 *
 * 字段名来源: 2026-11-06 对 9 个高敏 DTO 文件的实扫 (good-state-diary / emergency /
 * llm-chat / genome-reshape / post-drift-bottle / ai-conversations / crisis-practice /
 * knowledge-base preview), 不是猜的.
 *
 * ⚠️ 刻意**不**包含 `data` / `payload` / `input` / `output`:
 *   这几个名字太宽泛, 请求体里也可能是正常业务结构; 靠上面这些**具体业务字段名**
 *   来遮真正的心理内容, 避免误伤.
 */
export const SENSITIVE_CONTENT_NAMES: ReadonlySet<string> = new Set([
  // 自由文本字段 (DTO 实扫确认)
  'body', // 日记正文
  'content', // 漂流瓶信件 / chat message 内容
  'text',
  'message',
  'prompt',
  'reply',
  'response',
  'completion',
  'delta', // 流式增量文本
  'note',
  'notes', // 情绪快照备注 / 急救气泡备注
  'summary',
  'localSummary',
  'title',
  'feedback', // 用户反馈
  'query', // 搜索关键词
  'description',
  'reason',
  'lockedReason',
  'rootCause',
  'creatureTrait',
  'teachingNote',
  'resourceGuidance',
  'boundaryNotice',
  'authorAnonymousName',
  'emoji',
  // 用户输入 / 对话
  'userInput',
  'userText',
  'userMessage',
  'userQuery',
  'userContent',
  'diary',
  'entry',
  'journal',
  'answer',
  'answers',
  'scaleAnswer',
  'scaleAnswers',
  'assessment',
  'emotion',
  'feeling',
  'mood',
  'conversation',
  'chat',
  'messages',
  'history',
  'dialogue',
  'selfHarm',
  'crisis',
  'suicide',
  'trauma',
  'riskNote',
  'report',
  'transcript',
  'audioText',
  'asrText',
  // 数组类型 (元素都是字符串)
  'perspectiveQuestions',
  'observedThemes',
  'themes',
  'tags',
  'steps',
  'examples',
  'openQuestions',
  'keywords',
  'suggestedResource',
  // 泛透传字段 (内容完全不可控)
  'context', // emergency DTO 的 Record<string, unknown>
]);

/**
 * 请求体专用黑名单 —— 凭据类 + 业务内容类的**并集**.
 *
 * 为什么请求体要用并集:
 *   请求体是**用户主动提交**的内容, 里面既有心理原文 (body / title / messages),
 *   也可能混着凭据 (password). 两类都要遮 —— 只遮内容类会让 password 漏出去.
 */
export const REQUEST_BODY_SENSITIVE_NAMES: ReadonlySet<string> = new Set([...SENSITIVE_KEY_NAMES, ...SENSITIVE_CONTENT_NAMES]);

/**
 * query string 专用黑名单 —— 凭据类 + **认证/验证码类**参数.
 *
 * 为什么单独一份:
 *   'code' 这类字段名在 extra 里是**业务错误码** (必须保留, 见 §4.2 验收),
 *   但在 query string 里它通常是**短信验证码 / 邀请码** —— 必须删.
 *   同一个字段名在不同位置语义不同, 所以按位置分名单, 而不是全局一刀切.
 */
export const QUERY_SENSITIVE_NAMES: ReadonlySet<string> = new Set([
  ...SENSITIVE_KEY_NAMES,
  'phone',
  'mobile',
  'tel',
  'idcard',
  'id_card',
  'idCard',
  'code',
  'verificationCode',
  'smsCode',
  'captcha',
]);

/** 小写化的黑名单缓存 —— 字段名匹配大小写不敏感 (Password / PASSWORD / password 都要遮). */
const lowerCaseSetCache = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>();

/**
 * 取一个黑名单的小写化视图 (带缓存).
 *
 * @param names 原始黑名单
 * @returns 小写化后的黑名单
 */
function lowerCaseView(names: ReadonlySet<string>): ReadonlySet<string> {
  const cached = lowerCaseSetCache.get(names);
  if (cached) return cached;
  const view = new Set<string>();
  for (const name of names) view.add(name.toLowerCase());
  lowerCaseSetCache.set(names, view);
  return view;
}

/**
 * 字段名是否命中黑名单 (大小写不敏感).
 *
 * @param key 字段名
 * @param names 黑名单
 * @returns 是否命中
 */
function matchesSensitiveName(key: string, names: ReadonlySet<string>): boolean {
  return lowerCaseView(names).has(key.toLowerCase());
}

/**
 * 判断是不是"普通对象" (可安全递归的纯数据).
 *
 * 为什么要排除 Date / Map / class 实例:
 *   它们不是**键值数据**, 递归进去只会得到空对象, 反而把有用信息毁了;
 *   而且它们不可能携带"心理内容字段名" —— 原样保留即可.
 *
 * @param value 待判断的值
 * @returns 是否是普通对象
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  if (Buffer.isBuffer(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 文本里是不是有 SQL 原文.
 *
 * @param text 文本
 * @returns 是否命中 SQL 形状
 */
export function looksLikeSql(text: string): boolean {
  return SQL_STATEMENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 截断过长文本.
 *
 * @param text 文本
 * @returns 截断后的文本
 */
export function truncateForLog(text: string, maxLength: number = MAX_LOG_TEXT_LENGTH): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…(已截断)` : text;
}

/**
 * 按脱敏口径处理一段文本 (不含 SQL 整句遮蔽).
 *
 * @param text 原始文本
 * @returns 脱敏 (并截断) 后的文本
 */
export function redactForLog(text: string): string {
  let result = text;
  result = result.replaceAll(CREDENTIAL_SCHEME_PATTERN, '$1 ***');
  result = result.replaceAll(SENSITIVE_KEY_VALUE_PATTERN, '$1$2***');
  result = result.replaceAll(PHONE_PATTERN, '1**********');
  result = result.replaceAll(ID_CARD_PATTERN, '*******************');
  result = result.replaceAll(EMAIL_PATTERN, '***@***');
  return truncateForLog(result);
}

/**
 * 脱敏一段错误描述 (含 SQL 整句遮蔽).
 *
 * @param text 原始描述
 * @returns 脱敏后的描述
 */
export function redactSql(text: string): string {
  return looksLikeSql(text) ? REDACTED_SQL : redactForLog(text);
}

/**
 * 通用文本脱敏 (Sentry 通道用).
 *
 * 口径与本地日志**完全一致** (含 SQL 整句遮蔽), 只是换了个语义更中立的名字 ——
 * Sentry 里这批文本是 Error.message / breadcrumb.message / 堆栈行, 不只是"日志".
 *
 * @param text 原始文本
 * @returns 脱敏后的文本
 */
export function redactString(text: string): string {
  return redactSql(text);
}

/**
 * 脱敏一段堆栈 (**逐行**处理).
 *
 * 为什么逐行而不是整段遮蔽: 栈帧 (文件/行号) 是定位问题的第一现场, 整段遮蔽等于把
 * 最有用的部分也丢了; 而 SQL 原文通常落在**第一行**(message 那行), 按行判定足够精准.
 * 跨行 SQL 的其余行仍会过一遍 PII / 凭据规则 (值会被遮, 列名可能残留).
 *
 * @param stack 原始堆栈
 * @returns 脱敏后的堆栈
 */
export function redactStack(stack: string): string {
  return stack
    .split('\n')
    .map((line) => (looksLikeSql(line) ? REDACTED_SQL : redactForLog(line)))
    .join('\n');
}

/**
 * 只保留路径 (去掉 query string).
 *
 * @param url 原始 url
 * @returns 脱敏后的路径
 */
export function redactPath(url: string): string {
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : `${url.slice(0, queryIndex)}?***`;
}

/**
 * 递归脱敏一个对象 (按字段名).
 *
 * 规则:
 *   ① 字段名命中黑名单 → 该字段的值整体替换为 '[REDACTED]' (字符串 / 对象 / 数组都一样);
 *   ② Buffer 一律整体替换 —— 二进制载荷 (语音 / 文件) 本身就是心理内容, 且对调试无价值;
 *   ③ 顶层裸文本整体替换 —— 顶层传进来就是一段裸字符串时, 没有字段名可匹配, 宁可全遮;
 *      (嵌套的字符串**保留** —— userId / sessionId 这类业务 id 是调试必需的);
 *   ④ 数组递归元素; 普通对象递归字段;
 *   ⑤ Date / Map / class 实例原样保留 (不是键值数据, 递归进去只会毁信息);
 *   ⑥ 循环引用 → '[REDACTED]' (防爆栈).
 *
 * 不修改入参, 始终返回新对象.
 *
 * @param obj 待脱敏的对象
 * @param sensitiveNames 命中的字段名黑名单
 * @returns 脱敏后的对象 (结构同入参)
 */
export function redactRecord<T>(obj: T, sensitiveNames: ReadonlySet<string>): T {
  // 顶层是裸文本 / Buffer 时: 没有字段名可匹配, 整体遮 (见上面的规则 ② ③).
  // 注意: 只有**顶层**这么做 —— 嵌套的字符串必须留 (userId='u123' 是调试必需的).
  if (typeof obj === 'string' || Buffer.isBuffer(obj)) {
    return REDACTED as unknown as T;
  }
  return redactValue(obj, sensitiveNames, 0, new WeakSet<object>()) as T;
}

/**
 * 递归脱敏的内部实现.
 *
 * @param value 当前值
 * @param names 黑名单
 * @param depth 当前深度
 * @param seen 已访问对象 (防循环引用)
 * @returns 脱敏后的值
 */
function redactValue(value: unknown, names: ReadonlySet<string>, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return REDACTED;
  // 嵌套的字符串**原样保留** —— 只有命中黑名单的字段名才会被遮.
  // (顶层裸文本的整体替换在 redactRecord 里做, 不在这里做.)
  if (typeof value !== 'object') return value;
  if (depth > MAX_REDACT_DEPTH) return REDACTED;
  if (seen.has(value)) return REDACTED;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, names, depth + 1, seen));
    }
    if (!isPlainRecord(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (matchesSensitiveName(key, names)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactValue(item, names, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * 收集对象里命中黑名单的字段名 (只收集**一层 + 嵌套一层**, 够定位问题, 不深挖).
 *
 * 用途: dev 模式下提示"你把心理内容字段名传进 extra 了" —— 只提示, 不自动遮.
 *
 * @param obj 待检查的对象
 * @param names 黑名单
 * @returns 命中的字段名 (去重)
 */
export function collectMatchingKeys(obj: unknown, names: ReadonlySet<string>): string[] {
  const hits = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 2 || !isPlainRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (matchesSensitiveName(key, names)) {
        hits.add(key);
        continue;
      }
      visit(item, depth + 1);
    }
  };
  visit(obj, 0);
  return [...hits];
}

/** IPv4 字面量. */
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** IPv4-mapped IPv6 前缀 (::ffff:1.2.3.4). */
const IPV4_MAPPED_PREFIX = '::ffff:';

/**
 * 脱敏 IPv4 (保留 /24).
 *
 * @param ip 原始 IPv4
 * @returns 脱敏后的 IPv4
 */
function redactIpv4(ip: string): string {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

/**
 * 解析 IPv6 的 8 个分组.
 *
 * @param value 原始 IPv6
 * @returns 8 个分组的数值, 解析失败返 undefined
 */
function expandIpv6(value: string): number[] | undefined {
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups: number[] = [];
  for (const group of left) {
    const parsed = parseHexGroup(group);
    if (parsed === undefined) return undefined;
    groups.push(parsed);
  }
  if (halves.length === 2) {
    const fill = 8 - left.length - right.length;
    if (fill < 1) return undefined;
    for (let i = 0; i < fill; i += 1) groups.push(0);
  }
  for (const group of right) {
    const parsed = parseHexGroup(group);
    if (parsed === undefined) return undefined;
    groups.push(parsed);
  }
  return groups.length === 8 ? groups : undefined;
}

/**
 * 解析一个 IPv6 分组 (16 进制).
 *
 * @param group 分组字符串
 * @returns 数值, 非法返 undefined
 */
function parseHexGroup(group: string): number | undefined {
  if (group.length === 0 || group.length > 4) return undefined;
  if (!/^[0-9a-fA-F]+$/.test(group)) return undefined;
  return Number.parseInt(group, 16);
}

/**
 * 脱敏 IPv6 (保留前 48 位 = 前 3 组).
 *
 * @param ip 原始 IPv6
 * @returns 脱敏后的 IPv6, 解析失败返 undefined
 */
function redactIpv6(ip: string): string | undefined {
  const groups = expandIpv6(ip);
  if (!groups) return undefined;
  const head = groups.slice(0, 3).map((group) => group.toString(16));
  return `${head.join(':')}::`;
}

/**
 * 脱敏 IP 地址.
 *
 * 口径 (2026-11-06 大炮拍板):
 *   · IPv4            → 保留 /24 (1.2.3.4 → 1.2.3.0);
 *   · IPv4-mapped IPv6 → 按 IPv4 处理 (::ffff:1.2.3.4 → 1.2.3.0);
 *   · IPv6            → 保留前 48 位 (2001:db8:85a3::8a2e:370:7334 → 2001:db8:85a3::);
 *   · undefined/null  → undefined;
 *   · 认不出来的形态  → undefined (宁可少一个字段, 也不让它原样出去).
 *
 * @param ip 原始 IP
 * @returns 脱敏后的 IP
 */
export function redactIp(ip?: string | null): string | undefined {
  if (ip === undefined || ip === null) return undefined;
  const trimmed = ip.trim();
  if (trimmed === '') return undefined;
  if (trimmed.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)) {
    const mapped = trimmed.slice(IPV4_MAPPED_PREFIX.length);
    return IPV4_PATTERN.test(mapped) ? redactIpv4(mapped) : undefined;
  }
  if (IPV4_PATTERN.test(trimmed)) return redactIpv4(trimmed);
  if (trimmed.includes(':')) return redactIpv6(trimmed);
  return undefined;
}

/**
 * 脱敏 query string.
 *
 * 支持两种形态 (Sentry 两种都可能给):
 *   · 字符串 "a=1&token=x" → 逐段解析, 命中黑名单的段整段删掉;
 *   · 对象 { token: 'x', page: 1 } → 命中黑名单的键删掉.
 *
 * @param value 原始 query string
 * @returns 脱敏后的 query string
 */
export function redactQueryString(value: unknown): unknown {
  if (typeof value === 'string') {
    const kept = value
      .split('&')
      .filter((part) => part.length > 0)
      .filter((part) => {
        const rawKey = part.split('=', 1)[0] ?? '';
        let key = rawKey;
        try {
          key = decodeURIComponent(rawKey);
        } catch {
          key = rawKey;
        }
        return !matchesSensitiveName(key, QUERY_SENSITIVE_NAMES);
      });
    return kept.join('&');
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (matchesSensitiveName(key, QUERY_SENSITIVE_NAMES)) continue;
      out[key] = item;
    }
    return out;
  }
  return value;
}

/**
 * 脱敏 Sentry event 的 request 段.
 *
 * @param request 原始 request 段
 * @returns 脱敏后的 request 段
 */
function redactSentryRequest(request: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...request };

  // cookies: 直接删 (会话 cookie 是凭据)
  delete out['cookies'];

  // headers: 删 authorization / cookie (大小写不敏感)
  const rawHeaders = out['headers'];
  if (isPlainRecord(rawHeaders)) {
    const headers: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawHeaders)) {
      const lower = key.toLowerCase();
      if (lower === 'authorization' || lower === 'cookie') continue;
      headers[key] = value;
    }
    out['headers'] = headers;
  }

  // data (请求体): 心理内容最集中的地方
  if ('data' in out) {
    const data: unknown = out['data'];
    if (typeof data === 'string' || Buffer.isBuffer(data)) {
      // 原始 body 字符串 / multipart 二进制 —— 内容完全不可控, 整体遮 (切片段也是泄漏)
      out['data'] = REDACTED_BODY;
    } else if (isPlainRecord(data) || Array.isArray(data)) {
      out['data'] = redactRecord(data, REQUEST_BODY_SENSITIVE_NAMES);
    } else if (data !== null && data !== undefined) {
      out['data'] = REDACTED_BODY;
    }
  }

  // query_string: 删命中黑名单的参数
  if ('query_string' in out) {
    out['query_string'] = redactQueryString(out['query_string']);
  }

  // url: 去掉 query string (与本地日志口径一致)
  const url = out['url'];
  if (typeof url === 'string') {
    out['url'] = redactPath(url);
  }

  return out;
}

/**
 * 脱敏 Sentry event 的 user 段.
 *
 * 保留 id (业务 id, 用于聚合), 删 email / username, ip_address 走 /24 截断.
 * 当前代码没调 setUser, 但这是**防御性**的 —— 将来接入用户上下文时不会裸奔.
 *
 * @param user 原始 user 段
 * @returns 脱敏后的 user 段
 */
function redactSentryUser(user: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...user };
  delete out['email'];
  delete out['username'];
  if ('ip_address' in out) {
    const rawIp = out['ip_address'];
    const redacted = redactIp(typeof rawIp === 'string' ? rawIp : undefined);
    if (redacted === undefined) {
      delete out['ip_address'];
    } else {
      out['ip_address'] = redacted;
    }
  }
  return out;
}

/**
 * 脱敏 Sentry event 的 breadcrumbs 段.
 *
 * @param breadcrumbs 原始 breadcrumbs
 * @returns 脱敏后的 breadcrumbs
 */
function redactSentryBreadcrumbs(breadcrumbs: unknown[]): unknown[] {
  return breadcrumbs.map((crumb) => {
    if (!isPlainRecord(crumb)) return crumb;
    const out: Record<string, unknown> = { ...crumb };
    const data = out['data'];
    if (isPlainRecord(data)) {
      out['data'] = redactRecord(data, SENSITIVE_KEY_NAMES);
    }
    const message = out['message'];
    if (typeof message === 'string') {
      out['message'] = redactString(message);
    }
    const url = out['url'];
    if (typeof url === 'string') {
      out['url'] = redactPath(url);
    }
    return out;
  });
}

/**
 * 脱敏 Sentry event 的 exception 段.
 *
 * @param exception 原始 exception 段
 * @returns 脱敏后的 exception 段
 */
function redactSentryException(exception: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...exception };
  const values = out['values'];
  if (!Array.isArray(values)) return out;
  out['values'] = values.map((entry) => {
    if (!isPlainRecord(entry)) return entry;
    const value: Record<string, unknown> = { ...entry };
    const message = value['value'];
    if (typeof message === 'string') {
      value['value'] = redactString(message);
    }
    const stacktrace = value['stacktrace'];
    if (isPlainRecord(stacktrace)) {
      const outStack: Record<string, unknown> = { ...stacktrace };
      const frames = outStack['frames'];
      if (Array.isArray(frames)) {
        outStack['frames'] = frames.map((frame) => {
          if (!isPlainRecord(frame)) return frame;
          const outFrame: Record<string, unknown> = { ...frame };
          // 栈帧局部变量 (localVariablesIntegration 默认开) —— 心理原文常在这里 (如 userInput)
          const vars = outFrame['vars'];
          if (isPlainRecord(vars)) {
            outFrame['vars'] = redactRecord(vars, REQUEST_BODY_SENSITIVE_NAMES);
          }
          const preContext = outFrame['pre_context'];
          if (typeof preContext === 'string') {
            outFrame['pre_context'] = redactString(preContext);
          }
          const contextLine = outFrame['context_line'];
          if (typeof contextLine === 'string') {
            outFrame['context_line'] = redactString(contextLine);
          }
          return outFrame;
        });
      }
      value['stacktrace'] = outStack;
    }
    return value;
  });
  return out;
}

/**
 * Sentry event 级别脱敏 (beforeSend 的唯一入口).
 *
 * 覆盖:
 *   request.data / request.query_string / request.url / request.headers / request.cookies;
 *   user (email / username 删, ip 截断, id 保留);
 *   extra (只遮凭据类 —— 业务 id 是调试必需的);
 *   breadcrumbs (data / message / url);
 *   exception.values (value / stacktrace.frames 的 vars / pre_context / context_line).
 *
 * 不修改入参, 返回新 event.
 *
 * @param event 原始 event
 * @returns 脱敏后的 event
 */
export function redactEventForSentry(event: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...event };

  const request = out['request'];
  if (isPlainRecord(request)) {
    out['request'] = redactSentryRequest(request);
  }
  const user = out['user'];
  if (isPlainRecord(user)) {
    out['user'] = redactSentryUser(user);
  }
  const extra = out['extra'];
  if (isPlainRecord(extra)) {
    out['extra'] = redactRecord(extra, SENSITIVE_KEY_NAMES);
  }
  const breadcrumbs = out['breadcrumbs'];
  if (Array.isArray(breadcrumbs)) {
    out['breadcrumbs'] = redactSentryBreadcrumbs(breadcrumbs);
  }
  const exception = out['exception'];
  if (isPlainRecord(exception)) {
    out['exception'] = redactSentryException(exception);
  }
  return out;
}
