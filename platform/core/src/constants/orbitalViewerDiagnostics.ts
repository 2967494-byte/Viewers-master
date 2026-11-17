/** Bounded metadata only. Never retain image buffers, DOM nodes, URLs or clinical data. */
export const DIAGNOSTIC_EVENT_LIMIT = 40;
export const DIAGNOSTIC_BODY_LIMIT = 24 * 1024;
export const DIAGNOSTIC_TYPES = ['start', 'ready', 'error', 'texture-allocate', 'texture-free',
  'mode', 'filter', 'panorama', 'layout', 'tool', 'visibility', 'peer-count', 'fetch-error',
  'decode-error', 'index', 'memory', 'long-task', 'allocation-error', 'context-restored'] as const;
export const DIAGNOSTIC_VALUES = ['normal', 'manual', 'error', 'auto', 'economy', 'compatibility', 'quality',
  'diagnostic', 'none', 'smooth', 'sharpen', 'unsharp', 'idle', 'drawing', 'detecting', 'review', 'auto-error',
  'grid', 'mpr-coronal', 'mpr-sagittal', 'mpr-axial', 'mpr-3d', 'navigate', 'pan', 'magnify', 'length2d',
  'length3d', 'tape-line', 'tape-curve', 'angle2d', 'angle3d', 'canal', 'implant', 'visible', 'hidden',
  'pagehide', 'freeze', 'resume', 'discarded', 'automatic', 'volume', 'start', 'ready', 'failed', 'webgl2-unavailable',
  'texture-unavailable', 'startup-error', 'graphics-error', 'context-lost', 'access-or-index-error',
  'index-load-error', 'slice-load-failed'] as const;
type EventType = typeof DIAGNOSTIC_TYPES[number];
type Fields = { value?: string; bytes?: number; durationMs?: number; width?: number; height?: number; depth?: number; count?: number; code?: number };
export type DiagnosticEvent = Fields & { atMs: number; type: EventType };
const MAX_COUNTER = 1024 ** 4;
const number = (v: number, max = MAX_COUNTER) => Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0;
const increment = (v: number, by = 1) => number(v + by);

