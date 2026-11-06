// V2026-09-12 fix (LLM/qdrant 包卸载): 包已删, runtime 需 stub 让 onModuleInit 不 crash.
//   用 eslint-disable 区块精准豁免声明, 等真接 LLM 时再去掉.

// V2026-09-14 治本 (V6.0 §12.2 + 后端工程标准):
//   原因: V2026-09-12 治本加 `// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment`
//         想压 lint — 但 typescript-eslint 压不住 TS 编译器错 (TS-prefix 是 tsc 报的).
//         旧 stub class `getCollection()` 返回 `Promise<unknown>` → `info` 是 unknown
//         → `info.config?.params?.vectors?.size` 报 TS18046. `query()` 返回
//         `{ points: unknown[] }` → `points.map((p) => ...)` 里 `p.id / p.score /
//         p.payload` 报 3 个 TS18046.
//
//   修复: 定义 QdrantCollectionInfo / QdrantPoint 接口, 让 stub QdrantClient 类
//         的方法签名返回具体类型 (替代 unknown). 调用方访问 `info.config?...`
//         `points.map((p) => ...)` 都自动 narrow, tsc 干净.
//   如何验证 (用户手动跑):
//     1. 删 QdrantCollectionInfo / QdrantPoint 接口 → tsc 报 4 个 TS18046.
//     2. 保留接口 + stub 方法签名 → 上述错全部消除.
//   Fallback: 后续 qdrant-js-client-rest API 变 → 调整两个 interface,
//             provider 代码无需动.

// V2026-10-14 治本 (VS-3b — 装包 + 删 Qdrant stub, 跟 VS-3a LangChain stub 同 pattern):
//   原因: V0.5 (V2026-09-12 卸 @qdrant/js-client-rest) 装 stub QdrantClient + 2 个 interface
//     (QdrantCollectionInfo + QdrantPoint) 临时治本, 装包前调抛 [Stub] Error 跟 LangChain
//     一样. 跟 VS-3a 同 pattern, 装包后删 stub + 改 import 真 SDK.
//   修法: 删 2 个 stub interface (QdrantCollectionInfo + QdrantPoint) + stub QdrantClient
//     class (74 行), 改 import 真 @qdrant/js-client-rest. provider 业务代码 0 改动
//     (V0.5 stub 跟真实 SDK 调用面 1:1 兼容, 跟 LangChain stub 治本注释一致).
//   反双胞胎: 跟 LangChain 一样不在 provider 写 try/catch fallback, 装包后真接 SDK.
//   验证 (大炮装包后跑):
//     1. pnpm add @qdrant/js-client-rest (装包命令见 src/llm/README.md)
//     2. pnpm build 0 错 + npx tsc -p tsconfig.build.json --noEmit 0 错 (用 client: any 避开 TS 严格检查)
//     3. 启动后 Qdrant 容器跑起来 (大炮跑 docker compose --profile rag up -d), 调
//        ensureCollection 创 collection 成功.
//   时间戳: 2026-10-14 11:59.

// V2026-09-04 治本 (V6.0 §3.5 + §12 RAG):
//   Qdrant 向量库 wrapper — 心塑知识库 (§3.2 科普 + §3.5 高阶层对话).
//   关键反双胞胎:
//     - 不复用 moyin-ai-core 桌面端 qdrant.exe 启动逻辑 (那是 Electron 进程).
//     - 服务端是 Qdrant 远程服务 (容器化), 走 @qdrant/js-client-rest HTTP API.
//     - 不写 Embedding 调用 — 用 LangChain OpenAIEmbeddings + QdrantVectorStore.
//   如何验证:
//     1. Qdrant 容器跑起来 (docker run -p 6333:6333 qdrant/qdrant).
//     2. POST /ai/knowledge/articles { content, tags } → 向量化 + 写入 collection.
//     3. POST /v1/chat/completions tier=rag → 检索 top 5 → stream 给 LLM.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// V2026-10-14 治本 (VS-3b — 装包后改 import 真 @qdrant/js-client-rest, 跟 VS-3a LangChain 同 pattern):
//   原因: V0.5 装 stub QdrantClient (line 47-96 删), 装包后改 import 真 SDK.
//   修法: 1 行 import 路径. V0.5 stub interface 删, stub class 删. provider 业务代码 0 改动
//     (V0.5 跟真实 SDK 调用面 1:1 兼容, 跟 LangChain stub 治本注释一致).
//   时间戳: 2026-10-14 11:59.
import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';

