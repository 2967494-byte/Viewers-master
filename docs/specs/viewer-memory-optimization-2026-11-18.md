# Lossless web viewer memory changes — 2026-11-18

## Scope

Local implementation only. Production, Android APK and iOS bundles were not updated.
No new downsampling policy, deviceMemory threshold, texture format, resolution or
quality preference was introduced.

The installed Cornerstone core is 4.15.6. Its ImageVolume is image-backed:
`hasScalarVolume: false`, with no persistent voxelManager.scalarData array.
Consequently, removing a supposed second permanent 1 GB CPU volume is not an
available saving in the ordinary loading path. Manual panorama sampling already
reads those existing voxels without creating a full copy.

## Changes

- Bound the complete orbital S3 fetch/parse/decode pipeline to four active tasks.
  The existing download-only limit remains effective too. Cancelled queued tasks
  never start; active tasks finish and release their references safely.
- Reference-count temporary DICOM file registrations across frames. Cornerstone
  cache eviction now releases the decoder cache and fileManager registration once
  the last consumer goes away. Decode/download failure and eviction during a
  pending request also release resources. Cleanup is idempotent.
- Keep full-resolution decoded images in Cornerstone: they are the actual volume
  storage, required for MPR, panorama, measurements and graphics recovery.
- Calculate the window/level histogram from bounded chunks in a worker. Do not
  call getCompleteScalarDataArray or clone a full volume into that worker.
  Each chunk has at most 262,144 voxels (512 KiB for Int16). Use slice, not
  subarray: structured cloning a subarray can otherwise copy its whole backing
  buffer. Renderer buffers are never transferred or detached.
- Stop obsolete histogram work when its volume leaves the cache. Use the active
  dimension group for dynamic volumes. Include the maximum value in the last
  histogram bin, and handle constant volumes without division-by-zero bin loss.

Trade-off: after cache eviction, reopening can download the compressed files
again instead of retaining them indefinitely for the lifetime of the page.
Closing the existing rendering engine already purged the decoded cache before
this change; that pre-existing behavior is not claimed as a new improvement.

## Paired local comparison

Baseline: HEAD fe7788244046e90710595388a9d21b8e48f08900, before these edits.
The baseline's three runtime modules were substituted from `git show HEAD:path`
by a test-only pre-loader. Other code, production build options and the diagnostic
entry point were identical. No source files were temporarily reverted.

Same computer, same browser, sequential runs in the same tab, separate loopback
origins, synthetic 800 × 800 × 750 Int16 series, 750 JPEG2000 instances, maximum
detail in both versions. Both rendered all three MPR views. This phantom is not a
dental anatomy study; failure to find an automatic dental arch is expected.

| Metric | Before | After |
| --- | ---: | ---: |
| Decoded source cache | 960,000,000 B | 960,000,000 B |
| Loaded source images | 750 | 750 |
| Persistent second scalar array | absent | absent |
| Main JavaScript heap peak during opening | 1,063,499,224 B | 1,056,839,885 B |
| Main JavaScript heap before histogram | 1,021,892,630 B | 1,021,881,890 B |
| Main JavaScript heap peak during histogram | 1,981,942,995 B | 1,148,618,480 B |
| Histogram elapsed time | 5,663.79 ms | 4,026.59 ms |
| Actual 3D texture dimensions | 800 × 800 × 750 | 800 × 800 × 750 |
| Actual texture internal format | 36760 / R16_SNORM_EXT | 36760 / R16_SNORM_EXT |
| Volume texture storage, estimated | 960,000,000 B | 960,000,000 B |
| Initial DICOM requests / distinct files | 750 / 750 | 750 / 750 |
| Decoded cache after leaving the study | 0 B | 0 B |

The observed histogram heap peak fell 42.0%, and histogram elapsed time fell
28.9%. Ordinary opening remained approximately 1.06 GB of main JavaScript heap;
the difference there is too small to claim an improvement from one run.
The histogram maximum-bin correction accounts for all 480,000,000 source voxels;
the old histogram omitted 282 maximum-valued voxels. Source image pixels and
rendering are unaffected by that histogram correction.

These are `performance.memory.usedJSHeapSize` samples taken every 50 ms, not OS
resident/private memory, worker memory, free RAM or total browser consumption.
The driver can allocate additional GPU storage. In particular, do not sum these
figures and present that as measured total RAM, or promise a 500–700 MB viewer.
This is one paired local run, not an Intel/iPhone device reliability benchmark.
No forced garbage collection or heap snapshots were used.

The optimized 800 × 800 × 750 study was also closed and reopened in the same SPA:
after closing, cacheBytes = 0 and volumes = []; after reopening, cacheBytes =
960,000,000, all 750 images loaded, and main JS heap was 1,033,568,772 B. Garbage
collection is asynchronous; a zero Cornerstone cache is not a zero process heap.
A real 600 × 600 × 450 study also opened with all three MPR views and panorama.

Local raw artifacts and test-only harnesses:
`tmp/memory-comparison-20261118/{baseline,optimized,baseline-closed,optimized-closed}.json`,
`optimized-histogram.png`, paired webpack configurations and preview servers.
Regular production bundle: app.bundle.e447b94d47d35a06621c.js. Benchmark bundles
include an extra local-only histogram trigger and are not deployable artifacts.

## Verification

- 42 app tests: S3 access/download handling, compressed generation validation,
  initial loading, decoder/file cleanup, cancellation, bounded pipelines and
  preservation of decoded signed pixel buffers.
- 40 Cornerstone tests: chunked histogram, large-volume texture behavior,
  context recovery and panorama/section reconstruction.
- Production webpack build passed, with three pre-existing build warnings.
- Local browser: real study, large synthetic study in maximum detail, actual
  histogram worker before/after, cache clearing and same-SPA reopening.
- No physical Intel driver failure was reproduced or claimed fixed here.
