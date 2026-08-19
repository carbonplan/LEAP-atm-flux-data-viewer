type ZarrLayerModule = typeof import('@carbonplan/zarr-layer')

// One dynamic import for the whole page. Two panes mounting at once would
// otherwise each start their own, and pane B would wait on a chunk pane A is
// already fetching.
let cached: Promise<ZarrLayerModule> | null = null

export function loadZarrLayer(): Promise<ZarrLayerModule> {
  if (!cached) {
    cached = import('@carbonplan/zarr-layer').catch((err) => {
      cached = null
      throw err
    })
  }
  return cached
}
