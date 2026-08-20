"""Build CERES EBAF TOA climatology tree and write it to the icechunk store.

Run from notebooks/ (relative data/ paths) with an AWS profile named
leap-pipeline-bucket configured:

    uv run scripts/process.py
"""

# %%
import boto3
import icechunk
import xarray as xr
import xproj  # noqa: F401  registers the .proj accessor
from icechunk.xarray import to_icechunk
from topozarr import attach_geozarr_metadata, create_pyramid
from topozarr.metadata import ZarrLayerVarConfig

# %%
ds1 = xr.open_dataset(
    "data/CERES_EBAF_Ed4.2.1_Subset_200003-201412.nc", chunks={}
).drop_encoding()
ds2 = xr.open_dataset(
    "data/CERES_EBAF_Ed4.2.1_Subset_201501-202603.nc", chunks={}
).drop_encoding()
merge = xr.concat([ds1, ds2], dim="time")
merge.coords["lon"] = (merge.coords["lon"] + 180) % 360 - 180
merge = merge.sortby(merge["lon"])
merge.attrs["source"] = (
    "https://ceres-tool.larc.nasa.gov/ord-tool/jsp/EBAF421Selection.jsp"
)
merge  # noqa: B018  display in interactive use

# %%
SOLAR_MIN = 10.0  # W/m2; below this, albedo ratio is numerically unstable
STEFAN_BOLTZMANN = 5.670374419e-8  # W m-2 K-4

ALBEDO_SPECS = [
    (
        "toa_albedo_all_mon",
        "toa_sw_all_mon",
        "Top of The Atmosphere Albedo, All-Sky conditions",
    ),
    (
        "toa_albedo_clr_mon",
        "toa_sw_clr_c_mon",
        "Top of The Atmosphere Albedo, Clear-Sky (for cloud-free areas of region) conditions",
    ),
]

# Brightness temperature from an upwelling LW flux, via Stefan-Boltzmann.
# Derived from the *already averaged* flux (T of the mean flux), which is the
# convention the lab uses when it converts Figure 4 into Figure 5.
TEMPERATURE_SPECS = [
    (
        "toa_t_eff",
        "toa_lw_all_mon",
        "Effective Emission Temperature (from TOA longwave), All-Sky conditions",
    ),
    (
        "sfc_t_skin",
        "sfc_lw_up_all_mon",
        "Surface Skin Temperature (from surface upwelling longwave), All-Sky conditions",
    ),
]


def add_albedo(ds: xr.Dataset, suffix: str) -> xr.Dataset:
    """Derive albedo from already-averaged fluxes (ratio of means, not mean of ratios).

    Expressed in percent, because every lab question, map figure and colorbar
    in the course materials is in percent.
    """
    for name, sw, base in ALBEDO_SPECS:
        ds[name] = (100.0 * ds[sw] / ds["solar_mon"]).where(ds["solar_mon"] > SOLAR_MIN)
        ds[name].attrs = {"long_name": f"{base}, {suffix}", "units": "percent"}
    return ds


def add_temperatures(ds: xr.Dataset, suffix: str) -> xr.Dataset:
    """Invert Stefan-Boltzmann on the upwelling LW fluxes to get temperatures."""
    for name, lw, base in TEMPERATURE_SPECS:
        if lw not in ds:
            continue
        ds[name] = (ds[lw] / STEFAN_BOLTZMANN) ** 0.25
        ds[name].attrs = {"long_name": f"{base}, {suffix}", "units": "K"}
    return ds


def add_derived(ds: xr.Dataset, suffix: str) -> xr.Dataset:
    return add_temperatures(add_albedo(ds, suffix), suffix)


