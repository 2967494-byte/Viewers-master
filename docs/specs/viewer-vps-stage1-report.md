# Stage 1 handoff: autonomous Orbital3D Viewer on VPS

**Status:** production static build is served from the dedicated VPS; local DICOM open is available through an SSH tunnel. Stages 2–3 (S3, CRM, DNS/HTTPS) were **not** started.

## 1. Changes (viewer + this VPS only)

### Viewer sources

| Path | Change |
|---|---|
| `platform/app/public/config/standalone.js` | New standalone profile: `routerBasename: '/3dviewer/'`, `dicomlocal`, `standaloneMode` / `hideCloudStorage` / `disableTokenViewer` |
| `platform/app/src/routes/Local/Local.tsx` | Hide «Облачное хранилище S3» when `hideCloudStorage` or `standaloneMode` |
| `platform/app/src/routes/TokenViewer.tsx` | Disable `/v/:token` network entry when `disableTokenViewer` or `standaloneMode` (redirect to `/`) |
| `docs/specs/viewer-vps-stage1-deploy.md` | Build/tunnel notes |
| `docs/specs/viewer-vps-stage1-report.md` | This handoff |

Dental/MPR/panorama code was **not** rewritten for this stage; the production artifact was built from HEAD `7d37627` **plus the uncommitted working tree** present at build time (ManualPanorama, implants, dental tools, etc.).

### VPS `95.163.231.17` only

- Ubuntu 24.04.3 LTS, x86_64; Nginx 1.24.0 installed
- System user `deploy` (nologin); web root `/var/www/orbital-viewer`
- Site: `/etc/nginx/sites-available/orbital-viewer-stage1` → `sites-enabled`
- Headers snippet: `/etc/nginx/snippets/orbital-viewer-headers.conf`
- Logrotate: `/etc/logrotate.d/orbital-viewer-stage1`
- Listen: **`127.0.0.1:8080` only** (no public 80/443/8080)
- Two releases on disk; `current` points at the first release after rollback test

**Not touched:** main project server, CRM/`patient_accounting_system`, S3, DNS, Certbot, `panorama-server/`.

## 2. Standalone config / routing diff (summary)

`standalone.js` essentials:

- `routerBasename: '/3dviewer/'`
- `showStudyList: true` (keeps root Local route registration)
- `defaultDataSourceName: 'dicomlocal'`
- `standaloneMode`, `hideCloudStorage`, `disableTokenViewer`
- No S3 datasource, no CRM endpoints

UI gates:

```tsx
// Local.tsx
const hideCloudStorage = Boolean(appConfig.hideCloudStorage || appConfig.standaloneMode);
// cloud button rendered only when !hideCloudStorage

// TokenViewer.tsx
const disabled = Boolean(appConfig.disableTokenViewer || appConfig.standaloneMode);
// redirects to '/' before API resolve
```

## 3. Reproducible build

| Field | Value |
|---|---|
| Profile | `standalone-stage-1` |
| Release ID (current) | `20261028T142823Z-7d37627` |
| git HEAD | `7d376276efa2eec93f8ee5420b24342576a56b32` (`7d37627`) |
| Snapshot note | Uncommitted dental/panorama customizations included at build time |
| Node | `v25.2.1` (build machine; preferred LTS was 22 — build succeeded on 25) |
| Yarn | `1.22.22` |
| `PUBLIC_URL` | `/releases/20261028T142823Z-7d37627/3dviewer/` |
| `APP_CONFIG` | `config/standalone.js` |
| Local artifact | `tmp/orbital-viewer-20261028T142823Z-7d37627.zip` (~34.4 MiB) |
| Deployed zip SHA-256 | `98d8c65a0e06b259fb2fda6ff0c23251af5e71f52f22f81a5491c53c966b314c` |
| Unpacked on VPS | `/var/www/orbital-viewer/releases/20261028T142823Z-7d37627` (~127 MiB) |

Second release (update/rollback test, PUBLIC_URL rewrite clone):

| Field | Value |
|---|---|
| Release ID | `20261028T152426Z-7d37627b` |
| Zip SHA-256 | `21c09fd3a2627ea67ca2d45f06ab9e7ef99cdad2e292a3ef45e5490224813020` |
| Status | Left on disk; **`current` rolled back** to first release |

## 4. Nginx + switch / rollback

Atomic publish:

```bash
VIEWER_ROOT=/var/www/orbital-viewer
RELEASE_PATH="$VIEWER_ROOT/releases/$RELEASE_ID"
ln -s "$RELEASE_PATH" "$VIEWER_ROOT/.current-$RELEASE_ID"
mv -Tf "$VIEWER_ROOT/.current-$RELEASE_ID" "$VIEWER_ROOT/current"
```

