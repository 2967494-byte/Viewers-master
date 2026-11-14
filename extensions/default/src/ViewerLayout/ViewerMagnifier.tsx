import React, { useEffect, useRef, useState } from 'react';
import { Enums } from '@cornerstonejs/core';
import { normalizeMagnification } from '@ohif/core/src/constants/orbitalTheme';
import { magnifierCrop } from './magnifierGeometry';
import './ViewerMagnifier.css';

const DIAMETER = 220;

/** One small canvas magnifies the displayed image; no extra volume, decoding or server requests. */
export default function ViewerMagnifier() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [magnification, setMagnification] = useState(3);
  useEffect(() => {
    let enabled = false;
    let zoom = 3;
    let frame = 0;
    let current: { source: HTMLCanvasElement; x: number; y: number } = null;
    const hide = () => {
      current = null;
      cancelAnimationFrame(frame);
      frame = 0;
      if (root.current) root.current.hidden = true;
    };
    const draw = () => {
      frame = 0;
      if (!enabled || !current || !current.source.isConnected) return hide();
      const { source, x, y } = current;
      const crop = magnifierCrop(source, source.getBoundingClientRect(), { x, y }, zoom,
        DIAMETER, getComputedStyle(source).objectFit === 'contain');
      if (!crop || !canvas.current || !root.current) return hide();
      const target = canvas.current;
      const resolution = Math.round(DIAMETER * Math.min(window.devicePixelRatio || 1, 2));
      if (target.width !== resolution || target.height !== resolution) {
        target.width = target.height = resolution;
      }
      const context = target.getContext('2d');
      if (!context) return hide();
      context.fillStyle = '#000';
      context.fillRect(0, 0, resolution, resolution);
      // drawImage clips source rectangles at image edges; the uncovered area stays black.
      context.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, resolution, resolution);
      const left = x + DIAMETER + 24 < window.innerWidth ? x + 24 : x - DIAMETER - 24;
      const top = y + DIAMETER + 24 < window.innerHeight ? y + 24 : y - DIAMETER - 24;
      root.current.style.left = `${Math.max(8, Math.min(left, window.innerWidth - DIAMETER - 8))}px`;
      root.current.style.top = `${Math.max(8, Math.min(top, window.innerHeight - DIAMETER - 8))}px`;
      root.current.hidden = false;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const move = (event: PointerEvent) => {
      if (!enabled) return;
      const target = event.target as Element;
      if (!(target instanceof Element) || target.closest('button,input,select,textarea') || event.buttons > 1)
        return hide();
      const wrapper = target.closest('.viewport-wrapper, .manual-panel');
      const source = wrapper?.querySelector<HTMLCanvasElement>(
        '.automatic-panorama-pane .manual-raster, canvas.cornerstone-canvas, canvas.manual-raster'
      );
      // Prefer the visible panorama over the 3D canvas it covers.
      const panorama = wrapper?.querySelector<HTMLCanvasElement>('.automatic-panorama-pane .manual-raster');
      const visible = panorama?.getBoundingClientRect().height ? panorama : source;
      if (!visible) return hide();
      current = { source: visible, x: event.clientX, y: event.clientY };
      schedule();
    };
    const changed = (event: CustomEvent) => {
      hide();
      enabled = event.detail.tool === 'magnify';
      zoom = normalizeMagnification(event.detail.magnification);
      setMagnification(zoom);
    };
    const imageRendered = (event: Event) => {
      if (current && (event.target as Element)?.contains(current.source)) schedule();
    };
    document.addEventListener('pointermove', move, true);
    document.documentElement.addEventListener('pointerleave', hide);
    document.addEventListener(Enums.Events.IMAGE_RENDERED, imageRendered, true);
    window.addEventListener('orbital:dental-tool-changed', changed);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    return () => {
      hide();
      document.removeEventListener('pointermove', move, true);
      document.documentElement.removeEventListener('pointerleave', hide);
      document.removeEventListener(Enums.Events.IMAGE_RENDERED, imageRendered, true);
      window.removeEventListener('orbital:dental-tool-changed', changed);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
    };
  }, []);
  return (
    <div ref={root} className="orbital-magnifier" hidden role="img" aria-label={`Лупа, увеличение ${magnification}×`}>
      <canvas ref={canvas} />
      <span>{magnification}×</span>
    </div>
  );
}
