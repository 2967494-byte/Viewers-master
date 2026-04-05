# Implementation Plan: Metadata Index Generation in StorageManager

The goal is to modify the study unpacking agent to generate a `ohif_metadata.json` file. This file will contain pre-parsed DICOM tags, allowing the viewer to load even large studies (500+ files) in under 1 second.

## User Review Required

> [!IMPORTANT]
> The plan requires adding the `pydicom` library to the Python environment of the `patient_accounting_system` project. This library is lightweight and specialized for reading DICOM headers.

> [!TIP]
> For existing studies on S3, I will create a standalone migration script that will iterate through all folders in the `hot/` bucket and generate missing index files.

## Proposed Changes

### [Component] patient_accounting_system: New Uploads

The changes will be focused on the storage utility responsible for unpacking ZIP studies and uploading them to the "Hot" (active) S3 storage.

#### [MODIFY] [requirements.txt](file:///C:/Users/Matvey/Documents/Projects/patient_accounting_system/requirements.txt)
- Add `pydicom` to dependencies.

#### [MODIFY] [storage_manager.py](file:///C:/Users/Matvey/Documents/Projects/patient_accounting_system/app/utils/storage_manager.py)
- Integrate metadata generation into the extraction pipeline.

### [Component] patient_accounting_system: Existing Studies (Full Re-indexing)

#### [NEW] [reindex_s3_studies.py](file:///C:/Users/Matvey/Documents/Projects/patient_accounting_system/scripts/reindex_s3_studies.py)
- A standalone maintenance script that:
  1. Lists all prefixes (studies) in `hot/` on S3.
  2. For each study without an index:
     - Downloads only the necessary headers (using metadata-first approach).
     - Generates `ohif_metadata.json`.
     - Uploads it back to S3.

---

## Verification Plan

### Automated Tests
- I will run a test script to simulate the unpacking of a sample DICOM ZIP and verify that:
  - `ohif_metadata.json` is generated.
  - It contains valid DICOM-JSON structure.
  - All critical tags (especially `ImagePositionPatient`) are present.

### Manual Verification
- After deployment, upload a study through the Patient Accounting System.
- Check the S3 bucket's "hot" folder for the presence of `ohif_metadata.json`.
- Open the study in the Orbital3D viewer and confirm it loads nearly instantly without the "Starting system..." progress bar.

## Open Questions
1. Do you have access to run `pip install pydicom` on the server where the agent runs, or should I try to use the existing `SimpleITK` library (it's already in requirements)?
2. Should I include any additional non-standard DICOM tags in the index if your clinic needs them for custom tools?
