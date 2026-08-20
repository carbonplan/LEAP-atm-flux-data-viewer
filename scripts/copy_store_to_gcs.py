"""Copy the CERES icechunk store from OSN (anonymous) to a public GCS bucket.

Run on the LEAP JupyterHub, where GCP ADC is already configured:

    uv run --with obstore scripts/copy_store_to_gcs.py GCS_BUCKET
"""

import sys

import obstore as obs
from obstore.store import GCSStore, S3Store

SRC_BUCKET = "leap-pangeo-pipeline"
ENDPOINT = "https://nyu1.osn.mghpcc.org"
PREFIX = "CERES_EBAF/store_auto_clim.icechunk/"


def main(dst_bucket: str) -> None:
    src = S3Store(
        SRC_BUCKET,
        endpoint=ENDPOINT,
        virtual_hosted_style_request=False,
        skip_signature=True,
    )
    dst = GCSStore(dst_bucket)

    n = 0
    for batch in obs.list(src, PREFIX, chunk_size=500):
        for meta in batch:
            key = meta["path"]
            obs.put(dst, key, obs.get(src, key).stream())
            n += 1
            if n % 100 == 0:
                print(f"{n} objects")
    print(f"done: {n} objects -> gs://{dst_bucket}/{PREFIX}")


if __name__ == "__main__":
    main(sys.argv[1])
