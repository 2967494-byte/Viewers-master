# Large CT volumes: gray MPR with a working CPU panorama

## Reproduction and cause

Two affected studies have a 900 × 900 × 750 signed Int16 volume at 0.2 mm spacing.
The working comparison has 600 × 600 × 550 voxels. JPEG2000 decoding, frame loading,
geometry and the CPU panorama work in both cases.

Cornerstone 4.15.6's streaming OpenGL mapper disables half-float textures. Without
EXT_texture_norm16, the large volume therefore requests an R32F allocation of
2,430,000,000 bytes. Chrome/ANGLE rejects it with GL_INVALID_OPERATION and
`Texture total allocation size is too large`. Successful downloads do not repair
that failed allocation. The working comparison requests 792,000,000 bytes.

## Scoped workaround

`largeVolumeTexture.ts`, installed before volumes are created, configures only
signed Int16 volumes whose R32F estimate exceeds 1 GiB. Smaller volumes, Float32
and Uint16 keep their existing path. The latter is deliberate: Uint16's full
range exceeds finite half-float values.

VTK's per-texture model flags select R16F where norm16 is unavailable. Its frozen
public API remains intact. Exact normalized 16-bit remains preferred where the
renderer enables that extension. R16F reduces intensity precision for display;
it does not modify CPU voxels.

Some ANGLE backends also reject the 1,215,000,000-byte R16F allocation. To avoid
that, display storage is bounded to 768 MiB by reducing only the texture's Z
samples. For 900 × 900 × 750 it stores 900 × 900 × 497 samples (~0.302 mm in Z).
Original X/Y sampling remains intact. A context proxy belongs only to this
texture, intercepting its 3D storage and single-slice upload calls. Other GL calls
retain their native receiver. The voxel-center mapping is deterministic and
independent of frame arrival order. Normalized texture bounds remain unchanged.

The volume's dimensions, spacing, origin, direction, all downloaded source frames
and CPU voxel manager remain original. Crosshair/world coordinates and geometric
measurements therefore retain their coordinate system. The CPU panorama uses all
source data. This does reduce MPR display detail along Z; a badge explicitly
shows the display sampling. It must not be described as full source-resolution
MPR on those large volumes.

The workaround depends on the installed VTK model/streaming upload contract;
repeat browser verification when upgrading Cornerstone or VTK. It is not a
general solution for arbitrarily large volumes or unsupported GPU dimensions.

## Verification

- Unit coverage: frozen public API, mapper resetting flags, norm16 preference,
  scope/type checks, idempotence, unchanged CPU data/geometry, bounded allocation,
  deterministic Z mapping and native GL receivers.
- Synthetic signed JPEG2000 CT (no patient data), exact 900 × 900 × 750 geometry:
  before fix R32F allocation fails; after fix R16F 900 × 900 × 497 succeeds and
  actual canvas pixels vary in all three MPR windows at 24/750 loaded frames.
- Repeat with the 600 × 600 × 550 comparison: its R32F path must remain unchanged.
- Full-load and deployed-bundle results are recorded in the ignored deployment
  QA directory, rather than storing patient data in source control.
