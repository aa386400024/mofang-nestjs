# 架构演进路线：从单体到服务拆分

> 日期：2026-11-03 ｜ 状态：**指导原则，不是当前任务**
> 适用对象：后端开发——写代码时朝这个方向靠，别等到要拆的时候发现拆不动
> 触发时机：等内测数据说话，不提前拆

---

## 0. 为什么写这个

项目从 WP0 做到 WP26，NestJS 单体模块越来越多。现在不拆，但要让代码结构保持"将来好拆"。这份文档约定两个未来拆分点，以及现在写代码时要遵守的边界规则。

**核心原则**：现在不做任何服务拆分，但模块间依赖必须干净——将来拆的时候只需改装配，不改业务逻辑。

---

## 1. 拆分目标（未来态）

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Flutter App │────▶│ voice-gateway │────▶│  core-api   │
└─────────────┘     │  (WS 长连接)  │     │ (NestJS单体) │
┌─────────────┐     └──────┬───────┘     └──────┬──────┘
│ Admin Vue   │──────────────────────────────▶│             │
└─────────────┘                            │  ┌──────┴──────┐
                                            │  │  ai-proxy   │
                                            │  │ (LLM/TTS/  │
                                            │  │  ASR 代理)  │
                                            │  └──────┬──────┘
                                            │         │
                                     ┌──────┴──────┐  │
                                     │ mofang-     │◀─┘
                                     │ psyguard    │ (已独立)
                                     │ (Python)    │
                                     └─────────────┘
```

### 1.1 voice-gateway（语音 WS 网关）

**职责**：
- 维护 WebSocket 长连接（Socket.IO）
- 帧收发、握手鉴权、断线检测
- 不做业务逻辑——不调 BDI、不渲染、不落库

**为什么要拆**：
- 主进程重启/部署时，所有语音对练全断
- 报告生成等重 CPU 任务卡住事件循环时，语音帧延迟
- 语音并发可以独立扩缩容（多实例 WS 网关，核心 API 保持 1-2 实例）

**什么时候拆**：并发语音会话 50+，或主进程重启影响到对练体验。

### 1.2 ai-proxy（AI Provider 代理层）

**职责**：
- 所有 LLM / TTS / ASR 外部调用统一入口
- 模型路由（主备切换已在做）、成本统计、速率限制、缓存
- 业务层不直接 import MiniMax SDK

**为什么要拆**：
- AI 调用量起来后要独立扩缩容
- 加多模型供应商（不只是 MiniMax）时不用动业务代码
- 成本核算/限流/熔断集中在一处

**什么时候拆**：接第二个 AI 供应商，或单场成本日志需要独立看板。

### 1.3 已经独立的

- **mofang-psyguard**（Python FastAPI）——已拆，保持现状。

---

## 2. 现在写代码要遵守的边界规则

这些不是架构大改，是**写代码时的卫生习惯**，让将来拆分无痛。

### 2.1 voice 模块不做业务逻辑

`src/voice/` 里的 gateway/service：
- ✅ 可以：握手鉴权、帧路由、WS 生命周期管理、调用 engine-adapters
- ❌ 不可以：直接 import engine-core 纯函数、直接写 DB、直接调 LLM

**现状检查**：voice.service.ts 现在调 engine-adapters 是对的。新增功能时如果发现 voice 里直接 import 了 engine-core 的东西，停下来——应该走 adapter 层。

### 2.2 业务层不直接 import MiniMax SDK

所有外部 AI 调用必须经过 engine-adapters 里的 RenderPort / RiskProbePort / TTS adapter：
- ✅ `LlmRenderAdapter.render(spec)`
- ✅ `HttpPsyGuardProbe.assess(text)`
- ❌ 在 voice.service / controller 里直接 `import OpenAI from 'openai'`

**现状**：已经这么做了，保持。

### 2.3 模块间通过端口（Port）通信，不直接 import

engine-core 定义 Port 接口，engine-adapters 实现。voice/admin 只调 adapter，不直接调 engine-core 内部。

**现状**：这是 engine-core 的核心设计原则，保持。

### 2.4 配置走 env，不硬编码跨模块地址

将来 voice-gateway 和 core-api 拆成两个进程时，它们之间通信用的地址（内部 RPC URL）必须从 env 读，不能写死 localhost。

**现在**：模块间直接方法调用，不用地址。但如果哪天 voice 需要调 core-api，那个 URL 必须走 env。

### 2.5 不要在 voice 模块里写"必须同进程"的假设

比如：
- ❌ 假设 BDI 状态在内存里直接读——将来 voice-gateway 是独立进程，读不到
- ✅ 假设 BDI 状态通过 engine-adapters 的端口访问——将来换成 HTTP 客户端就行

**现状**：WP23 已经暴露了这个问题（BDI 仓储是内存态，进程重启恢复不了）。这就是为什么 P3 里有"BDI 仓储 DB 化"。

---

## 3. 拆分时的迁移路径（现在不用做，记录备查）

### voice-gateway 拆分步骤

1. voice 模块所有对 engine-adapters 的调用，改成通过内部 HTTP/RPC 接口
2. voice-gateway 独立部署（Docker），只暴露 `/voice/training` WS 端点
3. core-api 保留所有业务逻辑和管理 API
4. 两者共享 JWT 密钥（env 配置），voice-gateway 验签后转发

### ai-proxy 拆分步骤

1. engine-adapters 里的 LLM/TTS/ASR 调用抽出成独立 service
2. core-api 通过 HTTP 调 ai-proxy（带 service token）
3. ai-proxy 内部做模型路由、成本统计、限流

---

## 4. 明确不拆的

- engine-core 纯层——它本来就是无 IO 的纯函数，不需要独立部署
- admin-dashboard——前端 Vue3，不是后端服务
- MySQL / Qdrant / Redis——基础设施，不是业务服务
- profile / auth / user——标准 CRUD，跟主业务绑定紧，不拆

---

## 5. 触发拆分的信号（写到这里，到时候对号入座）

| 信号 | 拆什么 |
|---|---|
| 并发语音会话 50+，主进程重启断全部对练 | voice-gateway |
| 接第二个 AI 供应商，或 AI 调用要独立扩容 | ai-proxy |
| 团队 >3 人，有人专门做语音 | 按团队边界拆 |
| BDI 仓储 DB 化完成后 | voice-gateway 可以独立部署 |

在这些信号出现之前，**保持单体，把模块边界擦干净就行**。
