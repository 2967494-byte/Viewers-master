# Specification: Pre-generated DICOM Metadata Index (`ohif_metadata.json`)

To enable **instant loading** of large studies from S3 (Static WADO pattern), the server-side agent (unpacker) should generate a `ohif_metadata.json` file in the same S3 prefix/folder where the `.dcm` files are stored.

## File Purpose
The viewer reads this file to understand the geometry (MPR/3D), series structure, and slice positions of the study **without downloading a single heavy DICOM file** during startup.

## Structure
The file must be a JSON array of objects. Each object represents one DICOM instance (file).

```json
[
  {
    "_url": "I0001.dcm",
    "0020000D": { "Value": ["1.2.3.4..."] },
    "0020000E": { "Value": ["5.6.7.8..."] },
    ...
  }
]
```

## Essential DICOM Tags
For the viewer to correctly build a 3D Volume (MPR), the following tags **MUST** be extracted and included for **every** instance:

| Tag ID | Name | Importance | Description |
| :--- | :--- | :---: | :--- |
| `0020000D` | StudyInstanceUID | **[!] Critical** | Links instances to the study. |
| `0020000E` | SeriesInstanceUID | **[!] Critical** | Groups instances into series. |
| `00080018` | SOPInstanceUID | **[!] Critical** | Unique ID for each slice. |
| `00200032` | **ImagePositionPatient** | **[!] Critical** | X,Y,Z coordinates of the top-left corner of the slice. Used to order slices in 3D. |
| `00200037` | ImageOrientationPatient | **[!] Critical** | Direction cosines of rows and columns. |
| `00280030` | PixelSpacing | **[!] Critical** | Physical size of a pixel (mm). |
| `00180050` | SliceThickness | Important | Thickness of the slice (mm). |
| `00280010` | Rows | **[!] Critical** | Image height in pixels. |
| `00280011` | Columns | **[!] Critical** | Image width in pixels. |
| `00280100` | BitsAllocated | Important | Typically 8 or 16. |
| `00281050` | WindowCenter | Recommended | Default brightness. |
| `00281051` | WindowWidth | Recommended | Default contrast. |
| `00281052` | RescaleIntercept | Recommended | For CT/Hounsfield units. |
| `00281053` | RescaleSlope | Recommended | For CT/Hounsfield units. |

## Implementation Tips for Agent (e.g. Python pydicom)

1.  **Extract Tags**: Use a DICOM library to read the header (no need to read pixel data).
2.  **Format Tags**: Use the 8-digit HEX tag ID without commas (e.g., `0020000D`).
3.  **Values**: Values should be in an array `[value]` (DICOM JSON format requirement).
4.  **Relative Path**: The `_url` property should point to the filename relative to the JSON file’s location.

### Example Generator snippet (Python):
```python
import pydicom
import json
import os

def generate_index(study_dir):
    metadata = []
    for filename in os.listdir(study_dir):
        if filename.endswith(".dcm"):
            ds = pydicom.dcmread(os.path.join(study_dir, filename), stop_before_pixels=True)
            # pydicom to_json_dict() output format is perfect
            instance_meta = ds.to_json_dict()
            instance_meta["_url"] = filename
            metadata.append(instance_meta)
            
    with open(os.path.join(study_dir, "ohif_metadata.json"), "w") as f:
        json.dump(metadata, f)
```

## Security Note
Ensure the generated JSON is uploaded to S3 with the same access permissions as the `.dcm` files.
