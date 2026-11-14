# MPR framing, bounded navigation and independent zoom

CrosshairsTool's autoPan used to shift other cameras in-plane when its shared
point left their canvas. Repeated left-button drags could also move planes beyond
the scanned volume. This made the anterior teeth leave the axial window and could
produce empty MPR images even though data was present.

DentalCrosshairsTool now disables automatic panning. Deliberate middle-button Pan
remains available. Its native click/drag plane shifts are clipped along the drag
direction in voxel coordinates, using the selected planes' actual normals and
the volume's world-to-index transform. This retains physical synchronization,
including oriented volumes, while stopping at valid voxel-center bounds.

Both MPR hanging protocols give the axial window an initial framing margin, with
the image center at 53% of canvas height. The full initial field fits with room
above the anterior teeth. This is a default presentation, not a recurring camera
adjustment that would overwrite a user's pan/zoom.

Each planar MPR window has + and − controls beside its expand button. A click
changes only that window's scale by 1.25 or its inverse, bounded to 0.25–12 times
the initial zoom. A pan correction keeps the common physical crosshair at its
previous canvas point. Slice orientation and shared world point do not change;
other cameras retain their own scale and pan. 3D/panorama controls are unchanged.

Verification includes native Cornerstone camera-handler tests, direction-preserving
edge clipping, zoom anchoring/bounds, and browser mouse drags of ±900 pixels.
Browser checks also verify axial top margin, independent camera scale, unchanged
shared point, initial click/drag in inactive windows, focus/restore and all loupe
magnifications. Deployment evidence uses synthetic DICOM only and is kept in the
ignored QA directory.

## Preserve the crosshair when expanding/restoring a window

The viewport service's two-pass resize resets volume cameras to fit the new
canvas. Its position presentation alone does not retain the normalized position
of an off-center crosshair, particularly with axial displayArea settings.

`preserveMprResize` snapshots each loaded planar MPR's camera, volume identity,
relative zoom, shared world point and normalized canvas anchor. It uses intrinsic
canvas dimensions for the old renderer: DOM client dimensions already describe
the new layout when ResizeObserver fires. Temporary fit cameras cannot publish
camera-modified events and move the shared point. After both resize passes, it
restores camera orientation/slice and zoom, then applies an in-plane translation
to place the physical point at its previous normalized anchor. Native annotation
camera metadata is refreshed after all three planes are restored. Event suppression
is restored even if resize fails. Stack/unloaded/unrelated viewports keep their
existing behavior.

Browser QA uses an off-center point, manual pan, non-default zoom, two expand/
collapse cycles and Escape. It checks physical point, normalized anchor and zoom
for all three MPRs, including fractional pixel density corresponding to 80%.
