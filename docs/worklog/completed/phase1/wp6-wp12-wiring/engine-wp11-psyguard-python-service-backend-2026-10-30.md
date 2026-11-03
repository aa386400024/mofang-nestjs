# WP11 · PsyGUARD-RoBERTa Python 服务 + RiskProbePort HTTP 适配

> 日期：2026-10-30 ｜ 状态：待开工 ｜ 前置：WP4（RiskProbePort 端口 + assessSafety 编排已交付）
> 并行：可与 WP12 并行（两者零交集）

---

## 0. 一句话目标

在本地规则探测器（`LocalCrisisProbe`）旁边，加一个 **HTTP 版风险探测适配器**，指向一个**独立仓库的 Python FastAPI 服务**（加载 PsyGUARD-RoBERTa 中文风险分类模型），Docker 部署到生产服务器。服务挂掉/超时 → 静默回落本地规则，**绝不阻断对话**。

---

## 1. 范围

### 1.1 独立仓库 `mofang-psyguard/`

**位置**：与 `mofang-nestjs` 平级，即 `E:\Work\Project\backend\mofang-psyguard\`

**技术栈**：Python 3.12 + FastAPI + ONNX Runtime（量化推理，不用原版 PyTorch）

**为什么用 ONNX Runtime 而不是 PyTorch**：
- 生产服务器只有 2GB 内存，PyTorch FP32 加载后占 1.5GB，会 OOM
- ONNX Runtime 量化版占 ~500MB，单条延迟 100-200ms（Phase1 内测够用）
- 模型权重导出为 ONNX 格式，不依赖 transformers 库

**接口**：
- `POST /v1/classify` — 入参 `{ "text": "..." }`，出参 `{ "level": "low"|"medium"|"high", "categories": ["suicide","self_harm",...], "score": 0.0-1.0 }`
- `GET /health` — 出参 `{ "status": "ok", "model_loaded": true, "device": "cpu" }`

**模型**：PsyGUARD-RoBERTa（中文心理健康风险分类，11 类），CPU 推理。
- 模型权重不进 git，首次启动时从 HuggingFace 下载到 `/app/models/`
- `.gitignore` 排除 `models/` 目录

**目录结构**：
```
mofang-psyguard/
├── main.py              # FastAPI 入口
├── classifier.py        # 模型加载 + 推理封装
├── requirements.txt     # fastapi / uvicorn / onnxruntime / transformers(只用于下载权重)
├── Dockerfile           # 构建镜像
├── docker-compose.yml   # 一键启动
├── .gitignore
└── README.md            # 部署说明
```

### 1.2 部署到生产服务器

**服务器信息**：
- IP：`117.72.30.78`
- 用户：`root`
- 登录：`ssh root@117.72.30.78`（密码见现有部署文档，或用 sshpass）
- 已有服务：ebook-reader（PM2 管理，占 50MB）
- 已有软件：Docker 29.7.2 / Python 3.12 / Node v24 / Nginx 1.24

**部署方式**：
1. 服务器上 `git clone` 本仓库到 `/opt/mofang-psyguard/`
2. `docker compose up -d --build` 启动
3. 服务监听 `8100` 端口（只绑 `127.0.0.1`，不对外暴露）
4. NestJS 同机部署，通过 `http://127.0.0.1:8100` 调用
5. **不走 Nginx 反代**——同机内网直连，少一层转发

**资源限制**（docker-compose.yml）：
- 内存上限 `--memory=700m`（防止 OOM 拖垮整机）
- CPU 上限 `--cpus=1.5`（留 0.5 核给 ebook-reader 和系统）

> ⚠️ 以上是**原始需求口径**。审核后按用户决策 #2 实际落为 **900m / 2.0 核**（1.5 核配额下 CFS 限流让尾延迟按 100ms 跳；700M 实测贴着上限跑，余量仅 ~20MiB）→ 见 §6.5 第 ② 条与交付记录 §12.2。

**降级语义（关键）**：
- 模型加载失败 → `/health` 返回 `model_loaded: false`，`/v1/classify` 返回 503
- NestJS 侧收到 503 / 超时 / 连接拒绝 → 回落本地规则，记 warn

### 1.3 NestJS 侧 HTTP 适配器

**新文件**：`src/engine-adapters/wiring/risk/http-psyguard.probe.ts`

**实现 `RiskProbePort` 接口**：
- `probe(text, side)` → HTTP POST 到 `PSYGUARD_BASE_URL/v1/classify`
- 超时：`DEFAULT_PROBE_TIMEOUT_MS = 150ms`（与内核现有常量一致，不另造）
- 失败处理：任何异常（连接拒绝/超时/503/非 JSON/形状不对）→ **抛错**，由内核 `assessSafety` 兜住回落规则
- **不缓存**：每条文本独立请求，不做去重/缓存（风险判定要实时）

