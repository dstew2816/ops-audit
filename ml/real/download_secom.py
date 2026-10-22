"""Download the UCI SECOM dataset into ml/real/data/secom/.

    python ml/real/download_secom.py

Source:  McCann, M. & Johnston, A. (2008). SECOM [Dataset]. UCI Machine Learning
         Repository. https://doi.org/10.24432/C54305
License: Creative Commons Attribution 4.0 International (CC BY 4.0). Sharing and
         adaptation are allowed with credit. The raw files are still NOT committed
         to this repository: they are about 5 MB of someone else's data, and a
         download script is a cleaner way to depend on them.

The archive is treated as untrusted input: it is fetched with a size cap, only
the three expected file names are extracted (no paths, nothing else), and the
extracted files are checked for the expected shape before anything uses them.
"""

from __future__ import annotations

import hashlib
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

URL = "https://archive.ics.uci.edu/static/public/179/secom.zip"
EXPECTED = {"secom.data", "secom_labels.data", "secom.names"}
MAX_BYTES = 50 * 1024 * 1024
DEST = Path(__file__).parent / "data" / "secom"


def main() -> int:
    DEST.mkdir(parents=True, exist_ok=True)
    print(f"downloading {URL}")
    with urllib.request.urlopen(URL, timeout=60) as response:
        blob = response.read(MAX_BYTES + 1)
    if len(blob) > MAX_BYTES:
        print("refusing: archive larger than the 50 MB cap", file=sys.stderr)
        return 1
    print(f"archive: {len(blob):,} bytes, sha256 {hashlib.sha256(blob).hexdigest()[:16]}...")

    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        names = set(archive.namelist())
        missing = EXPECTED - names
        if missing:
            print(f"refusing: archive is missing {sorted(missing)}", file=sys.stderr)
            return 1
        for name in sorted(EXPECTED):
            info = archive.getinfo(name)
            if info.file_size > MAX_BYTES:
                print(f"refusing: {name} is too large", file=sys.stderr)
                return 1
            (DEST / name).write_bytes(archive.read(name))
            print(f"  wrote {name} ({info.file_size:,} bytes)")

    rows = (DEST / "secom.data").read_text().splitlines()
    labels = (DEST / "secom_labels.data").read_text().splitlines()
    columns = len(rows[0].split())
    print(f"secom.data: {len(rows)} rows x {columns} columns; labels: {len(labels)} rows")
    if (len(rows), columns, len(labels)) != (1567, 590, 1567):
        print("unexpected shape: expected 1567 x 590 with 1567 labels", file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
