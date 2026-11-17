import React, { useEffect, useRef, useState } from 'react';

/** Screen-space translation moves the image and its coordinate markers together. */
export default function SectionImageSurface({ zoom, enabled, children }) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const end = () => { drag.current = null; setDragging(false); };
  useEffect(() => { if (!enabled) end(); }, [enabled]);
  useEffect(() => {
    window.addEventListener('blur', end);
    return () => window.removeEventListener('blur', end);
  }, []);
  return <div className="manual-section-surface" aria-label="Область изображения поперечного сечения"
    style={{ cursor: enabled ? dragging ? 'grabbing' : 'grab' : undefined }}
    onClickCapture={event => { if (enabled) { event.preventDefault(); event.stopPropagation(); } }}
    onPointerDown={event => {
      if (!enabled || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan };
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      setPan({ x: start.pan.x + event.clientX - start.x, y: start.pan.y + event.clientY - start.y });
    }}
    onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      end();
    }}
    onPointerCancel={end} onLostPointerCapture={end}>
    <div className="manual-section-raster" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>{children}</div>
  </div>;
}
