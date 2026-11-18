# One in-memory GPU context recovery — 2026-11-18

## Behaviour

One automatic recovery incident per page lifetime. Several pooled contexts lost together are one incident. The lost event is cancelled to permit browser restoration. While waiting, the mounted viewer is blocked by an overlay; no app reload, engine recreation, network retry, camera reset or source-volume resampling occurs.

After native context restoration, optional sharpening is disabled and its GPU passes discarded. GPU scene-graph nodes, shader/resource caches, texture-unit bindings and forward passes are recreated. Core renderers, cameras, actors, CPU frames and annotation state remain. Cached scalar textures are marked for upload. Automatic mode uses the existing recovery budget and the existing maximum 2× Z sampling policy; an explicit quality request is retained without silent quality reduction.

Success requires fresh, non-lost and GL-error-free draws in the visible MPR planes. Telemetry resumes from error through loading to ready, retaining the diagnostic incident history. Restoration and re-rendering have a total 15-second deadline. A second loss or a failed rebuild is terminal; there is no repeated recovery loop. A disposed engine does not cause a late failure on another page.

## Diagnostics and compatibility

Existing diagnostics v1 payload only, no backend change/migration/restart. Texture allocation events include GL internal format in `code`. Upload progress uses bounded `index` events with `value=volume`, `code=20010`, `count=uploaded layers`, `depth=display layers`. Existing 40-event ring/body cap and asynchronous reporting remain.

`context-restored` with `value=ready,count=1` means the actual MPR verification completed. Recovery failures use allocation-error codes: 20002 repeated context loss; 20003 deadline; 20004 no MPR viewports; 20005 resource reconstruction exception; 20006 GL error on a recovery draw. The actual GL error is recorded immediately before 20006. CRM static statistics translate these markers and label successful recovered sessions.

This does not guarantee that the browser/OS will restore a failed GPU, and cannot restore a context that was never supplied. JavaScript does not expose the underlying driver reset reason. Physical Intel driver failures still require production follow-up.

## Validation

- ORBITAL regression: 64 suites passed, 458 tests passed, one existing skipped test.
- Targeted tests: pooled losses, timeout, disposed engine, repeated loss, frozen VTK APIs, retained CPU data/quality, fresh frame confirmation, unchanged viewer mount, filter-pass recreation.
- Local real 450-frame study: native WEBGL_lose_context loss plus restore, all three images return, non-default axial layer and coronal zoom retained. Second forced loss terminates without another automatic attempt.
- Production build and deployed artifact IDs are recorded below after final verification.
