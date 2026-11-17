"""Generate two SYNTHETIC J2K studies and mobile contract examples, offline only.

Requires Python 3.10+, numpy, pydicom>=3, pylibjpeg, pylibjpeg-openjpeg,
and cryptography. No patient files, credentials, network or production writes.
The deliberately public TEST signing key must NEVER be trusted in production.
"""
import base64
import hashlib
import json
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pydicom
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, JPEG2000

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tmp/doctor-mobile-integration-20261108"
EXAMPLES = ROOT / "docs/specs/doctor-mobile-v1-examples"
SERVER = "d7ff07cb-af9f-4b59-8ba3-000000000001"
DEVICE = "d7ff07cb-af9f-4b59-8ba3-000000000002"
ORIGIN = "https://api.example.invalid"
NOW = "2026-11-08T10:00:00Z"
UNTIL = "2026-11-15T10:00:00Z"
HOT_UNTIL = "2030-01-01T00:00:00Z"  # Fixed fixture lifetime, not a production retention policy.
KID = "EXAMPLE-ONLY-NOT-PRODUCTION-P256-001"
EXAMPLES.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def b64(data): return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")
def timestamp(value): return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
def uid(value): return "2.25." + str(uuid.uuid5(uuid.NAMESPACE_URL, "orbital-synthetic-mobile/" + value).int)
def fake_url(path): return "https://storage.example.invalid/SYNTHETIC/" + path + "?example=not-a-signature"

# Public test vector, not a generated secret or production key. DER -> JWS raw R||S.
test_key = ec.derive_private_key(1, ec.SECP256R1())
public = test_key.public_key().public_numbers()
public_jwk = {"kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "kid": KID,
              "x": b64(public.x.to_bytes(32, "big")), "y": b64(public.y.to_bytes(32, "big"))}

def sign(claims):
    header = {"alg": "ES256", "typ": "JWT", "kid": KID}
    encoded = ".".join(b64(json.dumps(v, separators=(",", ":")).encode()) for v in (header, claims))
    der = test_key.sign(encoded.encode("ascii"), ec.ECDSA(hashes.SHA256()))
    r, s = utils.decode_dss_signature(der)
    return encoded + "." + b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))

me = {"serverId": SERVER, "serverOrigin": ORIGIN, "userId": "900010", "doctorId": "900001",
      "displayName": "SYNTHETIC DEMO DOCTOR", "permissions": {"canUseOnlineViewer": True, "canDownloadStudies": True},
      "serverTime": NOW}
