// V2026-10-29 治本 (WP18 · 结构化输出 · JSON 载荷抽取):
//   职责: 把模型吐出来的"带脏东西的文本"还原成一个可 `JSON.parse` 的对象文本 ——
//         这是**所有**结构化输出链路 (agent 主报告 / counselor 4 流派 / 每轮分析 /
//         练习评判 / 知情同意判定) 的公共前置工序.
//   边界: 纯函数, 零 NestJS / 零 IO / 零网络 / 零 LLM 依赖.
//
//   为什么提到 shared (而不是留在 counselor):
//     这段容错逻辑原本住在 `counselor/providers/llm-json.client.ts` (counselor 侧),
//     而 agent 侧的主报告 (`agent/supervisor/supervisor.service.ts`) 用的是**裸**
//     `JSON.parse` —— 于是同一个模型、同一个"爱加 ```json 围栏 / 爱写废话"的行为,
//     在两条链路上表现完全不同: counselor 侧容错后照样出结果, agent 侧直接
//     `parse_error`. 这是典型的**双胞胎**, 治本只能是把实现收到一处, 两边共用.
//
//     而 agent **不能**引 counselor (仓库依赖方向是 counselor → agent, 反向会成环),
//     所以唯一真相必须落在两边都能引的位置 = `src/shared`.
//
//   它治的是哪三种脏数据 (都是实测遇到的):
//     1. ```json ... ``` 围栏 —— 模型爱加, 加了裸 JSON.parse 必挂;
//     2. 前后废话说明 —— "以下是督导报告: {...}"; "{...} 以上是本次分析";
//     3. <think>...</think> 内联思考块 —— M3 系列把它内联在 content 里 (官方要求
//        完整保留, 因为多轮 function call 靠它保持思维链), 但**一次性**结构化
//        提取场景不需要它, 剥掉不影响单轮结论.
//
//   反双胞胎:
//     - 不在这里做业务校验: JSON 能不能解析出来是**这一层**的事; 字段对不对是
//       各调用方自己的 validate 回调的事 (各链路字段契约不同, 不能混).
//     - 不"猜"缺失的闭合括号: 截断的 JSON (finish_reason=length) 补括号也解析不出
//       合法结构, 那是**上游预算问题**, 该由调用方按 finish_reason 报错, 不能在这里
//       糊出一份半截数据冒充完整结果.
//     - 不吞异常: 抽不出就返回 null, 由调用方决定失败语义 (不 throw).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/shared/wp18-llm-json-payload.spec.ts 覆盖围栏 / 废话 / 思考块 / 空 / 截断

/**
 * 剥掉内联的 `<think>...</think>` 思考块.
 *
 * M3.1-Flash 的思考内容走独立 `reasoning_content` 字段 (content 干净), 但 M3 系列的
 * `<think>` 标签是**内联在 content 里的** (官方文档明确要求完整保留, 因为多轮 function call
 * 要靠它保持思维链). 本函数只用于"一次性结构化 JSON 提取"场景, 剥掉后不影响单轮结论.
 *
 * @param raw 原始响应文本
 * @returns 去掉思考块后的文本
 */
export function stripThinkingTags(raw: string): string {
  return raw.replaceAll(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
}

/**
 * 从原始响应里抠出 JSON 对象文本.
 *
 * 依次处理 3 种脏数据:
 *   1. ```json ... ``` 围栏 (模型爱加)
 *   2. 前后废话说明 ("以下是督导报告: {...}")
 *   3. M3 系列内联的 `<think>...</think>` 思考块
 *
 * @param raw 原始响应文本
 * @returns JSON 对象文本; 抠不出返回 null
 */
export function extractJsonPayload(raw: string): string | null {
  const cleaned = stripThinkingTags(raw)
    .replaceAll(/```json/gi, '')
    .replaceAll('```', '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return cleaned.slice(start, end + 1);
}