Rollback = same with previous `RELEASE_ID`. Verified: switch to `…7d37627b`, then back to `…7d37627`; both `/releases/<id>/3dviewer/` trees stayed HTTP 200.

## 5. SSH tunnel (no secrets)

On the machine that will open the browser:

```text
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:18080:127.0.0.1:8080 root@95.163.231.17
```

Open:

- `http://127.0.0.1:18080/3dviewer/`
- `http://127.0.0.1:18080/healthz`
- `http://127.0.0.1:18080/build-info.json`

Prefer `127.0.0.1` over `localhost` if IPv6 resolution interferes.

## 6. Acceptance checklist (automated + remaining manual)

### Done on VPS / via tunnel

- [x] Nginx listens only on `127.0.0.1:8080`
- [x] `/healthz` → 200 `ok`
- [x] `/build-info.json` → standalone profile + release ID
- [x] `/3dviewer/` → 200 `text/html`, COOP/COEP present
- [x] Release `app-config.js` has `standaloneMode`, basename `/3dviewer/`, `dicomlocal`
- [x] Missing JS/WASM → 404 (not HTML 200)
- [x] Dotfiles / `.env` → 404
- [x] No `hot-update.*` in artifact; no public `.map` in deploy package
- [x] HTML references `/releases/<id>/3dviewer/`
- [x] Tunnel serves same endpoints from `127.0.0.1:18080`
- [x] Second release publish + rollback verified
- [x] Logrotate configured; disk ~46 GiB free after two releases
- [x] S3 access/secret env cleared at build; no SSH password in artifact
- [x] `AKIA…` scan hits are false positives inside binary-like bundles; no real AWS keys found
- [!] Bundle still contains string `admin.orbital3d.ru` inside disabled TokenViewer chunk — route gated off in standalone; no automatic call from root Local flow

### Browser checks already done via tunnel

- [x] Start page title «Orbital3D Viewer»; buttons «Локальные файлы» / «Локальная папка»; no cloud/S3 CTA
- [x] `window.isSecureContext === true`
- [x] `window.crossOriginIsolated === true`
- [x] `typeof SharedArrayBuffer === "function"`
- [x] `window.config` = standalone (`standaloneMode`, basename `/3dviewer/`)
- [x] App + chunk assets load from `/releases/20261028T142823Z-7d37627/3dviewer/` with HTTP 200

### Manual DICOM / tools QA (operator)

On allowed local DICOM copies after tunnel is up:

- [ ] Local files / folder / drag-and-drop open without Network POSTs of DICOM and without CRM/S3 calls
- [ ] Dental MPR, 3D, rulers, canal, implants behave as in local fork
- [ ] Autopanorama / editor / arch edit / crosshair as in current local build
- [ ] Fresh browser profile works without old dev-cache

Timings (CPU/RAM of browser, open duration, panorama ready) should be filled by the person doing visual QA.

## 7. Remaining issues / boundaries

1. **Manual DICOM/tool QA** still required on a real workstation with the tunnel.
2. Build used **Node 25.2.1**, not Node 22 LTS — recorded; lockfile unchanged.
3. Source snapshot is **HEAD + dirty tree**; a single git SHA alone does not reproduce the binary without that working tree.
4. TokenViewer URL string remains in a lazy chunk though the route is disabled in standalone.
5. Helper scripts under `tmp/stage1_*.py` need `ORBITAL_VPS_PASSWORD` in the environment (passwords scrubbed from files).
6. **CRM, S3, DNS, main server, uploader, panorama-server — unchanged and out of scope.**

## 8. Measurements (stage-1 scope)

| Metric | Value |
|---|---|
| Zip size | ~36 121 538 bytes (~34.4 MiB) |
| Installed release | ~127 MiB each; two releases ~254 MiB |
| Disk before/after | ~46 GiB free (50G volume, ~1.7G used) |
| VPS RAM while serving | ~416 MiB used / 3.8 GiB total (idle static serve) |
| Listeners | ssh `:22`, nginx `127.0.0.1:8080` only |
| App load via tunnel | HTML 6 077 B + release assets; healthz/build-info/index verified &lt; few seconds over tunnel |
| Local DICOM open / MPR / panorama timings | *pending manual QA* |
| Browsers | *pending manual QA* |

## 9. Operator quick start

1. Start tunnel (command in §5).
2. Open `http://127.0.0.1:18080/3dviewer/`.
3. Choose local DICOM files or folder.
4. Confirm secure-context flags in DevTools.
5. Do not use public `http://95.163.231.17/` for acceptance (8080 is not exposed; non-secure public HTTP would break SAB).
