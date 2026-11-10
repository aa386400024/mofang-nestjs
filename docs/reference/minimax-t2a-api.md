# MiniMax T2A 语音合成 API · 参考要点

> 来源：https://platform.minimaxi.com/docs/llms.txt
> 整理日期：2026-11-10
> 用途：本项目 `src/voice/tts/` 对接 MiniMax T2A 的字段/标签/错误码速查。
> 官方完整文档是 SPA，本文件只摘代码里实际要用到的部分；字段 schema 以官方为准。

## 三个接口选型

| 接口 | 地址 | 攒句责任 | 本项目用哪个 |
|---|---|---|---|
| HTTP 同步 | `POST /v1/t2a_v2` | 客户端 | 不用（批量离线用） |
| WebSocket 流式 | `/ws/v1/t2a_v2` | 客户端自己切句 | 不用 |
| **双向流式 bidi** | **`/ws/v1/t2a_v2_bidi`** | **服务端自动攒句** | **✅ `tts-bidi-client.ts` 用这个** |

bidi 接口的关键能力：
- 客户端可逐 token / 逐字发送，服务端自己攒句后合成
- 服务端返回 `sentence_start` / `sentence_end`（告诉客户端它怎么切句的）
- `task_cancel`：打断（打断后可继续发 `task_continue`，不重建连接）
- `task_flush`：催出残留但不结束会话（一轮尾句短又不带标点时用）
- `task_finish`：合成完残留再关闭连接

## 文本里支持的标记（喂给 TTS 的 text 字段）

### 停顿
- 格式：`<#x#>`，x 秒，范围 **[0.01, 99.99]**，最多两位小数
- 必须插在两个可发音文本之间，**不能连用**多个停顿

### 语气词标签（仅 speech-2.8-hd / speech-2.8-turbo 支持）
官方白名单（白名单外的会被当普通文字念出来）：

```
(laughs) (chuckle) (coughs) (clear-throat) (groans) (breath)
(pant) (inhale) (exhale) (gasps) (sniffs) (sighs) (snorts)
(burps) (lip-smacking) (humming) (hissing) (emm) (sneezes)
```

### 发音替换（行内）
- 拼音带声调数字：`(chu3)(li3)`
- IPA：`(lɪv)`
- 粤语拼音：`(sung3)`
- 或文本替换：`危险/dangerous`

## voice_setting 字段

| 字段 | 类型 | 范围 | 默认 | 说明 |
|---|---|---|---|---|
| `voice_id` | string | 必填 | — | 音色 ID |
| `speed` | float | [0.5, 2] | 1.0 | 语速 |
| `vol` | float | (0, 10] | 1.0 | 音量 |
| `pitch` | int | [-12, 12] | 0 | 语调（原音色为 0） |
| `emotion` | string | 见下 | 模型自动 | 情绪 |

### emotion 合法枚举（重要）
```
happy  sad  angry  fearful  disgusted  surprised  calm  fluent  whisper
```

- `calm` = 中性（**不要写成 `neutral`**，后者不是合法值）
- `fluent` / `whisper` 仅 speech-2.6 系列支持；speech-2.8 不支持 `whisper`
- 不传 = 模型自动匹配

### audio_setting 常用字段
- `sample_rate`：[8000, 16000, 22050, 24000, 32000, 44100]，默认 32000
- `bitrate`：[32000, 64000, 128000, 256000]，默认 128000
- `format`：mp3 / pcm / flac / wav / pcmu_raw / pcmu_wav / opus，默认 mp3
- `channel`：1 单声道 / 2 双声道，默认 1

## 模型列表
```
speech-2.8-hd   speech-2.8-turbo
speech-2.6-hd   speech-2.6-turbo
speech-02-hd    speech-02-turbo
speech-01-hd    speech-01-turbo
```

## 错误码（base_resp.status_code）

| 码 | 含义 | 处理 |
|---|---|---|
| 0 | 成功 | — |
| 1000 | 未知错误 | — |
| 1001 | 超时 | — |
| 1002 | 触发限流 | — |
| 1004 | 鉴权失败 | — |
| 1039 | TPM 限流 | — |
| **1042** | **非法字符超 10%** | 文本被拒绝；我们 parser 的 Level 2 阈值就是 10% |
| 2013 | 输入参数异常 | — |
| 2201 | 连接空闲超时（120s 无活动被关） | 客户端要自己发 ping |
| 2202 | 非法事件顺序 | — |
| 2203 | 空文本跳过（仅 /v1/t2a_v2） | — |
| 2204 | 单条 task_continue 超 10000 字符 | 该条被跳过，连接保持 |
| **2205** | **排队待合成文本过多** | **软失败，不重连，稍后重发该条即可** |
| 2206 | 事件顺序非法（如重复 task_start） | — |

## 攒句规则（bidi 服务端行为，影响我们 preprocessor 设计）

| 文本情况 | 服务端行为 |
|---|---|
| 以句末标点（`。！？…!?.` 及换行）结尾 | 立即送合成，零延迟 |
| 次级标点（`，、；：,;:`） | 攒够长度才切 |
| 长文本完全没标点 | 达长度上限强制切 |
| 尾部不带标点但已攒够长度 | 等静默窗口兜底送出 |
| **尾部短文本又不带标点** | **继续等，不会为低延迟切半词** → 需要时发 `task_flush` 催 |

**结论**：我们的 StreamingSemanticPreprocessor 不需要自己切句，只需要缓冲到语义标签（`[xxx]`）闭合，再原样透传给 TTS 客户端。