# %%
def build_climatology_tree(ds: xr.Dataset, data_vars: list[str]) -> xr.DataTree:
    monthly_clim = xr.Dataset(
        {v: ds[v].groupby("time.month").mean("time") for v in data_vars}
    )
    seasonal = xr.Dataset(
        {v: ds[v].groupby("time.season").mean("time") for v in data_vars}
    )
    annual = xr.Dataset({v: ds[v].groupby("time.year").mean("time") for v in data_vars})
    # Whole-record mean: the equivalent of the IRI Data Library's "[T] average",
    # which the lab instructions use for the climatological annual averages.
    overall = xr.Dataset({v: ds[v].mean("time") for v in data_vars})

    seasonal = seasonal.sel(season=["DJF", "MAM", "JJA", "SON"])
    seasonal.season.attrs["note"] = (
        "Meteorological season: DJF=Dec-Jan-Feb, MAM=Mar-Apr-May, JJA=Jun-Jul-Aug, SON=Sep-Oct-Nov"
    )
    monthly_clim.month.attrs["note"] = "Calendar month number (1-12)"
    annual.year.attrs["first_year"] = int(annual.year.values.min())
    overall.attrs["note"] = "Mean over the full record, all months and years"

    for group_ds, suffix in [
        (monthly_clim, "Monthly Climatology"),
        (seasonal, "Seasonal Climatology"),
        (annual, "Annual Climatology"),
        (overall, "Record Mean"),
    ]:
        for v in data_vars:
            base = ds[v].attrs.get("long_name", v).split(",")[0].strip()
            group_ds[v].attrs["long_name"] = f"{base}, {suffix}"
        add_derived(group_ds, suffix)

    ds = add_derived(ds, "Monthly Means")

    root = xr.Dataset(coords={"lat": ds["lat"], "lon": ds["lon"]}, attrs=ds.attrs)

    return xr.DataTree.from_dict(
        {
            "/": root,
            "/monthly": ds,
            "/climatology/monthly": monthly_clim,
            "/climatology/seasonal": seasonal,
            "/climatology/annual": annual,
            "/climatology/mean": overall,
        }
    )


flux_vars = [v for v in merge.data_vars if not v.startswith("toa_albedo")]
tree = build_climatology_tree(merge, flux_vars)
tree  # noqa: B018  display in interactive use


# %%
def compute_robust_clims(
    ds: xr.Dataset, data_vars: list[str], low: float = 2.0, high: float = 98.0
) -> dict[str, list[float]]:
    """Per-variable [low, high] percentile clim bounds, skipping NaNs."""
    q = [low / 100, high / 100]
    return {
        v: [float(x) for x in ds[v].quantile(q, skipna=True).values] for v in data_vars
    }


# %%
def apply_geozarr_and_encoding(tree: xr.DataTree) -> dict:
    encoding = {}
    for node in tree.subtree:
        ds_node = node.to_dataset()
        if not ds_node.data_vars:
            continue
        ds_node = ds_node.proj.assign_crs(spatial_ref="EPSG:4326", allow_override=True)
        data_vars = list(ds_node.data_vars)
        clims = compute_robust_clims(ds_node, data_vars)
        layer_hints = {v: ZarrLayerVarConfig(clim=clims[v]) for v in data_vars}
        ds_node = attach_geozarr_metadata(
            ds_node, x_dim="lon", y_dim="lat", layer_hints=layer_hints
        )
        node.dataset = ds_node
        pyramid = create_pyramid(ds_node, levels=1, x_dim="lon", y_dim="lat")
        encoding[node.path] = pyramid.encoding["/0"]
    return encoding


encoding = apply_geozarr_and_encoding(tree)
tree  # noqa: B018  display in interactive use

# %%
boto_session = boto3.Session(profile_name="leap-pipeline-bucket")
creds = boto_session.get_credentials().get_frozen_credentials()

storage = icechunk.s3_storage(
    bucket="leap-pangeo-pipeline",
    prefix="CERES_EBAF/store_auto_clim.icechunk",
    endpoint_url="https://nyu1.osn.mghpcc.org",
    allow_http=True,
    region="us-east-1",
    force_path_style=True,
    access_key_id=creds.access_key,
    secret_access_key=creds.secret_key,
    session_token=creds.token,
)
repo = icechunk.Repository.open_or_create(storage)

# %%
session = repo.writable_session("main")

# %%
# Every group is written fresh. A partial `mode='a'` write would leave stale
# attrs from a previous schema (e.g. albedo in 0-1 rather than percent) sitting
# on arrays whose shape happened not to change.
for node in tree.subtree:
    ds_node = node.to_dataset()
    if not ds_node.data_vars:
        continue
    to_icechunk(
        ds_node,
        session,
        group=node.path,
        encoding=encoding.get(node.path),
        align_chunks=True,
        mode="w",
    )

# %%
session.commit("add Ceres TOA")

# %%
rttree = xr.open_datatree(session.store, chunks={}, engine="zarr")