export class ViewerDiagnostics {
  private start: number;
  private events: DiagnosticEvent[] = [];
  private handles = new WeakMap<object, number>();
  private canvases = new Map<string, number>();
  private total = 0;
  private failed = false;
  readonly resources = { textures: 0, textureBytes: 0, texturePeakBytes: 0, sourceBytes: 0,
    canvasPixels: 0, allocations: 0, releases: 0 };
  readonly work = { fetches: 0, fetchBytes: 0, fetchMs: 0, fetchFailures: 0, decodes: 0, decodeMs: 0, decodeFailures: 0 };
  readonly render = { draws: 0, drawMs: null as number | null, longTasks: null as number | null, longestTaskMs: null as number | null };
  readonly transport = { posts: 0, bodyBytes: 0, failures: 0 };
  memory: { bytes: number; atMs: number } | null = null;
  visible = true;
  peerViewers = 1;
  browserProfileId: string | null = null;
  hardwareThreads: number | null = null;
  constructor(private now = () => performance.now(), readonly manual = false) {
    this.start = now();
    this.event('start', { value: manual ? 'manual' : 'normal' });
  }
  event(type: EventType, fields: Fields = {}) {
    if (!DIAGNOSTIC_TYPES.includes(type)) return;
    const entry: DiagnosticEvent = { atMs: number(this.now() - this.start, 86400000), type };
    if (fields.value && DIAGNOSTIC_VALUES.includes(fields.value as any)) entry.value = fields.value;
    for (const key of ['bytes', 'durationMs', 'width', 'height', 'depth', 'count', 'code'] as const) {
      if (typeof fields[key] === 'number' && Number.isFinite(fields[key])) entry[key] = number(fields[key]);
    }
    this.total = increment(this.total);
    if (type === 'error') this.failed = true;
    // Consecutive changes of the same control coalesce; no pointer coordinates or per-slice events.
    const previous = this.events[this.events.length - 1];
    if (['tool', 'layout', 'filter', 'panorama'].includes(type) && previous?.type === type &&
        previous.value === entry.value && entry.atMs - previous.atMs < 1000) return;
    this.events.push(entry);
    if (this.events.length > DIAGNOSTIC_EVENT_LIMIT) this.events.shift();
  }
  allocate(handle: object, bytes: number, sourceBytes: number, dims: number[]) {
    if (!handle || typeof handle !== 'object') return;
    const previous = this.handles.get(handle);
    const size = number(bytes, 16 * 1024 ** 3);
    this.handles.set(handle, size);
    this.resources.textures += previous === undefined ? 1 : 0;
    this.resources.textureBytes = number(this.resources.textureBytes - (previous || 0) + size);
    this.resources.texturePeakBytes = Math.max(this.resources.texturePeakBytes, this.resources.textureBytes);
    this.resources.sourceBytes = Math.max(this.resources.sourceBytes, number(sourceBytes));
    this.resources.allocations = increment(this.resources.allocations);
    this.event('texture-allocate', { bytes: size, width: dims[0], height: dims[1], depth: dims[2] });
  }
  release(handle: object) {
    const size = handle && typeof handle === 'object' ? this.handles.get(handle) : undefined;
    if (size === undefined) return;
    this.handles.delete(handle);
    this.resources.textures = Math.max(0, this.resources.textures - 1);
    this.resources.textureBytes = Math.max(0, this.resources.textureBytes - size);
    this.resources.releases = increment(this.resources.releases);
    this.event('texture-free', { bytes: size });
  }
  network(bytes: number, elapsed: number, ok: boolean) {
    this.work.fetches = increment(this.work.fetches);
    this.work.fetchBytes = increment(this.work.fetchBytes, bytes);
    this.work.fetchMs = increment(this.work.fetchMs, elapsed);
    if (!ok) { this.work.fetchFailures = increment(this.work.fetchFailures); this.event('fetch-error'); }
  }
  decode(elapsed: number, ok: boolean) {
    this.work.decodes = increment(this.work.decodes);
    this.work.decodeMs = increment(this.work.decodeMs, elapsed);
    if (!ok) { this.work.decodeFailures = increment(this.work.decodeFailures); this.event('decode-error'); }
  }
  draw(id: string, width: number, height: number, elapsed?: number) {
    if (!['mpr-coronal', 'mpr-sagittal', 'mpr-axial', 'mpr-3d'].includes(id)) return;
    this.render.draws = increment(this.render.draws);
    if (this.manual && elapsed != null) this.render.drawMs = increment(this.render.drawMs || 0, elapsed);
    const pixels = number(width, 65536) * number(height, 65536);
    const previous = this.canvases.get(id) || 0;
    if (pixels !== previous) {
      this.canvases.set(id, pixels);
      this.resources.canvasPixels += pixels - previous;
    }
  }
  longTask(duration: number) {
    if (!this.manual) return;
    this.render.longTasks = increment(this.render.longTasks || 0);
    this.render.longestTaskMs = Math.max(this.render.longestTaskMs || 0, number(duration));
    if (duration >= 250) this.event('long-task', { durationMs: duration });
  }
  sampleMemory(bytes: number) {
    if (!this.manual || !Number.isFinite(bytes) || bytes < 0) return;
    this.memory = { bytes: number(bytes), atMs: number(this.now() - this.start, 86400000) };
    this.event('memory', { bytes });
  }
  snapshot() {
    const detailed = this.manual || this.failed;
    return { version: 1, level: detailed ? 'detailed' : 'basic', reason: this.failed ? 'error' : this.manual ? 'manual' : 'normal',
      browserProfileId: this.browserProfileId, hardwareThreads: this.hardwareThreads, visible: this.visible,
      peerViewers: this.peerViewers, eventsTotal: this.total,
      resources: { ...this.resources }, work: { ...this.work }, render: { ...this.render }, transport: { ...this.transport },
      memory: this.memory ? { ...this.memory } : null, events: detailed ? this.events.map(event => ({ ...event })) : [] };
  }
}

let active: ViewerDiagnostics | null = null;
export const getViewerDiagnostics = () => active;
export const setViewerDiagnostics = (value: ViewerDiagnostics | null) => { active = value; };
// Hooks are optional: instrumentation failures must not escape into the image/renderer pipeline.
export function recordViewerEvent(type: EventType, fields?: Fields) { try { active?.event(type, fields); } catch { /* optional */ } }
export function recordViewerTexture(handle: object, bytes: number, sourceBytes: number, dims: number[]) { try { active?.allocate(handle, bytes, sourceBytes, dims); } catch { /* optional */ } }
export function releaseViewerTexture(handle: object) { try { active?.release(handle); } catch { /* optional */ } }
export function recordViewerNetwork(bytes: number, ms: number, ok: boolean) { try { active?.network(bytes, ms, ok); } catch { /* optional */ } }
export function recordViewerDecode(ms: number, ok: boolean) { try { active?.decode(ms, ok); } catch { /* optional */ } }
export function recordViewerDraw(id: string, w: number, h: number, ms?: number) { try { active?.draw(id, w, h, ms); } catch { /* optional */ } }
