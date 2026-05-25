/**
 * 简单的 FIFO 任务队列。
 * 所有 run() 进来的任务串行执行,前一个 settle 之后才启动下一个。
 * 任务抛错不影响后续任务,但调用方仍能拿到 reject。
 */
export class TaskQueue {
  private chain: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(() => task());
    // 后续任务不应被前一个的失败阻塞
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
