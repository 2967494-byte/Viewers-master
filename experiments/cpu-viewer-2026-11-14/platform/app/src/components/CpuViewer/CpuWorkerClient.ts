export class CpuWorkerClient {
  private worker = new Worker(new URL('./cpu.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      progress?: (value: number) => void;
    }
  >();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const item = this.pending.get(data.id);
      if (!item) return;
      if (data.progress !== undefined) {
        item.progress?.(data.progress);
        return;
      }
      this.pending.delete(data.id);
      if (data.error)
        item.reject(
          data.error === 'cancelled'
            ? new DOMException('Cancelled', 'AbortError')
            : new Error(data.error)
        );
      else item.resolve(data.result);
    };
    this.worker.onerror = () => {
      this.fail(
        new Error(
          'Не удалось запустить фоновый CPU-расчёт. Обновите браузер и откройте исследование заново.'
        )
      );
    };
  }
  request<T = any>(
    kind: string,
    payload: any,
    transfer: Transferable[] = [],
    progress?: (value: number) => void
  ): Promise<T> {
    if (this.closed) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject, progress });
      try {
        this.worker.postMessage({ id, kind, payload }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private fail(error: Error) {
    this.closed = true;
    this.worker.terminate();
    this.pending.forEach(item => item.reject(error));
    this.pending.clear();
  }
  close() {
    this.fail(new DOMException('Cancelled', 'AbortError'));
  }
}
