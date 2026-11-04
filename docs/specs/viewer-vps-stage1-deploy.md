# Stage 1: autonomous Orbital3D Viewer on VPS

Build outside VPS. Serve static assets from Nginx on `127.0.0.1:8080`. Access via SSH tunnel.

Handoff: [`viewer-vps-stage1-report.md`](./viewer-vps-stage1-report.md).

## Config

- `platform/app/public/config/standalone.js`
- Flags: `standaloneMode`, `hideCloudStorage`, `disableTokenViewer`
- `routerBasename: '/3dviewer/'`, `defaultDataSourceName: 'dicomlocal'`, `showStudyList: true`

## Build (PowerShell, build machine)

```powershell
$RELEASE_ID = "{0:yyyyMMddTHHmmssZ}-{1}" -f (Get-Date).ToUniversalTime(), (git rev-parse --short HEAD)
$env:RELEASE_ID = $RELEASE_ID
$env:NODE_ENV = "production"
$env:PUBLIC_URL = "/releases/$RELEASE_ID/3dviewer/"
$env:APP_CONFIG = "config/standalone.js"
$env:QUICK_BUILD = "false"
# Do not embed project S3 secrets
$env:S3_ACCESS_KEY = ""
$env:S3_SECRET_KEY = ""
$env:S3_ENDPOINT_URL = ""
$env:S3_BUCKET_NAME = ""

yarn install --frozen-lockfile
yarn workspace @ohif/app clean
yarn workspace @ohif/app build:viewer
```

Package `platform/app/dist` → `release/3dviewer/` + `build-info.json`. Use POSIX zip paths (Python `zipfile` / `path.as_posix()`), not Windows backslash archives.

## Current published release

- VPS: `95.163.231.17` (Ubuntu 24.04, loopback Nginx only)
- Release: `20261028T142823Z-7d37627`
- Path: `/var/www/orbital-viewer/current` → `releases/20261028T142823Z-7d37627`
- Zip SHA-256: `98d8c65a0e06b259fb2fda6ff0c23251af5e71f52f22f81a5491c53c966b314c`

## Tunnel

```text
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:18080:127.0.0.1:8080 root@95.163.231.17
```

Open `http://127.0.0.1:18080/3dviewer/`

## Rollback

```bash
VIEWER_ROOT=/var/www/orbital-viewer
RELEASE_ID=<previous-id>
ln -s "$VIEWER_ROOT/releases/$RELEASE_ID" "$VIEWER_ROOT/.current-$RELEASE_ID"
mv -Tf "$VIEWER_ROOT/.current-$RELEASE_ID" "$VIEWER_ROOT/current"
```