**DI 装配**（`engine.module.ts`）：
- 环境变量 `PSYGUARD_BASE_URL` 存在 → 用 `HttpPsyGuardProbe`
- 不存在 → 回退 `LocalCrisisProbe`（现状不变）
- 两者**不叠加**：一个 session 只用一个 probe

**健康检查接线**：
- NestJS 启动时 `GET PSYGUARD_BASE_URL/health`，失败不阻断启动，只记 warn
- 运行期不做主动健康巡检（被动降级即可）

### 1.4 规则词典补全（WP4 遗留小项）

在 `local-crisis.probe.ts` 的规则词典里补：
- 全半角归一（全角字母数字转半角后再匹配）
- 补学员倾诉/创伤表达词典的常见变体（"撑不下去了" / "活着没意思" / "不想坚持了" 等）
- **不做**：心理咨询术语库 / 长文本语义理解（那是 Python 模型的事）

### 1.5 MindGuard 占位

在 `risk-probe.ts` 同目录加一个 `mindguard-placeholder.ts`，导出空类或注释，明确"后期云 API，本期不接"。**不留行为字段、不留接口方法**。

---

## 2. 不做（红线）

| 不做 | 理由 |
|---|---|
| 不改 `src/engine-core/**` | 端口和编排已交付，本轮只在适配层加实现 |
| 不替换 LocalCrisisProbe | 它是降级兜底，HTTP probe 挂了要靠它 |
| 不做 probe 结果缓存 | 风险判定要实时，缓存会漏判 |
| 不做 GPU / 批量推理 / 异步队列 | Phase1 单实例，CPU 同步够用 |
| 不做 MindGuard 临床层 | 后期云 API，本期只留占位注释 |
| 不把 PsyGUARD 结果直接当最终等级 | 最终等级由内核 `assessSafety` 取 max(规则, probe) |
| 不改 voice WS 协议 | 对前端零感知 |
| 不对外暴露 8100 端口 | 只绑 127.0.0.1，安全起见不走公网 |
| 不把模型权重提交进 git | 几百 MB 不进版本控制，首次启动下载 |

---

## 3. 验收

1. `PSYGUARD_BASE_URL` 未设 → 行为与现状逐字一致（LocalCrisisProbe 兜底）
2. Python 服务正常 + `PSYGUARD_BASE_URL=http://127.0.0.1:8100` → 来访说"我想跳楼"时，probe 返回 high + categories 含 suicide，assessSafety 最终等级为 high
3. Python 服务挂掉（`docker stop`）→ 下一轮对话不报错，回落本地规则，日志有 warn
4. Python 服务响应 >150ms → 超时回落规则，不阻断对话
5. `/health` 返回 `model_loaded: false` → NestJS 记 warn，不阻断启动
6. 服务器上 `docker stats` 看 psyguard 容器内存不超过 700MB（**审核后限额为 900M**，实测 680.5/900MiB）
7. `tsc -p tsconfig.build.json --noEmit` 0 错
8. `git diff --stat HEAD -- src/engine-core` 为空（**审核后为 1 个文件** —— 决策 #4 明确要求改探测超时常量，见 §6.5 第 11 条）
9. 新增单测：HTTP probe 成功/超时/503/脏形状四种场景

---

## 4. commit 文案

```text
feat(engine): WP11 PsyGUARD-RoBERTa Python FastAPI 服务(独立仓库 mofang-psyguard, Docker 部署到 117.72.30.78) + NestJS HTTP RiskProbePort 适配, 服务挂/超时静默回落本地规则
```

---

## 5. 交付后回写

> 完整交付记录另见: [`engine-wp11-psyguard-python-service-backend-implementation-2026-10-30.md`](./engine-wp11-psyguard-python-service-backend-implementation-2026-10-30.md)（本文档末尾 §6 是它的摘要版）

---

## 6. 交付记录（2026-10-30 · WP11 后端）

### 6.1 模型事实（与任务单的出入都写在这）

| 项 | 任务单写 | 实测真相 |
|---|---|---|
| 仓库 | "PsyGUARD-RoBERTa" | **`qiuhuachuan/PsyGUARD-RoBERTa`**（`AI-for-Science/...` 这个 id 不存在） |
| 规格 | 未写 | **BERT-large**：24 层 / hidden 1024 / vocab 21128 / 11 个中文标签 |
| 推理 | 未写 | **multi-label**（逐维 sigmoid ≥ 0.5，一次可命中多类），不是 softmax |
| 类别名 | `["suicide","self_harm",...]` | 用**内核 `VisitorRiskCategory` 原名**（11 类逐字对应，见下表） |
| 权重来源 | "首次启动从 HuggingFace 下载" | **生产服务器 huggingface.co 与 hf-mirror.com 均不可达** → 改为「有网侧一次性导出 ONNX + 传权重」 |