records = []
studies = []
patients = []
for number, label in enumerate(("a", "b"), start=1):
    name = "synthetic-study-" + label
    legacy_prefix = f"hot/2026/11/08/appt_demo_{label}/"
    folder = OUT / name
    source = "demo-source-" + label + "-1"
    generation = "demo-generation-" + label + "-1"
    series_id = "series-" + label
    bundle_id = "demo-bundle-" + label + "-1"
    identity = {"serverId": SERVER, "userId": me["userId"], "doctorId": me["doctorId"],
                "patientId": str(910000 + number), "appointmentId": str(920000 + number),
                "studyId": str(930000 + number), "sourceVersion": source,
                "representationId": "jpeg2000-20x", "profileVersion": 1,
                "generationId": generation, "bundleId": bundle_id}
    gen_rel = f"{source}/jpeg2000-20x/{generation}"
    gen = folder / "_viewer" / gen_rel
    inst_dir = gen / series_id / "instances"
    inst_dir.mkdir(parents=True, exist_ok=True)
    frames = 36 if label == "a" else 40
    # Deliberately different spacing catches accidental 0.2-mm assumptions.
    spacing = (0.4, 0.4, 0.6) if label == "a" else (0.3, 0.5, 0.8)  # x,y,z
    series_uid, study_uid = uid(label + "/series"), uid(label + "/study")
    metadata = []
    yy, xx = np.mgrid[:160, :160]
    for z in range(frames):
        image = np.zeros((160, 160), dtype=np.uint16)
        if label == "a":
            image[(xx - 80) ** 2 + (yy - 80) ** 2 < (42 + 4 * np.sin(z / 5)) ** 2] = 1600
            image[(xx - 80) ** 2 + (yy - 80) ** 2 < 28 ** 2] = 500
        else:
            image[(abs(xx - 80) < 42) & (abs(yy - 80) < 34)] = 2200
            image[(abs(xx - 80) < 27) & (abs(yy - 80) < 19)] = 800
        image[72:88, 45 + z:49 + z] = 3500
        sop = uid(f"{label}/sop/{z}")
        fm = FileMetaDataset()
        fm.MediaStorageSOPClassUID = CTImageStorage
        fm.MediaStorageSOPInstanceUID = sop
        fm.TransferSyntaxUID = ExplicitVRLittleEndian
        fm.ImplementationClassUID = uid("implementation")
        dest = inst_dir / f"{z+1:06d}.dcm"
        ds = FileDataset(str(dest), {}, file_meta=fm, preamble=b"\0" * 128)
        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = sop
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.FrameOfReferenceUID = uid(label + "/frame")
        ds.PatientName = f"SYNTHETIC^PHANTOM^{label.upper()}"
        ds.PatientID = "DEMO-" + label.upper()
        ds.PatientIdentityRemoved = "YES"
        ds.DeidentificationMethod = "SYNTHETIC DATA - NO REAL PATIENT"
        ds.StudyDate = ds.SeriesDate = ds.ContentDate = "20261108"
        ds.StudyTime = ds.SeriesTime = ds.ContentTime = "100000"
        ds.Modality = "CT"
        ds.StudyDescription = f"SYNTHETIC IDENTITY TEST {label.upper()}"
        ds.SeriesDescription = ds.StudyDescription
        ds.ImageType = ["DERIVED", "SECONDARY", "AXIAL"]
        ds.InstanceNumber = z + 1
        ds.SeriesNumber = 1
        ds.Rows = ds.Columns = 160
        ds.PixelSpacing = [spacing[1], spacing[0]]
        ds.SliceThickness = spacing[2]
        ds.SpacingBetweenSlices = spacing[2]
        ds.ImagePositionPatient = [-80 * spacing[0], -80 * spacing[1], z * spacing[2]]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 12
        ds.HighBit = 11
        ds.PixelRepresentation = 0
        ds.RescaleIntercept, ds.RescaleSlope = -1000, 1
        ds.WindowCenter, ds.WindowWidth = 900, 4000
        ds.PixelData = image.astype("<u2").tobytes()
        ds.compress(JPEG2000, j2k_cr=[20], encoding_plugin="pylibjpeg", generate_instance_uid=False)
        ds.LossyImageCompression = "01"
        ds.LossyImageCompressionMethod = "ISO_15444_1"
        ds.LossyImageCompressionRatio = "20"
        ds.save_as(dest, enforce_file_format=True)
        # Verify each generated bitstream can be decoded before publishing fixtures.
        decoded = pydicom.dcmread(dest).pixel_array
        assert decoded.shape == (160, 160) and decoded.max() > decoded.min()
        header = pydicom.dcmread(dest, stop_before_pixels=True).to_json_dict()
        header["_url"] = f"instances/{dest.name}"
        metadata.append(header)
    index_path = f"{series_id}/ohif_metadata.json"
    dump(gen / index_path, metadata)
    manifest = {"schemaVersion": 1, "id": "jpeg2000-20x", "status": "ready", "sourceVersion": source,
                "expiresAt": HOT_UNTIL, "profile": {"codec": "jpeg2000", "targetRatio": 20},
                "series": [{"id": series_id, "index": index_path, "instanceCount": frames,
                            "modality": "CT", "description": f"SYNTHETIC PHANTOM {label.upper()}"}]}
    dump(gen / "manifest.json", manifest)
    dump(folder / "_viewer/representations.json", {"schemaVersion": 1, "sourceVersion": source,
         "studyKey": legacy_prefix, "defaultRepresentationId": "jpeg2000-20x", "expiresAt": HOT_UNTIL,
         "representations": [{"id": "jpeg2000-20x", "status": "ready", "manifest": gen_rel + "/manifest.json",
                              "expiresAt": HOT_UNTIL}]})
    files = []
    listed = [("manifest", "manifest.json", None), ("index", index_path, series_id)]
    listed.extend(("dicom", f"{series_id}/instances/{z+1:06d}.dcm", series_id) for z in range(frames))
    for i, (kind, path, series) in enumerate(listed, start=1):
        item = {"fileId": f"{label}-file-{i:04d}", "path": path, "kind": kind,
                "bytes": (gen / path).stat().st_size, "sha256": sha(gen / path)}
        if series: item["seriesId"] = series
        files.append(item)
    series = [{"id": series_id, "seriesInstanceUid": series_uid, "indexPath": index_path,
               "instanceCount": frames, "frameCount": frames, "modality": "CT", "transferSyntaxUid": str(JPEG2000)}]
    inventory = {"schemaVersion": 1, **{k: v for k, v in identity.items() if k not in ("userId", "doctorId")},
                 "codec": "jpeg2000", "targetRatio": 20, "files": files, "series": series,
                 "totalBytes": sum(f["bytes"] for f in files), "fileCount": len(files)}
    inv_path = gen / "download-inventory.json"
    dump(inv_path, inventory)
    inv_hash = sha(inv_path)
    claims = {"iss": ORIGIN, "aud": "orbital.doctor.ios.offline", "iat": timestamp(NOW), "nbf": timestamp(NOW),
              "exp": timestamp(UNTIL), "jti": str(uuid.uuid5(uuid.NAMESPACE_URL, name + "/offline")),
              **identity, "deviceId": DEVICE, "inventorySha256": inv_hash,
              "allowedActions": ["openLocalViewer", "saveLocalProject"]}
    grant = {"downloadId": str(uuid.uuid5(uuid.NAMESPACE_URL, name + "/download")),
             "downloadExpiresAt": "2026-11-08T11:00:00Z", "bundle": identity,
             "inventory": {"downloadUrl": fake_url(f"{name}/download-inventory.json"),
                           "bytes": inv_path.stat().st_size, "sha256": inv_hash},
             "resources": [{"fileId": f["fileId"], "downloadUrl": fake_url(name + "/" + f["path"])} for f in files],
             "urlsExpiresAt": "2026-11-08T10:15:00Z", "hotExpiresAt": HOT_UNTIL,
             "offlineGrant": sign(claims), "offlineAccessUntil": UNTIL, "serverTime": NOW}
    descriptor = {"schemaVersion": 1, "bundle": identity, "inventorySha256": inv_hash,
                  "bundleRelativePath": f"{SERVER}/{me['userId']}/{identity['studyId']}/{bundle_id}/bundle",
                  "series": series, "offlineAccessUntil": UNTIL}
    dump(folder / "mobile-binding.example.json", {"identity": identity, "legacyImportStudyPrefix": legacy_prefix,
         "generationRelativePath": "_viewer/" + gen_rel, "descriptor": descriptor})
    records.extend([{"schema": "DownloadInventory", "name": label + "-inventory", "value": inventory},
                    {"schema": "DownloadGrant", "name": label + "-grant", "value": grant},
                    {"schema": "OfflineGrantClaims", "name": label + "-claims", "value": claims},
                    {"schema": "LocalStudyDescriptor", "name": label + "-descriptor", "value": descriptor}])
    studies.append({"id": identity["studyId"], "patientId": identity["patientId"], "appointmentId": identity["appointmentId"],
                    "description": f"SYNTHETIC PHANTOM {label.upper()}", "acquiredAt": NOW,
                    "centerName": "SYNTHETIC TEST CENTER", "centerTimeZone": "Europe/Moscow", "viewerStatus": "ready",
                    "downloadStatus": "ready", "canDownload": True, "bundle": identity,
                    "totalBytes": inventory["totalBytes"], "hotExpiresAt": HOT_UNTIL})
    patients.append({"id": identity["patientId"], "displayName": f"SYNTHETIC PHANTOM {label.upper()}", "availableStudyCount": 1})
    with zipfile.ZipFile(OUT / (name + ".zip"), "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(folder.rglob("*")):
            if path.is_file(): archive.write(path, path.relative_to(folder))
records.extend([{"schema": "Me", "name": "me", "value": me},
    {"schema": "PatientPage", "name": "patients", "value": {"items": patients, "serverTime": NOW}},
    {"schema": "StudyPage", "name": "studies", "value": {"items": studies, "serverTime": NOW}},
    {"schema": "PairingQr", "name": "qr", "value": {"type": "orbital.doctor.pairing", "version": 1,
        "server": ORIGIN, "doctor_id": me["doctorId"], "pairing_ticket": "EXAMPLE_ONLY_NOT_A_WORKING_PAIRING_TICKET", "expires_at": "2026-11-08T10:02:00Z"}}])
request_id = "d7ff07cb-af9f-4b59-8ba3-000000000003"
session = {"sessionId": "d7ff07cb-af9f-4b59-8ba3-000000000004", "deviceId": DEVICE, "tokenType": "Bearer",
           "accessToken": "EXAMPLE_ONLY_NOT_A_WORKING_ACCESS_TOKEN", "accessTokenExpiresAt": "2026-11-08T10:15:00Z",
           "refreshToken": "EXAMPLE_ONLY_NOT_A_WORKING_REFRESH_TOKEN", "sessionExpiresAt": "2026-12-08T10:00:00Z", "me": me}
grant_a = next(r["value"] for r in records if r["name"] == "a-grant")
records.extend([
    {"schema": "Capabilities", "name": "capabilities", "value": {"contractVersion": "1.0", "serverId": SERVER,
     "serverOrigin": ORIGIN, "serverTime": NOW, "minimumAppVersion": "0.3.0",
     "features": {"qrPairing": True, "studyCatalog": True, "studyDownload": True, "offlineViewer": True},
     "limits": {"maxPageSize": 100, "maxUrlRefreshFileIds": 128}}},
    {"schema": "SessionResponse", "name": "session", "value": session},
    {"schema": "PairingExchangeRequest", "name": "exchange-request", "value": {
     "pairingTicket": "EXAMPLE_ONLY_NOT_A_WORKING_PAIRING_TICKET", "clientRequestId": request_id,
     "deviceId": DEVICE, "deviceName": "SYNTHETIC DEMO IPHONE", "platform": "ios", "appVersion": "0.3.0"}},
    {"schema": "RefreshRequest", "name": "refresh-request", "value": {"refreshToken": session["refreshToken"],
     "clientRequestId": request_id, "deviceId": DEVICE}},
    {"schema": "DownloadRequest", "name": "download-request", "value": {"clientRequestId": request_id,
     "expectedSourceVersion": "demo-source-a-1", "expectedGenerationId": "demo-generation-a-1"}},
    {"schema": "UrlRefreshRequest", "name": "urls-request", "value": {"clientRequestId": request_id,
     "bundleId": "demo-bundle-a-1", "fileIds": [grant_a["resources"][0]["fileId"]]}},
    {"schema": "UrlRefreshResponse", "name": "urls-response", "value": {"downloadId": grant_a["downloadId"],
     "bundleId": "demo-bundle-a-1", "inventorySha256": grant_a["inventory"]["sha256"],
     "resources": grant_a["resources"][:1], "urlsExpiresAt": "2026-11-08T10:15:00Z", "serverTime": NOW}},
    {"schema": "OfflineAccessRequest", "name": "offline-request", "value": {"clientRequestId": request_id,
     "bundleId": "demo-bundle-a-1", "inventorySha256": grant_a["inventory"]["sha256"]}},
    {"schema": "OfflineAccessResponse", "name": "offline-response", "value": {"bundleId": "demo-bundle-a-1",
     "inventorySha256": grant_a["inventory"]["sha256"], "offlineGrant": grant_a["offlineGrant"],
     "offlineAccessUntil": UNTIL, "serverTime": NOW}},
    {"schema": "ErrorResponse", "name": "not-ready-error", "value": {"error": {
     "code": "download_not_ready", "message": "Серия ещё готовится", "retryable": True, "retryAfterSeconds": 30},
     "requestId": request_id}}
])
dump(EXAMPLES / "contract-examples.json", {"syntheticOnly": True, "fixedTestTime": NOW,
     "fixtureRoot": "tmp/doctor-mobile-integration-20261108", "testPublicKey": public_jwk,
     "deviceId": DEVICE, "examples": records})
print(f"Generated 2 SYNTHETIC bundles ({len(studies)} study bindings).")
print(f"Output: {OUT}")
print("All 76 JPEG2000 files decoded successfully. Test signatures are only valid at the fixed fixture time.")
