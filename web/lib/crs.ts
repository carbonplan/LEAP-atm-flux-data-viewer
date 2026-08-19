import type { ArrayMeta } from '@/lib/store-schema';
import * as zarr from 'zarrita';

export interface CrsInfo {
  supported: boolean;
  label: string;
  crs?: string; // built-in: 'EPSG:4326' | 'EPSG:3857'
  proj4?: string; // for projected datasets
  bounds?: [number, number, number, number]; // [xMin,yMin,xMax,yMax], source CRS units
  spatialDimensions?: { lat?: string; lon?: string };
  // Full store paths (group included) of the resolved lat/lon coordinate
  // arrays. zarr-layer's own bounds auto-detection assumes coords sit at the
  // store root or falls back to bare dim names, which breaks once a variable
  // lives under a nested DataTree group — so for geographic data we read
  // bounds ourselves from these paths instead of leaving it to zarr-layer.
  coordPaths?: { lat?: string; lon?: string };
  // zarr-layer falls back to reading the lat coordinate array itself when
  // this is unset, which breaks the same way bounds detection does for a
  // nested DataTree group — read it from geozarr's spatial:transform instead.
  latIsAscending?: boolean | null;
}

// geozarr's spatial:transform is the affine [x_res, 0, c, 0, y_res, f];
// y_res (index 4) is positive iff lat increases with row index.
function latIsAscendingFromTransform(variable: ArrayMeta): boolean | null {
  const transform = variable.groupAttrs?.['spatial:transform'] as
    | number[]
    | undefined;
  if (!Array.isArray(transform) || transform.length < 5) return null;
  return transform[4] > 0;
}

const isDegrees = (u?: string) => !!u && /degree/i.test(u);
const isMeters = (u?: string) => !!u && /^(m|met(er|re)s?)$/i.test(u.trim());

export function coordFor(
  dim: string,
  vars: ArrayMeta[],
  group?: string,
): ArrayMeta | undefined {
  // 1D coordinate array sharing the dim name. A DataTree repeats coordinate
  // names in every group, so prefer the one alongside the variable itself.
  const matches = vars.filter(
    (v) => v.dims.length === 1 && (v.name === dim || v.dims[0] === dim),
  );
  if (group !== undefined) {
    const sameGroup = matches.find((v) => v.group === group);
    if (sameGroup) return sameGroup;
  }
  return matches[0];
}

function units(v?: ArrayMeta): string | undefined {
  return v?.attrs?.['units'] as string | undefined;
}

function statBounds(x?: ArrayMeta, y?: ArrayMeta): [number, number, number, number] | undefined {
  const sx = x?.attrs?.['statistics_approximate'] as { min?: number; max?: number } | undefined;
  const sy = y?.attrs?.['statistics_approximate'] as { min?: number; max?: number } | undefined;
  if (sx?.min == null || sx?.max == null || sy?.min == null || sy?.max == null) return undefined;
  return [Number(sx.min), Number(sy.min), Number(sx.max), Number(sy.max)];
}

