import React, { useEffect, useState } from 'react';
import { reconstructSection } from './reconstruction';
import RasterView from './RasterView';

/** Coalesce input at display cadence; retain the last real frame until its replacement is ready. */
export default function LivePanoramaSection({ seed, curve, up, sample, heightMm, distance, tilt = 0, range, editing, label, sliceOffset = 0, onPosition, crossVisible = true }) {
  const [frame, setFrame] = useState(() => ({ ...seed, tilt: 0, curve, up, sample, heightMm }));
  const [error, setError] = useState('');
  useEffect(() => {
    if (editing || (frame?.raster && frame.curve === curve && frame.up === up && frame.sample === sample &&
        frame.heightMm === heightMm && frame.tilt === tilt && Math.abs(frame.distance - distance) < 1e-6)) return;
    const request = requestAnimationFrame(() => {
      try {
        const raster = reconstructSection({ curve, up, sample, heightMm, distance, tilt });
        if (raster) { setFrame({ raster, distance, tilt, curve, up, sample, heightMm }); setError(''); }
      } catch (e) { setError(e.message); }
    });
    return () => cancelAnimationFrame(request);
  }, [curve, up, sample, heightMm, distance, tilt, editing]);
  return <>
    {frame?.raster && <RasterView axesVisible={crossVisible} raster={frame.raster} range={range} label={label} position={crossVisible ? 0.5 : undefined}
      slicePosition={crossVisible ? 0.5 - sliceOffset / (frame.raster.heightMm * Math.cos((frame.tilt || 0) * Math.PI / 180)) : undefined}
      onPosition={onPosition} />}
    {error && <div className="manual-section-live-error" role="alert">{error}</div>}
  </>;
}
