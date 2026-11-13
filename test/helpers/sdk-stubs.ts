// V2026-11-13 (TD-10 · T-2): 重型 SDK 的 import 阶段替身工厂.
//
//   为什么要它 (结构性根因, 不是洁癖):
//     全量 vitest 的耗时构成里 import 占 74% —— 每个 spec 独立 fork, 重载整张依赖图.
//     本机实测 (热盘, 三轮中位数, 独立进程): ioredis 80 ms · bullmq 201 ms ·
//     @qdrant/js-client-rest 135 ms · @langchain/core/messages 324 ms · @langchain/openai 657 ms.
//     传递可达面 (非 e2e spec): ioredis 82 个 · bullmq 27 个 · qdrant 5 个 · langchain 6 个.
//
//   替身挡在哪一层 (口径):
//     挡在 **SDK 包边界**, 不替身整个适配层 ——
//     适配层 (RedisService / 队列处理器 / QdrantService / LlmRouter) 仍是**真实现**,
//     断言口径不变; 只有 SDK 本体不进 import 阶段.
//     替身整个适配层会把适配层逻辑一起替掉 = 改断言语义, 违反本单红线.
//
//   三条替身口径:
//     ① 纯工厂: 每次调用返回新对象; 本文件不持模块级可变状态; 不 import NestJS 容器,
//        不做 module 装配, 不硬编码业务阈值.
//     ② 数据面方法**一律 throw**: 替身被真的用到时当场炸 ——
//        静默返 undefined 会让断言空过 (最阴的一种假绿: expect(x).toBeUndefined() 会过).
//     ③ 连接生命周期方法 (on / quit / status) 惰性 no-op: 它们不产生语义,
//        但 RedisService.onModuleInit 会调 on() 与 ping().
//
//   用法 (spec 内; 动态 import 避开 vi.mock 的 hoisting 抢跑):
//     vi.mock('ioredis', async () => {
//       const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
//       return createIoredisStub();
//     });

/** 替身被调用时的统一报错 (把「环境缺陷」与「真实回归」分开). */
function sdkStubCalled(pkg: string, member: string): never {
  throw new Error(
    `[TD-10] ${pkg}.${member}() 被调用 —— 本 spec 不该依赖真实 SDK. ` +
      `若断言确实需要真实 SDK, 请移除本 spec 的 vi.mock 并在交付记录的例外清单登记.`,
  );
}

/** ioredis 替身: 生命周期惰性, 数据面当场炸. */
export function createIoredisStub(): { Redis: new (...args: any[]) => any } {
  class RedisStub {
    constructor(..._args: any[]) {}

    // —— 生命周期 (惰性 no-op): 不产生语义, 但 onModuleInit 会调 on() / ping() ——
    on(): this {
      return this;
    }

    once(): this {
      return this;
    }

    off(): this {
      return this;
    }

    async quit(): Promise<'OK'> {
      return 'OK';
    }

    disconnect(): void {}

    duplicate(): RedisStub {
      return new RedisStub();
    }

    readonly status = 'end';

    get options(): Record<string, unknown> {
      return {};
    }

    defineCommand(): this {
      return this;
    }

    // —— 数据面: 一律当场炸 ——
    async get(): Promise<never> {
      return sdkStubCalled('ioredis', 'get');
    }

    async set(): Promise<never> {
      return sdkStubCalled('ioredis', 'set');
    }

    async del(): Promise<never> {
      return sdkStubCalled('ioredis', 'del');
    }

    async exists(): Promise<never> {
      return sdkStubCalled('ioredis', 'exists');
    }

    async incr(): Promise<never> {
      return sdkStubCalled('ioredis', 'incr');
    }

    async incrby(): Promise<never> {
      return sdkStubCalled('ioredis', 'incrby');
    }

    async expire(): Promise<never> {
      return sdkStubCalled('ioredis', 'expire');
    }

    async ttl(): Promise<never> {
      return sdkStubCalled('ioredis', 'ttl');
    }

    async hset(): Promise<never> {
      return sdkStubCalled('ioredis', 'hset');
    }

    async hget(): Promise<never> {
      return sdkStubCalled('ioredis', 'hget');
    }

    async hgetall(): Promise<never> {
      return sdkStubCalled('ioredis', 'hgetall');
    }

    async zcount(): Promise<never> {
      return sdkStubCalled('ioredis', 'zcount');
    }

    async xadd(): Promise<never> {
      return sdkStubCalled('ioredis', 'xadd');
    }

    async eval(): Promise<never> {
      return sdkStubCalled('ioredis', 'eval');
    }

    async ping(): Promise<never> {
      return sdkStubCalled('ioredis', 'ping');
    }
  }

  return { Redis: RedisStub };
}