**11 类对照（模型中文标签 ↔ 内核英文名 ↔ 粗档）**：

| 模型 id2label | 内核 `VisitorRiskCategory` | 粗档 |
|---|---|---|
| 自杀未遂 / 自杀准备行为 / 自杀计划 / 主动自杀意图 | `suicide_attempt` / `suicide_preparation` / `suicide_plan` / `active_ideation` | high |
| 他人攻击行为 / 自伤行为 | `aggression_others` / `self_harm_behavior` | high |
| 被动自杀意图 / 用户攻击行为 / 自伤意图 / 关于自杀的探索 | `passive_ideation` / `aggression_self` / `self_harm_ideation` / `suicide_exploration` | medium |
| 与自杀/自伤/攻击行为无关 | `neutral` | low |

### 6.2 两仓库各交付了什么

**独立仓库 `E:\Work\Project\backend\mofang-psyguard\`**（与 `mofang-nestjs` 平级）：

- `main.py`（FastAPI：`POST /v1/classify` + `GET /health`）/ `classifier.py`（ONNX 会话 + 分词 + **token 窗口** + 推理 + 降级）/ `model_meta.py`（11 类唯一真相源）
- `scripts/export_onnx.py`（下载 → fp32 ONNX → int8 量化 → **一致率/准确率/延迟实测**）+ `scripts/bench_latency.py`（干净进程延迟基准）+ `scripts/exp_truncation.py` / `exp_truncation_long.py` / `exp_window_caps.py`（**截断策略实验**：哪种窗口不损伤判别力）
- `Dockerfile`（瘦运行时镜像，**不含 torch**）/ `Dockerfile.prepare`（带 torch 的导出镜像）/ `docker-compose.yml`（`127.0.0.1:8100` + `--memory=900m` + `--cpus=2.0` + 单 worker；**审核后决策 #2 已上调，原为 700m / 1.5**）
- `tests/`（标准库 unittest，**不需要真实模型**也能跑）

**NestJS 侧 `mofang-nestjs`**：

- 新增 `src/engine-adapters/wiring/risk/http-psyguard.probe.ts`（`RiskProbePort` 的 HTTP 实现）
- 新增 `src/engine-adapters/wiring/risk/risk-probe.token.ts`（`RISK_PROBE` token）+ `psyguard-health.checker.ts`（启动自检）+ `mindguard-placeholder.ts`（MindGuard 占位）
- 改 `engine.providers.ts`（新增纯工厂 `createRiskProbe`）+ `engine.module.ts`（`PSYGUARD_BASE_URL` 分流装配）+ `local-crisis.probe.ts`（词典补全 + 全半角归一）+ `.env.example`

### 6.3 闸门结果

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ 0 错 |
| `npm run lint` | ✅ exit 0（0 error 0 warning） |
| `npx jest test/engine-adapters test/engine-core test/voice` | ✅ **27 套件 / 548 例全绿**（engine-core 零回归） |
| `npx jest test/engine-adapters/wp11-psyguard-probe.spec.ts` | ✅ **36 例全绿**（原 29 例 + 输出侧接线 7 例） |
| Python `python -m unittest discover -s tests -t .` | ✅ **37 例全绿**（原 20 例 + 窗口策略 11 例 + 线程数回归守卫 6 例） |
| `npm test`（全量） | ⚠️ **56 套件 / 872 例：870 例通过，1 套件 2 例失败**（`drill-judge.spec.ts` 既有债，与 WP9-C / WP10 / WP10A 登记一致，本轮零交集） |
| `git diff --stat HEAD -- src/engine-core` | ⚠️ 审核后为 **1 个文件**（决策 #4 要求改 `DEFAULT_PROBE_TIMEOUT_MS`；改动精确到一行常量 + 回改清单注释，见交付记录 §12.4） |

### 6.4 真机实测

- **导出**：fp32 ONNX 1302.8MB → **int8 ONNX 327.6MB**；**int8 vs fp32 命中一致率 0.9950**；对模型自带 `test.json` 的准确率 0.82；分词器 fast/slow 一致 ✓
- **本机延迟**（8 核 / 2 线程 / max_len 256）：p50 **41.9ms** / p90 56.6ms / p99 70.4ms
- **生产机成本曲线**（2 核 / 容器限额 1.5 CPU / 容器内纯推理）：BERT-large int8 ≈ **9.9ms + 3.34ms/token**（线程=2）→ 98 token 的真实咨询长句要 **325ms**，**必然被内核 150ms 上限掐断** → 由此定出服务侧 **token 窗口（头尾各半，默认 28）**
- **服务器**：Ubuntu 24.04 + Docker 29.7.2 + Compose v5.5.0，2 核 / 1963MB；服务只绑 `127.0.0.1:8100`；后端容器用 `network_mode=host` → `http://127.0.0.1:8100` 直连成立
- **终态**（审核后）：容器内存 **680.5MiB / 900MiB**（2.0 核 / 900M 限额）；`/health` → `status=ok` / `model_loaded=true` / `max_length=256` / 11 条 labels；端到端延迟 **p50 29.6–584.9ms**（按长度），85 字长句 p50 **242.9ms**（落在审核后临时放大的 500ms 预算内）