/**
 * Qdrant 向量库服务.
 *
 * 大厂 standard:
 *   - 服务端 ≠ 客户端: Qdrant 远程, 走 HTTP API.
 *   - collection 按知识库类型分 (psychology_articles / practice_plans /
 *     crisis_resources / user_journals), 不混.
 *   - 向量维度跟 embedding 模型对齐 (默认 1536 = OpenAI text-embedding-3-small).
 *   - upsert 用 point_id = 文章 id (VARCHAR) — 幂等.
 */
@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  /**
   * Qdrant 客户端 (真 SDK 类型).
   *
   * V2026-11-05 治本 (WP45 · P3-1): 原来是 `private client: any` + 文件级 eslint-disable
   *   —— 代价是**整个文件对类型系统隐形**, 而且真出过事故: `setPayload` 按 v0.x 的
   *   三参形状调 (`setPayload(collection, id, payload)`), 而真 SDK v1.19 是
   *   **两参** `setPayload(collection, { payload, points })` —— 运行时把第 2 参的
   *   字符串 id 解构成全 undefined, 第 3 参被整个忽略 → 请求打过去必被 Qdrant 拒.
   *   `any` 让这件事在编译期**完全隐形**, 直到今天才被发现 (见下方 setPayload).
   *
   * 现在用真类型: 编译期就能挡住"SDK 契约对不上"这类错误.
   */
  private client!: QdrantClient;
  private readonly defaultVectorSize = 1536;

  constructor(private readonly config: ConfigService) {}

  /**
   * V2026-09-04 治本: 初始化 Qdrant 客户端 + 探活.
   * 连不上不抛 (知识库是 V3 增强功能, V2.0 走 basic tier 也能跑).
   */
  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('QDRANT_URL') ?? 'http://localhost:6333';
    const apiKey = this.config.get<string>('QDRANT_API_KEY') ?? '';

    this.client = new QdrantClient({ url, apiKey: apiKey || undefined });

    try {
      const collections = await this.client.getCollections();
      this.logger.log(`Qdrant connected url=${url} collections=${collections.collections.length}`);
    } catch (e) {
      this.logger.warn(
        `Qdrant unreachable url=${url} — RAG knowledge base disabled (V2.0 fallback to basic tier). Error: ${(e as Error).message}`,
      );
    }
  }

  /**
   * 确保 collection 存在 — 维度跟 embedding 模型对齐.
   *
   * V2026-11-05 治本 (WP45 · P3-1): 原来靠 `client: any` + 一堆 `as` 绕过类型检查,
   *   现在直接用 SDK 的真类型 —— 维度从 `CollectionInfo.config.params.vectors` 里读,
   *   两种形状 (具名向量 map / 单个向量) 都有分支.
   */
  async ensureCollection(name: string, vectorSize = this.defaultVectorSize): Promise<void> {
    try {
      const info = await this.client.getCollection(name);
      const existingSize = readVectorSize(info);
      if (existingSize !== undefined && existingSize !== vectorSize) {
        throw new Error(
          `Collection ${name} vector size mismatch: existing=${existingSize}, requested=${vectorSize}. ` +
            `Use a new collection name or recreate.`,
        );
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('Not found') || msg.includes('404')) {
        await this.client.createCollection(name, {
          vectors: { size: vectorSize, distance: 'Cosine' },
        });
        this.logger.log(`Qdrant collection created name=${name} dim=${vectorSize}`);
      } else if (msg.includes('mismatch')) {
        throw e;
      } else {
        // 其它错误软降级 (V2 阶段 RAG 软失败).
        this.logger.warn(`ensureCollection ${name} skipped: ${msg}`);
      }
    }
  }

  /**
   * 写入向量 + payload — 单条.
   *
   * V2026-09-04 治本: point id 用字符串 (article id), upsert 幂等.
   * payload 存元数据 (tags / source / version) 用于过滤.
   */
  async upsert(collection: string, id: string, vector: number[], payload: Record<string, unknown>): Promise<void> {
    await this.ensureCollection(collection, vector.length);
    await this.client.upsert(collection, {
      points: [{ id, vector, payload }],
    });
  }

  /**
   * 批量写入 — 知识库批量导入用.
   */
  async upsertBatch(collection: string, items: { id: string; vector: number[]; payload: Record<string, unknown> }[]): Promise<void> {
    if (items.length === 0) return;
    await this.ensureCollection(collection, items[0].vector.length);
    await this.client.upsert(collection, { points: items });
  }

  /**
   * 检索 — Qdrant 1.x 用 query() API (统一 search/recommend/discover/filter).
   *
   * V2026-09-14 治本: `points` 类型从 unknown[] narrow 成 { id / score / payload }[] inline,
   *   p.id / p.score / p.payload 自动有类型, 不再需要 V0.5 stub QdrantPoint interface.
   *
   * @param collection collection 名
   * @param queryVector 查询向量 (已经过 embedding 模型)
   * @param topK 返回前 K 条
   * @param filter 可选 payload 过滤 (e.g. { tags: 'anxiety' })
   * @param scoreThreshold 分数阈值 (低于此过滤), 默认 0
   */
  async search(
    collection: string,

    queryVector: number[],
    topK = 5,
    filter?: Record<string, unknown>,
    scoreThreshold = 0,
  ): Promise<{ id: string; score: number; payload: Record<string, unknown> }[]> {
    const response = await this.client.query(collection, {
      query: queryVector,
      limit: topK,

      with_payload: true,
      filter,
      score_threshold: scoreThreshold,
    });

    const points = response.points ?? [];
    return points.map((p) => ({
      id: String(p.id),
      score: p.score ?? 0,
      payload: p.payload ?? {},
    }));
  }

  /**
   * 只改 payload, 不动向量 (V2026-10-30 治本 · WP12 · 补 WP2 写侧缺口).
   *
   * 为什么需要它: 长时记忆的**冲突消解**要求"给旧点打一个 `supersededBy` 标记",
   * 而那条旧点的向量一个字都不能动 —— 重新 upsert 一遍要重新算向量, 既慢又会
   * 引入"同一条记忆两次向量化"的抖动. setPayload 是 Qdrant 的原语, 正好干这件事.
   *
   * 反双胞胎: 不复用 `upsert` 改 payload —— 那会把向量一起覆盖, 且"改 payload"
   * 与"写新点"在语义上完全不是一回事 (前者是标注, 后者是新增).
   *
   * @param collection collection 名
   * @param id 点 id
   * @param payload 要合并进该点 payload 的字段
   *
   * ⚠️ **V2026-11-05 治本 (WP45 · P3-1 挖出来的真 bug)**:
   *   真 SDK v1.19 的 `setPayload` 是**两参** `setPayload(collection, { payload, points })`.
   *   本方法原来按 v0.x 的三参形状调 `this.client.setPayload(collection, id, payload)` ——
   *   SDK 运行时把第 2 参 (那个**字符串 id**) 解构成 `{payload, points, filter, ...}`,
   *   于是 payload / points 全是 undefined, 第 3 个参数**被整个忽略** → 请求打过去必被 Qdrant 拒.
   *   后果: WP12 的**冲突消解标记从未真正落库** → 内核 `recall-policy` 排除
   *   "已被取代的记忆"的那道判定 (supersededBy 非空就拒) 永远不生效 →
   *   **同主题的新旧两条矛盾记忆会一起被召回** (正是 WP12 要解决的问题).
   *   为什么一直没被发现: `private client: any` 让 TS 完全看不见这个错, 而单测用的
   *   窄端口替身也是三参形状 —— 两端自洽, 只有真 SDK 不认.
   *   现在按 SDK 的两参形状调, 并由 `test/base/wp45-qdrant-sdk-contract.spec.ts` 钉住.
   */
  async setPayload(collection: string, id: string, payload: Record<string, unknown>): Promise<void> {
    // ⚠️ SDK 契约 (v1.19): 第 2 参是**一个对象** (payload + points), 不是 (id, payload) 两个位置参数.
    //   原来按 v0.x 三参形状调 → SDK 把第 2 参 (那个字符串 id) 解构成全 undefined,
    //   第 3 参被整个忽略 → 请求必被 Qdrant 拒 (详见上方注释).
    await this.client.setPayload(collection, { payload, points: [id] });
  }

  /**
   * 按 filter 滚动取点 (V2026-10-30 治本 · WP12 · 补 WP2 写侧缺口).
   *
   * 为什么需要它: 写新记忆前要找出"同 tenant + 同 visitor + 同 topicKey"的旧记忆,
   * 才能做冲突消解. 用向量相似度反查**会漏召回** —— 语义相近不等于同主题,
   * 而同主题的两条可能措辞差异极大 (时间更新者优先, 跟措辞没关系). 滚动是
   * Qdrant 的"按 payload 过滤全量取"原语, 才是这个场景该用的工具.
   *
   * 反双胞胎: 不用 `search` 顶替 —— search 要向量, 且 topK 有限, 漏了就静默
   * 少标记一条冲突 (那种错在审计里最难发现).
   *
   * @param collection collection 名
   * @param filter payload 过滤条件 (Qdrant filter 形状)
   * @param limit 最多取多少点
   * @returns 点集 (id + payload)
   */
  async scroll(
    collection: string,
    filter: Record<string, unknown>,
    limit = 100,
  ): Promise<{ id: string; payload: Record<string, unknown> }[]> {
    const response = await this.client.scroll(collection, {
      filter,
      limit,
      with_payload: true,
      with_vector: false,
    });
    const points = response.points ?? [];
    return points.map((p) => ({
      id: String(p.id),
      payload: p.payload ?? {},
    }));
  }

  /**
   * 删除单条 — 用于文章下架 / GDPR 删除请求.
   */
  async delete(collection: string, id: string): Promise<void> {
    await this.client.delete(collection, { points: [id] });
  }

  /**
   * 删除 collection — 切 embedding 模型时全量重建用.
   */
  async deleteCollection(collection: string): Promise<void> {
    await this.client.deleteCollection(collection);
  }
}

/**
 * 读 collection 的向量维度.
 *
 * 两种形状都要认:
 *   · 单向量 (unnamed) → `vectors.size` 直接是 number;
 *   · 具名向量 (named map) → `vectors` 是 `{ 别名: { size, distance } }`, 取第一个的 size.
 *
 * @param info SDK 返回的 collection 信息
 * @returns 维度; 读不到 (没配向量 / 形状不认识) → undefined
 */
function readVectorSize(info: Schemas['CollectionInfo']): number | undefined {
  const vectors = info.config?.params?.vectors;
  if (!vectors) return undefined;
  const direct = vectors.size;
  // 单向量: `vectors.size` 直接是 number.
  if (typeof direct === 'number') return direct;
  // 具名向量 map: `vectors` 是 { 别名: { size, distance } } —— 取第一个具名向量的维度.
  if (direct && typeof direct.size === 'number') return direct.size;
  return undefined;
}
