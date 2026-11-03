# 团队规范（代码红线 + 交付格式）

> 所有写后端代码的人（包括 AI）必须遵守。
> 违反 engine-core 红线一次 = 会话终止。

---

## 一、绝对红线

### 1.1 engine-core 纯层一行不动

```bash
git diff --stat HEAD -- src/engine-core
```
交付时这个命令输出必须为空。

- ❌ 不改 `src/engine-core/**` 下任何文件
- ❌ 不在 engine-core 里加 @nestjs/、网络调用、prompt、模型名、`process.env`
- ✅ 所有新逻辑放 `src/engine-adapters/` 或业务层

> **例外**：用户明确拍板改底层（如 WP15 delta cap、WP26 P2-14 env 注入），需在任务单里写明，改完必须通过 `boundary.spec.ts` 的 11 条断言。

### 1.2 不写前端代码

- ❌ 不碰 `admin-dashboard/`（Vue3 SPA，前端另一个 AI 管）
- ❌ 不碰 Flutter 客户端代码

### 1.3 不跑前端命令

- ❌ 不跑 flutter / dart / pub 命令
- ✅ 只跑后端的：`npx eslint` `npx tsc` `npx vitest`

---

## 二、交付格式

每个任务做完必须做的事：

### 2.1 写交付记录

在同目录写一个 `*-implementation-YYYY-MM-DD.md`，内容：
1. 实际改了哪些文件（路径清单）
2. 关键设计决策（跟任务单有出入的地方，说明为什么）
3. 闸门数字：
   - `npx eslint "src/**/*.ts"` → 0 error
   - `npx tsc -p tsconfig.build.json --noEmit` → 0 error
   - `npx vitest run` → 全绿
   - `git diff --stat HEAD -- src/engine-core` → 空（或例外批准）

### 2.2 移文件 + 改任务单状态行

- 任务单 + 交付记录，从 `pending/` 移到 `completed/` 对应子目录
- 任务单顶部状态行从 `> 状态: 📋 待开工` 改成 `✅`，指向交付记录文件名

### 2.3 一句话 commit

```
feat(wpXX): 一句话说清做了什么
```

### 2.4 回写 backlog

交付完更新 backlog 母版（任务单里会指定是哪个文件）。

### 2.5 任务单与代码不符时：反复核实，找企业级最佳方案

任务单是人写的，可能跟实际代码有出入。遇到以下情况时：
- 任务单引用的函数名 / 事件类型 / 常量名在代码里不存在
- 任务单描述的逻辑与现有实现冲突
- 任务单给的方案会引入回归

**正确做法：**
1. **先 grep 核实** —— 不要凭印象改，先扫代码确认真实函数名、真实调用链、真实文件路径
2. **找企业级最佳方案** —— 不是"任务单写错了，我随便改一下"，而是按大厂标准重新设计接入点、数据流、边界
3. **在交付记录里写明偏差** —— §2.1 第 2 条"关键设计决策"要列清楚：任务单怎么写的、代码实际是什么、你怎么改的、为什么这么改
4. **不要因为任务单写错就降级交付质量** —— 发现错误是好事，但不能因为"任务单没写对"就凑活做

**反面教材：**
- ❌ 任务单写 `processEvent()`，代码里没有，你就自己造一个新函数硬塞进去
- ❌ 任务单说改 A 文件，你发现应该改 B 文件，就默默改了，交付记录里不提
- ❌ 发现方案有回归风险，但觉得"任务单就是这么写的"，照做了

**正面教材：**
- ✅ 任务单写的调用链跟代码对不上，你先 grep 找到真实链路，选正确的接入点，交付记录里说明
- ✅ 任务单给的系数会引入回归，你保留原有前提条件，只加新增维度，交付记录里说明偏差和理由

---

## 三、写代码前必看的 16 条硬约束

1. **migration 真注册点是 `bin/ormconfig.ts`**（import + `migrations[]` 数组），漏登记会静默不建表
2. **counselor 系 migration 一律手写 DDL** —— `migration:generate` 扫不到 counselor entity
3. **软删不是 `@DeleteDateColumn`** —— 每处查询手写 `deletedAt: IsNull()`
4. **同名符号跨文件要查重**
5. `noUnusedLocals`（未使用 import = 错误）· `strict`
6. **结构化输出只有一条链** —— 走 `CounselorLlmJsonClient`
7. **`.env` 的 `MINIMAX_LLM_MODEL` / `MINIMAX_BASE_URL` 是 ASR/TTS 共用值，不许动**
8. **M3.1-Flash 忽略 `temperature`/`top_p`**；**thinking token 计入生成长度上限**
9. **不自动 commit / push** —— 写完给 commit 文字，等用户指令
10. **偏好表的键白名单拦不住"已知键 + 非法值"**
11. **SSE 事件总线是进程内的** —— 多实例部署需换 Redis Pub/Sub
12. **异步任务的偏好在「执行时」读**
13. **jobId 要幂等**
14. **agent 与 business 之间只走 @Global 注册表**
15. **业务上下文块要能"替换"通用画像**
16. **"档位"只控展示，不控是否分析**

---

## 四、零压红线（自由练习 vs MCQ）

- 自由练习（practice）**无分数 / 无对错 / 无评级**
- 分数只允许出现在 MCQ 备考频道（training-exercises）