### 6.5 已知边界（必须如实看）

1. **后端镜像尚未重建**：服务器上的 `mofang-nestjs-api` 是 **2026-08-26** 构建，不含 WP11 代码。`PSYGUARD_BASE_URL` 已写进 `/opt/mofang-nestjs/.env`（**配置就位**），但**要等下一次后端发布**才会真正启用探测。本轮**未擅自重建线上后端镜像**（那会把 WP8B–WP10A 的大批变更一并带上线）。
2. **探测已同时接在 `counselor_input` 与 `visitor_output` 两侧**（审核后用户决策 #3，见 §6.5 第 ③ 条）：来访者台词侧走 `render-config.factory.ts` 的 `createVisitorOutputGuard({ probe })`。**只接 PsyGUARD HTTP 探测器，不接 `LocalCrisisProbe`** —— 理由见交付记录 §12.2。
3. **150ms 是内核硬上限**（`assessSafety` 自己 race，engine-core 红线，适配层改不动）。`PSYGUARD_TIMEOUT_MS` 只是**提前掐断 HTTP 连接**，调大它**不会**放宽内核上限。**审核后测试期临时放宽到 500ms**（决策 #4），M3 内测前必须改回 150（回改清单见交付记录 §12.5）。
4. **窗口是工程取舍，不是模型能力上限**：把输入压到 28 token 让"长文本也有答案"，代价是长文本子集准确率 0.9304 → 0.9174（−1.3pp）；不压的代价是 100% 超时作废。真正解开这个矛盾要靠更快的硬件或更小的模型（`qiuhuachuan` 名下**没有**更小的同族变体，已核实）。
5. **权重两条路线**：容器内在线拉取（compose 的 `prepare` profile）保留，但本环境走不通；实际用的是「有网侧导出 → scp 传 `models/`」。
6. **标签口径跨仓库两份**（Python 的 `model_meta.py` 与内核的 `VisitorRiskCategory`），靠启动自检逐类别比对，漂了记 warn（不断启动）。
7. **11 类标签未经本项目临床复核**（沿用原论文与 C-SSRS 改编口径）。
8. **真机才暴露的一个 bug 已修**（见交付记录 §8.3）：`SessionOptions` 线程数三元条件写反 → 模型加载失败 → 服务恒 degraded。**单测没抓到**（当时把 `_build` 整个 mock 掉了），已把该路径抽成可单测方法并补回归守卫。
9. **审核后的四个追加决策**（详见交付记录 §12）：① 后端镜像不重建（攒到 WP12 一起发）；② 容器 CPU 1.5 → **2.0 核**、内存 700M → **900M**；③ **来访输出侧接上 PsyGUARD 探测器**（只接 HTTP 探测器，不接本地词典 —— 理由见交付记录 §12.2）；④ **测试阶段临时放宽**：token 窗口 28 → **256**、内核 `DEFAULT_PROBE_TIMEOUT_MS` 150 → **500**。
10. **临时值必须在 M3 内测前改回**（交付记录 §12.5 给了 6 处回改清单）：窗口 256 → **28**、内核超时 500 → **150**。现在的口径是"一个人测试期准确率优先"，**不是**多人内测的生产口径。
11. **引擎核心不再是零改动**：决策 #4 要求改 `DEFAULT_PROBE_TIMEOUT_MS`，`src/engine-core` 的 diff 精确到一个文件、一行常量 + 回改清单注释。这是**用户明确要求的改动**，不是红线破防；输出侧探测（决策 #3）全程走适配层，内核**没有**第二处改动。
12. **极长输入（≈200 字）仍超预算**：500ms 只覆盖到 ≈145 token，那部分依旧超时作废 —— 真正解开要靠更快的硬件或更小的模型（`qiuhuachuan` 名下无更小同族变体），不是调超时能解决的。

