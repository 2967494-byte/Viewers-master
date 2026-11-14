import React from 'react';

/** Header-owned control: its visibility must not depend on a viewport React ref. */
export default function DentalPanoramaButton({
  onClick,
  automatic = false,
}: {
  onClick: () => void;
  automatic?: boolean;
}) {
  return (
    <button
      type="button"
      className="manual-panorama-launcher dental-header-tool"
      aria-label={automatic ? 'Автоматическая панорама' : 'Панорама'}
      title={
        automatic
          ? 'Автоматически найти зубную дугу и построить панораму'
          : 'Построить панораму по точкам зубной дуги'
      }
      onClick={onClick}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 64,
        height: '100%',
        padding: 0,
        border: 0,
        borderLeft: '1px solid #30363e',
        borderRadius: 0,
        cursor: 'pointer',
      }}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 24C5 7 27 7 27 24 M2 22h6 M5 12l4 3 M16 6v7 M27 12l-4 3 M24 22h6" />
        <circle
          cx="5"
          cy="24"
          r="1.6"
          fill="currentColor"
          stroke="none"
        />
        <circle
          cx="16"
          cy="11.25"
          r="1.6"
          fill="currentColor"
          stroke="none"
        />
        <circle
          cx="27"
          cy="24"
          r="1.6"
          fill="currentColor"
          stroke="none"
        />
        {automatic && (
          <path
            d="M25 2v8 M21 6h8 M19 1v4 M17 3h4"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        )}
      </svg>
    </button>
  );
}
