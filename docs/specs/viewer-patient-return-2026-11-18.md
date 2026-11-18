# Patient-card return from CRM viewer launches

The header's left arrow previously always navigated to the local DICOM loading
screen. A validated CRM launch now sets an in-memory, per-tab patient return URL
before S3 loading. Token-to-MPR SPA navigation retains it. Header and loading-error
back actions use it. Manual S3 and local-file loading clear the previous context.

The appointment is taken from the authorized HOT root, supporting `appt_ID`,
`appt_ID_suffix` and extra-study `hot/ID/...` roots. The destination is the CRM
origin from the configured resolver plus `/patients/visit/ID`. This existing CRM
route checks appointment access and redirects to its patient's card. No backend,
database, image data, rendering or authentication changes.

Validation: 11 targeted tests passed (patient-return URL/context, S3 loading and
launch validation). Production webpack passed with three existing warnings.
Browser integration opened the 450-frame study under a local `appt_65001_abc123`
fixture and clicking the actual header arrow reached `/patients/visit/65001`.
That route was a local test card, not a production patient. Proof retained in
`tmp/patient-return-20261118/return-success.png`.

Deployed through Git push/pull, without restarting services:

- Release: `20261118T184646Z-patient-return`.
- Runtime source: `5b9591047f829d7c7351db3faae02356d04a41d7`.
- Static commit: `e4cfa2176b490dbc9d17e2295b50285edf769612`.
- Main: `app.bundle.ded7a7110e30e3ae64e6.js`.
- SHA256: `2fc287132e7a86eedcd0386253c2a31133c00d666f3bae77231f4f6aa4ec27e5`.
- 343 manifest files verified; 498 old hashed assets preserved. HTTPS index,
  config, new main and previous main returned 200 with matching hashes.
- Runtime config, nginx config, CRM commit and service states/PIDs were unchanged
  across activation. No restart or migration performed.
- Rollback: `/var/www/orbital3d-viewer/releases/20261118T182713Z-memory-optimization/checkout/public`.
- Deployment evidence: `tmp/patient-return-20261118/deployment.json`.

Already-open old bundles retain their previous behavior; reopen the study from
the patient account to load the fix. The return context is not persisted across
full document reloads or unrelated manual study loads.
