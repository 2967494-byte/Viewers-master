/** One recovery incident per viewer lifetime, including a pool losing several contexts together. */
export class GraphicsContextRecovery {
  private used = false;
  private terminal = false;
  private lost = new Set<object>();
  private canvases = new Set<object>();
  private frames = new Set<string>();
  private expected: string[] = [];
  private timer: ReturnType<typeof setTimeout>;
  phase: 'idle' | 'waiting' | 'rebuilding' = 'idle';
  constructor(private hooks: {
    alive: (canvas: object) => boolean;
    phase: (phase: 'idle' | 'waiting' | 'rebuilding') => void;
    started: () => void;
    rebuild: () => string[];
    completed: () => void;
    cancelled?: () => void;
    failed: (code: number) => void;
  }, private timeout = 15000) {}
  lose(canvas: object) {
    if (!this.hooks.alive(canvas) || this.terminal) return;
    if (this.phase === 'waiting') { this.lost.add(canvas); this.canvases.add(canvas); return; }
    if (this.used) { this.fail(20002); return; }
    this.used = true;
    this.lost.add(canvas);
    this.canvases.add(canvas);
    this.phase = 'waiting';
    this.hooks.phase(this.phase);
    this.hooks.started();
    this.timer = setTimeout(() => { if (!this.cancelIfDisposed()) this.fail(20003); }, this.timeout);
  }
  restore(canvas: object) {
    if (this.phase !== 'waiting' || !this.lost.delete(canvas)) return;
    // VTK's own restored listener releases its render passes first.
    queueMicrotask(() => {
      if (this.phase !== 'waiting' || this.lost.size || this.terminal) return;
      if (this.cancelIfDisposed()) return;
      try {
        this.phase = 'rebuilding';
        this.hooks.phase(this.phase);
        this.expected = this.hooks.rebuild();
        if (!this.expected.length) this.fail(20004);
      } catch { this.fail(20005); }
    });
  }
  frame(id: string) {
    if (this.phase !== 'rebuilding' || !this.expected.includes(id)) return;
    this.frames.add(id);
    if (this.expected.every(key => this.frames.has(key))) {
      clearTimeout(this.timer);
      this.phase = 'idle';
      this.canvases.clear();
      this.hooks.completed();
      this.hooks.phase(this.phase);
    }
  }
  private cancelIfDisposed() {
    if ([...this.canvases].some(canvas => this.hooks.alive(canvas))) return false;
    clearTimeout(this.timer);
    this.canvases.clear(); this.lost.clear();
    this.phase = 'idle';
    this.hooks.cancelled?.(); this.hooks.phase(this.phase);
    return true;
  }
  fail(code: number) {
    if (this.terminal) return;
    clearTimeout(this.timer);
    this.terminal = true;
    this.canvases.clear(); this.lost.clear();
    this.hooks.failed(code);
    this.phase = 'idle';
    this.hooks.phase(this.phase);
  }
}
