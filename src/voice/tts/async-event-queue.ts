// V2026-10-23 治本 (异步事件队列 — TTS 事件流的通用载体):
//   原因: TTS 客户端要把"协议帧"翻译成"业务事件"再交给上层消费, 而上层要的是
//     `for await (const e of handle.events)` 这种**顺序流**写法 (与 LlmStream 一致).
//     旧实现用 EventEmitter + 手写 wait/notify 包装成 AsyncIterable, 逻辑绕且有丢事件风险
//     (事件在"取空队列"与"挂上等待者"之间到达就会永久挂死).
//   修法: 本文件是**可复用**的单向队列 + 异步迭代器, 唯一职责是把"push 来的事件"
//     安全地按序交付给消费者, 并在 close() 后自然结束迭代.
//   反双胞胎:
//     - 不用 EventEmitter: 事件源是**单生产者**(WS 协议回调), 没有多播需求;
//       EventEmitter 只会带来"谁在监听"的隐式耦合
//     - 不用 RxJS Subject: 与仓库其它流 (LlmStream) 风格不一致, 且引入额外心智负担
//   验证:
//     1. tsc 0 错
//     2. push 后消费者立刻拿到; close 后迭代结束
//   时间戳: 2026-10-23

/**
 * 单向异步事件队列.
 *
 * 语义:
 * - `push` 把事件放进队列并唤醒等待中的消费者
 * - `close` 之后, 队列里**已入队的事件仍会被交付完**, 之后迭代结束
 * - 迭代器天然支持"消费者提前 break"(如 barge-in 后不再转发)
 */
export class AsyncEventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: (() => void)[] = [];
  private closed = false;

  /** 队列是否已关闭. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** 当前排队事件数 (诊断用). */
  get size(): number {
    return this.items.length;
  }

  /**
   * 投递事件 (支持一次投多个, 按参数顺序入队).
   *
   * V2026-10-23 治本 (lint --fix 合并连续调用 → API 必须是变参):
   *   背景: 本仓 eslint 预设里开着 `unicorn/prefer-single-call` —— 它会把**连续两次
   *     同方法调用**合并成一次多参调用 (`push(a); push(b);` → `push(a, b)`), 且 `lint --fix`
   *     会**自动**改写. 若 `push` 只收一个参数, 就会出现:
   *       ① 我写成两行 → lint --fix 合回一行 → ② TS2554 (Expected 1 arguments, but got 2)
   *   即 "写对也被工具改错", 只能反复改回来.
   *   修法: 队列 API 本身设计成**变参** (`push(...items: T[])`) —— 一次投多个事件
   *     语义完全成立 (FIFO 按参数顺序入队), 于是 lint --fix 的合并结果天然合法,
   *     不再和类型系统打架.
   *   反双胞胎:
   *     - 不用 `// eslint-disable-next-line unicorn/prefer-single-call` 压规则:
   *       下次加一行又得再压一次, 而变参 API 一次到位
   *     - 不为了躲规则把两个不同语义的事件塞进一次调用: 顺序仍是契约 (见调用点注释)
   *
   * @param items 事件 (按序入队)
   */
  push(...items: T[]): void {
    if (this.closed) return;
    this.items.push(...items);
    this.wake();
  }

  /** 关闭队列 (消费者会在排空后结束迭代). */
  close(): void {
    this.closed = true;
    this.wake();
  }

  /**
   * 异步迭代器 — 按序交付所有事件.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      const item = this.items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.closed) {
        return;
      }
      await this.waitForItem();
    }
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 等待下一个事件 (挂起当前消费者).
   *
   * 关键: 挂起前**再查一次队列** —— 否则"事件恰好在取空与挂起之间到达"会被永久吞掉.
   */
  private waitForItem(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      if (this.items.length > 0 || this.closed) {
        this.wake();
      }
    });
  }

  /** 唤醒所有等待者. */
  private wake(): void {
    const pending = this.waiters.splice(0);
    for (const waiter of pending) {
      waiter();
    }
  }
}