/** bullmq 替身: Queue / Worker / Job. */
export function createBullmqStub(): {
  Queue: new (...args: any[]) => any;
  Worker: new (...args: any[]) => any;
  Job: new (...args: any[]) => any;
} {
  class QueueStub {
    constructor(..._args: any[]) {}

    on(): this {
      return this;
    }

    async add(): Promise<never> {
      return sdkStubCalled('bullmq', 'Queue.add');
    }

    async getJob(): Promise<never> {
      return sdkStubCalled('bullmq', 'Queue.getJob');
    }

    async getJobs(): Promise<never> {
      return sdkStubCalled('bullmq', 'Queue.getJobs');
    }

    async close(): Promise<void> {}

    async obliterate(): Promise<void> {}
  }

  class WorkerStub {
    constructor(..._args: any[]) {}

    on(): this {
      return this;
    }

    async close(): Promise<void> {}

    async run(): Promise<void> {}
  }

  class JobStub {
    constructor(..._args: any[]) {}

    async updateProgress(): Promise<void> {}

    async moveToFailed(): Promise<void> {}
  }

  return { Queue: QueueStub, Worker: WorkerStub, Job: JobStub };
}

/** @qdrant/js-client-rest 替身: QdrantClient. */
export function createQdrantStub(): { QdrantClient: new (...args: any[]) => any } {
  class QdrantClientStub {
    constructor(..._args: any[]) {}

    async getCollections(): Promise<never> {
      return sdkStubCalled('@qdrant/js-client-rest', 'QdrantClient.getCollections');
    }

    async getCollection(): Promise<never> {
      return sdkStubCalled('@qdrant/js-client-rest', 'QdrantClient.getCollection');
    }

    async createCollection(): Promise<never> {
      return sdkStubCalled('@qdrant/js-client-rest', 'QdrantClient.createCollection');
    }

    async upsert(): Promise<never> {
      return sdkStubCalled('@qdrant/js-client-rest', 'QdrantClient.upsert');
    }

    async query(): Promise<never> {
      return sdkStubCalled('@qdrant/js-client-rest', 'QdrantClient.query');
    }

    async setPayload(): Promise<never> {
      return sdkStubCalled('@qdrant/js-client-rest', 'QdrantClient.setPayload');
    }

    async scroll(): Promise<never> {
      return sdkStubCalled('@qdrant/js-client-rest', 'QdrantClient.scroll');
    }

    async delete(): Promise<never> {
      return sdkStubCalled('@qdrant/js-client-rest', 'QdrantClient.delete');
    }

    async deleteCollection(): Promise<never> {
      return sdkStubCalled('@qdrant/js-client-rest', 'QdrantClient.deleteCollection');
    }
  }

  return { QdrantClient: QdrantClientStub };
}

/** @langchain/openai 替身: ChatOpenAI / OpenAIEmbeddings. */
export function createLangchainOpenAiStub(): { ChatOpenAI: new (...args: any[]) => any; OpenAIEmbeddings: new (...args: any[]) => any } {
  class ChatOpenAIStub {
    constructor(..._args: any[]) {}

    async invoke(): Promise<never> {
      return sdkStubCalled('@langchain/openai', 'ChatOpenAI.invoke');
    }

    async stream(): Promise<never> {
      return sdkStubCalled('@langchain/openai', 'ChatOpenAI.stream');
    }
  }

  class OpenAIEmbeddingsStub {
    constructor(..._args: any[]) {}

    async embedQuery(): Promise<never> {
      return sdkStubCalled('@langchain/openai', 'OpenAIEmbeddings.embedQuery');
    }

    async embedDocuments(): Promise<never> {
      return sdkStubCalled('@langchain/openai', 'OpenAIEmbeddings.embedDocuments');
    }
  }

  return { ChatOpenAI: ChatOpenAIStub, OpenAIEmbeddings: OpenAIEmbeddingsStub };
}

/** @langchain/core/messages 替身: 六种消息类. */
export function createLangchainMessagesStub(): Record<string, new (...args: any[]) => any> {
  class MessageStub {
    readonly content: unknown;

    constructor(content?: unknown) {
      this.content = content;
    }

    get text(): string {
      return typeof this.content === 'string' ? this.content : '';
    }
  }

  return {
    BaseMessage: MessageStub,
    HumanMessage: MessageStub,
    SystemMessage: MessageStub,
    AIMessage: MessageStub,
    AIMessageChunk: MessageStub,
    ToolMessage: MessageStub,
  };
}