// Build a proj4 string from a WKT CRS. Supports the projections used by the
// public catalog (Lambert Conformal Conic); returns null otherwise.
function wktToProj4(wkt: string): string | null {
  const param = (name: string): number | undefined => {
    const m = wkt.match(new RegExp(`PARAMETER\\["${name}",(-?[0-9.eE+]+)\\]`, 'i'));
    return m ? Number(m[1]) : undefined;
  };
  const radius = (() => {
    const m = wkt.match(/SPHEROID\["[^"]*",([0-9.eE+]+),([0-9.eE+]+)/i);
    if (!m) return undefined;
    const a = Number(m[1]);
    const invF = Number(m[2]);
    return { a, invF };
  })();
  const ellps = radius
    ? radius.invF === 0
      ? `+R=${radius.a}`
      : `+a=${radius.a} +rf=${radius.invF}`
    : '+R=6371229';

  if (/Lambert_Conformal_Conic/i.test(wkt)) {
    const sp1 = param('standard_parallel_1');
    const sp2 = param('standard_parallel_2') ?? sp1;
    const lat0 = param('latitude_of_origin') ?? sp1;
    const lon0 = param('central_meridian');
    const x0 = param('false_easting') ?? 0;
    const y0 = param('false_northing') ?? 0;
    if (sp1 == null || lon0 == null) return null;
    return `+proj=lcc +lat_1=${sp1} +lat_2=${sp2} +lat_0=${lat0} +lon_0=${lon0} +x_0=${x0} +y_0=${y0} ${ellps} +units=m +no_defs`;
  }
  return null;
}

// Read a coordinate array's edge extent: first two + last cell centers,
// extrapolated half a cell past the outer centers. Mirrors zarr-layer's own
// bounds formula so untiled rendering lines up with its tiled/pyramid path.
async function edgeExtent(
  store: zarr.Readable,
  path: string,
): Promise<{ min: number; max: number }> {
  const arr = await zarr.open(zarr.root(store).resolve(`/${path}`), {
    kind: 'array',
  });
  const n = arr.shape[0];
  const [first, last] = await Promise.all([
    zarr.get(arr, [zarr.slice(0, Math.min(2, n))]),
    zarr.get(arr, [zarr.slice(n - 1, n)]),
  ]);
  const firstData = first.data as ArrayLike<number>;
  const lastData = last.data as ArrayLike<number>;
  const v0 = Number(firstData[0]);
  const v1 = Number(firstData[1] ?? v0);
  const vN = Number(lastData[0]);
  const step = Math.abs(v1 - v0);
  const half = Number.isFinite(step) ? step / 2 : 0;
  return { min: Math.min(v0, vN) - half, max: Math.max(v0, vN) + half };
}

/**
 * Bounds for a geographic (EPSG:4326) variable, read from its own lat/lon
 * coordinate arrays. zarr-layer's built-in bounds auto-detection assumes
 * coords sit at the store root (or falls back to bare dim names there), which
 * breaks once a variable lives under a nested DataTree group — so we read the
 * group-qualified paths ourselves and always hand zarr-layer explicit bounds.
 */
// Keyed by coordinate path pair. Both panes read the same coords, and every
// variable in a group shares them, so without this each pane refetches the
// lat/lon arrays on every variable switch — which is what made pane B lag
// behind pane A in compare mode.
const boundsCache = new Map<
  string,
  Promise<[number, number, number, number]>
>();

export function loadGeographicBounds(
  store: zarr.Readable,
  coordPaths?: { lat?: string; lon?: string },
): Promise<[number, number, number, number] | undefined> {
  if (!coordPaths?.lat || !coordPaths?.lon) return Promise.resolve(undefined);
  const key = `${coordPaths.lat}|${coordPaths.lon}`;
  let pending = boundsCache.get(key);
  if (!pending) {
    pending = (async () => {
      const [lon, lat] = await Promise.all([
        edgeExtent(store, coordPaths.lon as string),
        edgeExtent(store, coordPaths.lat as string),
      ]);
      return [lon.min, lat.min, lon.max, lat.max] as [
        number,
        number,
        number,
        number,
      ];
    })().catch((err) => {
      boundsCache.delete(key);
      throw err;
    });
    boundsCache.set(key, pending);
  }
  return pending;
}

// Resolve how to render `variable`'s spatial grid: geographic (4326) or a
// projected CRS (via proj4 + bounds derived from metadata).
export function resolveCrs(variable: ArrayMeta, vars: ArrayMeta[]): CrsInfo {
  const spatial = variable.dims.filter((d) =>
    ['lat', 'latitude', 'y', 'lon', 'longitude', 'x'].includes(d),
  );
  const lonDim = spatial.find((d) => ['lon', 'longitude', 'x'].includes(d));
  const latDim = spatial.find((d) => ['lat', 'latitude', 'y'].includes(d));
  const xc = lonDim ? coordFor(lonDim, vars, variable.group) : undefined;
  const yc = latDim ? coordFor(latDim, vars, variable.group) : undefined;

  // Geographic: spatial dims named lat/lon, or coord units in degrees.
  const named4326 =
    (lonDim === 'longitude' || lonDim === 'lon') && (latDim === 'latitude' || latDim === 'lat');
  if (named4326 || isDegrees(units(xc)) || isDegrees(units(yc))) {
    return {
      supported: true,
      label: 'EPSG:4326',
      crs: 'EPSG:4326',
      spatialDimensions: lonDim && latDim ? { lon: lonDim, lat: latDim } : undefined,
      coordPaths: { lon: xc?.path, lat: yc?.path },
      latIsAscending: latIsAscendingFromTransform(variable),
    };
  }

  // Projected: coord units in meters → need a proj4 + bounds.
  if (isMeters(units(xc)) || isMeters(units(yc))) {
    const wkt = vars.find((v) => v.attrs?.['crs_wkt'])?.attrs?.['crs_wkt'] as string | undefined;
    const proj4 = wkt ? wktToProj4(wkt) : null;
    const bounds = statBounds(xc, yc);
    if (proj4 && bounds) {
      return {
        supported: true,
        label: /lcc/.test(proj4) ? 'Lambert Conformal' : 'projected',
        proj4,
        bounds,
        spatialDimensions: lonDim && latDim ? { lon: lonDim, lat: latDim } : undefined,
      };
    }
    return { supported: false, label: 'projected CRS (unsupported)' };
  }

  // Unknown: assume geographic but flag it.
  return { supported: true, label: 'EPSG:4326 (assumed)', crs: 'EPSG:4326' };
}
