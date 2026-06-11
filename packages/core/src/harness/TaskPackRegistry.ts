import type { TaskKind, TaskPack } from './types.js';

export class TaskPackRegistry {
  private readonly packs = new Map<TaskKind, TaskPack>();

  register(pack: TaskPack): void {
    if (this.packs.has(pack.kind)) {
      throw new Error(`Task pack already registered: ${pack.kind}`);
    }
    this.packs.set(pack.kind, pack);
  }

  get(kind: TaskKind): TaskPack {
    const pack = this.packs.get(kind);
    if (!pack) {
      throw new Error(`Task pack not registered: ${kind}`);
    }
    return pack;
  }

  has(kind: TaskKind): boolean {
    return this.packs.has(kind);
  }

  list(): TaskPack[] {
    return Array.from(this.packs.values());
  }
}
