import { ViewerDiagnostics, recordViewerEvent } from './orbitalViewerDiagnostics';

/** Browser facilities stay out of the collector and are cleaned up with the reporting session. */
export function startDiagnosticRuntime(collector: ViewerDiagnostics, runId: string, heartbeat: () => void) {
  const disposers: (() => void)[] = [];
  const peers = new Map<string, number>();
  let stopped = false;
  let measuring = false;
  let memoryAt = 0;
  let channel: BroadcastChannel | undefined;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  collector.visible = document.visibilityState !== 'hidden';
  collector.hardwareThreads = navigator.hardwareConcurrency > 0 ? Math.min(256, navigator.hardwareConcurrency) : null;
  try {
    const key = 'orbital:diagnostics:browser-profile:v1';
    let id = localStorage.getItem(key);
    if (!uuid.test(id || '')) { id = runId; localStorage.setItem(key, id); }
    collector.browserProfileId = id;
  } catch { /* Disabled storage is supported. */ }
  const listen = (target: EventTarget, name: string, callback: EventListener) => {
    target.addEventListener(name, callback); disposers.push(() => target.removeEventListener(name, callback));
  };
  const refreshPeers = () => {
    const now = Date.now();
    peers.forEach((at, id) => { if (now - at > 180000) peers.delete(id); });
    const count = Math.min(64, peers.size + 1);
    if (collector.peerViewers !== count) { collector.peerViewers = count; collector.event('peer-count', { count }); }
  };
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('orbital-viewer-diagnostics-v1');
      channel.onmessage = event => {
        const { id, kind } = event.data || {};
        if (typeof id !== 'string' || !uuid.test(id) || id === runId || !['hello', 'alive', 'bye'].includes(kind)) return;
        if (kind === 'bye') peers.delete(id);
        else if (peers.size < 63 || peers.has(id)) peers.set(id, Date.now());
        refreshPeers();
        if (kind === 'hello') channel?.postMessage({ id: runId, kind: 'alive' });
      };
      channel.postMessage({ id: runId, kind: 'hello' });
    }
  } catch { channel = undefined; }
  const visibility = () => {
    collector.visible = document.visibilityState !== 'hidden';
    collector.event('visibility', { value: collector.visible ? 'visible' : 'hidden' });
  };
  listen(document, 'visibilitychange', visibility);
  listen(document, 'freeze', () => collector.event('visibility', { value: 'freeze' }));
  listen(document, 'resume', () => collector.event('visibility', { value: 'resume' }));
  if ((document as any).wasDiscarded) collector.event('visibility', { value: 'discarded' });
  listen(window, 'orbital:dental-tool-changed', ((event: CustomEvent) => {
    const value = { tapeLine: 'tape-line', tapeCurve: 'tape-curve' }[event.detail?.tool] || event.detail?.tool;
    recordViewerEvent('tool', { value });
  }) as EventListener);
  let observer: PerformanceObserver | undefined;
  if (collector.manual) {
    try {
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        collector.render.longTasks = 0; collector.render.longestTaskMs = 0;
        observer = new PerformanceObserver(list => { list.getEntries().forEach(entry => collector.longTask(entry.duration)); });
        observer.observe({ entryTypes: ['longtask'] });
      }
    } catch { observer?.disconnect(); }
  }
  const tick = () => {
    if (stopped) return;
    try { channel?.postMessage({ id: runId, kind: 'alive' }); } catch { /* optional */ }
    refreshPeers();
    if (!collector.visible) return;
    heartbeat();
    // Expensive, implementation-specific memory measurement is explicit opt-in only.
    // At most once per five minutes, never awaited by loading or rendering.
    const memory = (performance as any).measureUserAgentSpecificMemory;
    if (collector.manual && !measuring && typeof memory === 'function' && (window as any).crossOriginIsolated && Date.now() - memoryAt >= 300000) {
      measuring = true; memoryAt = Date.now();
      try {
        Promise.resolve(memory.call(performance)).then(value => {
          if (!stopped && typeof value?.bytes === 'number') collector.sampleMemory(value.bytes);
        }).catch(() => {}).finally(() => { measuring = false; });
      } catch { measuring = false; }
    }
  };
  const timer = setInterval(tick, 60000);
  return () => {
    stopped = true; clearInterval(timer); observer?.disconnect(); disposers.forEach(dispose => dispose());
    try { channel?.postMessage({ id: runId, kind: 'bye' }); channel?.close(); } catch { /* optional */ }
  };
}
