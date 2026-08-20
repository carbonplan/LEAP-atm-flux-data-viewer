"""Upload local CERES NetCDF files to OSN under CERES_EBAF/netcdf/.

uv run --with obstore scripts/upload_netcdf_osn.py [--delete-local]
"""

import os
import sys
from pathlib import Path

import obstore as obs
from obstore.store import S3Store

BUCKET = "leap-pangeo-pipeline"
ENDPOINT = "https://nyu1.osn.mghpcc.org"
PREFIX = "CERES_EBAF/netcdf"
LOCAL = Path(__file__).resolve().parents[1] / "notebooks" / "data"


def store() -> S3Store:
    return S3Store(
        BUCKET,
        endpoint=ENDPOINT,
        virtual_hosted_style_request=False,
        access_key_id=os.environ["OSN_KEY"],
        secret_access_key=os.environ["OSN_SECRET"],
    )


def main(delete_local: bool = False) -> None:
    s = store()
    for path in sorted(LOCAL.glob("*.nc")):
        key = f"{PREFIX}/{path.name}"
        size = path.stat().st_size
        print(f"{path.name} -> s3://{BUCKET}/{key} ({size / 1e9:.2f} GB)")
        with path.open("rb") as f:
            obs.put(s, key, f, chunk_size=64 * 1024 * 1024, max_concurrency=8)
        remote = obs.head(s, key)["size"]
        assert remote == size, f"size mismatch: local {size} remote {remote}"
        print("  ok")
        if delete_local:
            path.unlink()
            print("  deleted local")


if __name__ == "__main__":
    main("--delete-local" in sys.argv)
