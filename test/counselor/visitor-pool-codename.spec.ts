// V2026-10-27 治本 (来访池代号合规巡检 + 历史脏数据订正, spec 任务 D):
//   原因: 代号是用户在图鉴里看到的**唯一**人物标识. 它一旦不合规 (带系统前缀 /
//     姓氏首字 / 强性别字 / 性格评价字), 学员第一眼就会觉得"这是系统造的角色" ——
//     代入感归零, "练习非真人"的边界也被产品自己反复提醒.
//     而历史库里有这种行 (早期版本把"系统前缀 + 代号"拼在一起当代号用), seed 的
//     upsert 只覆盖 6 位官方人物, 碰不到它们 —— 所以需要一次**幂等**的全表订正.
//
//   本文件锁死:
//     ① 词库自检全绿 (D1)
//     ② 6 位官方人物的代号: 形态合规 + 都在词库 (D1)
//     ③ 四类违规形态各自的判定与订正 (D3):
//        旧前缀「来访者·X」/ 姓氏首字 / 性格评价字 / 撞名尾号「晚晴 · 02」
//     ④ 订正的幂等性: 修完再修 = 不动 (合规行不被改写)
//
//   验证: npx jest test/counselor/visitor-pool-codename.spec.ts 全绿
//   时间戳: 2026-10-27
import {
  composeCodename,
  isAcceptableCodename,
  isInCodenameBank,
  resolveCompliantCodename,
  validateCodenameBank,
} from '../../src/counselor/config/visitor-pool-codename';
import { VISITOR_POOL_TEMPLATE_SEEDS } from '../../src/counselor/config/visitor-pool-seed';

/** 空占用集 (新库场景). */
const EMPTY_TAKEN: ReadonlySet<string> = new Set<string>();

describe('D1 · 词库与 seed 代号自检', () => {
  it('词库自身全绿 (形态 / 姓氏 / 强性别字 / 性格评价字 / 重名)', () => {
    expect(validateCodenameBank()).toBeNull();
  });

  it('6 位官方人物的代号: 过命名规则 + 都在词库覆盖范围内', () => {
    expect(VISITOR_POOL_TEMPLATE_SEEDS.length).toBe(6);
    for (const seed of VISITOR_POOL_TEMPLATE_SEEDS) {
      expect(isAcceptableCodename(seed.codename)).toBe(true);
      expect(isInCodenameBank(seed.codename)).toBe(true);
    }
  });

  it('6 位官方人物的代号互不重复', () => {
    const names = VISITOR_POOL_TEMPLATE_SEEDS.map((seed) => seed.codename);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('D3 · 旧前缀 (系统视角标签)', () => {
  it('「来访者·晚晴」不合规 (系统标签写进了名字)', () => {
    expect(isAcceptableCodename('来访者·晚晴')).toBe(false);
  });

  it('带空格的旧形态「来访者 · 晚晴」同样不合规', () => {
    expect(isAcceptableCodename('来访者 · 晚晴')).toBe(false);
  });

  it('订正: 剥掉前缀, 主体本身合规就用主体 (最小改动, 保住人物身份)', () => {
    expect(resolveCompliantCodename('来访者·晚晴', EMPTY_TAKEN)).toBe('晚晴');
    expect(resolveCompliantCodename('来访者 · 晚晴', EMPTY_TAKEN)).toBe('晚晴');
  });

  it('订正: 剥前缀后主体已被占用 → 换一个合规代号 (不撞名)', () => {
    const taken = new Set<string>(['晚晴']);
    const fixed = resolveCompliantCodename('来访者·晚晴', taken);
    expect(fixed).not.toBeNull();
    expect(fixed).not.toBe('晚晴');
    expect(isAcceptableCodename(fixed!)).toBe(true);
  });

  it('订正: 前缀剥完仍不合规 (主体本身带姓氏) → 从词库换一个', () => {
    const fixed = resolveCompliantCodename('来访者·李然', EMPTY_TAKEN);
    expect(fixed).not.toBeNull();
    expect(fixed).not.toBe('李然');
    expect(isAcceptableCodename(fixed!)).toBe(true);
  });
});

describe('D3 · 姓氏首字', () => {
  it('「李然」不合规 (首字是常见姓 → 像真实姓名)', () => {
    expect(isAcceptableCodename('李然')).toBe(false);
  });

  it('订正: 换一个合规代号 (不硬改原文)', () => {
    const fixed = resolveCompliantCodename('李然', EMPTY_TAKEN);
    expect(fixed).not.toBeNull();
    expect(fixed).not.toBe('李然');
    expect(isAcceptableCodename(fixed!)).toBe(true);
  });
});

describe('D3 · 性格评价字', () => {
  it('「小烈」不合规 (烈 是性格/刚烈类评价字)', () => {
    expect(isAcceptableCodename('小烈')).toBe(false);
  });

  it('「倔强」不合规 (倔 是性格评价字)', () => {
    expect(isAcceptableCodename('倔强')).toBe(false);
  });

  it('订正: 换一个合规代号', () => {
    const fixed = resolveCompliantCodename('小烈', EMPTY_TAKEN);
    expect(fixed).not.toBeNull();
    expect(isAcceptableCodename(fixed!)).toBe(true);
  });
});

describe('D3 · 撞名尾号', () => {
  it('「晚晴 · 02」合规 (尾号是**合法的**去重形态, 不是脏数据)', () => {
    expect(isAcceptableCodename('晚晴 · 02')).toBe(true);
  });

  it('合规行不订正 (resolveCompliantCodename 返回 null = 不改写)', () => {
    expect(resolveCompliantCodename('晚晴 · 02', EMPTY_TAKEN)).toBeNull();
  });

  it('无空格的「晚晴·02」不合规 (分隔符形态不对, 会当主体里的脏字符)', () => {
    expect(isAcceptableCodename('晚晴·02')).toBe(false);
  });
});

describe('D2 · 订正的幂等性', () => {
  it('修一次 → 合规; 再修一次 → 不动 (连跑两次结果一致)', () => {
    const first = resolveCompliantCodename('来访者·晚晴', EMPTY_TAKEN);
    expect(first).toBe('晚晴');
    const taken = new Set<string>(['晚晴']);
    expect(resolveCompliantCodename(first!, taken)).toBeNull();
  });

  it('合规行一律不订正', () => {
    for (const seed of VISITOR_POOL_TEMPLATE_SEEDS) {
      expect(resolveCompliantCodename(seed.codename, EMPTY_TAKEN)).toBeNull();
    }
  });

  it('修出来的代号可重放: 同一 taken 集合 → 同一结果', () => {
    const taken = new Set<string>(['晚晴']);
    expect(resolveCompliantCodename('来访者·晚晴', taken)).toBe(resolveCompliantCodename('来访者·晚晴', taken));
  });

  it('兜底: 词库取完时 composeCodename 仍给出未占用的合规代号', () => {
    const taken = new Set<string>();
    const composed = composeCodename(taken);
    expect(isAcceptableCodename(composed)).toBe(true);
    expect(taken.has(composed)).toBe(false);
  });
});
