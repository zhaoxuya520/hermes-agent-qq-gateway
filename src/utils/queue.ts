export class SerialTaskQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();

    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.tails.set(key, tail);

    tail.finally(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });

    return result;
  }
}

export class ExpiringSet {
  private readonly values = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  has(key: string): boolean {
    this.prune();
    const expiresAt = this.values.get(key);
    return expiresAt !== undefined && expiresAt > Date.now();
  }

  add(key: string): void {
    this.prune();
    this.values.set(key, Date.now() + this.ttlMs);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.values.entries()) {
      if (expiresAt <= now) {
        this.values.delete(key);
      }
    }
  }
}
