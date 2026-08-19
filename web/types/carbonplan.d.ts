// @carbonplan/colormaps ships untyped JS. Declare the surface we actually use.
declare module '@carbonplan/colormaps' {
  export type ColormapType =
    | 'sequentialSingleHue'
    | 'sequentialMultiHue'
    | 'diverging'
    | 'cyclical'

  export interface ColormapMeta {
    name: string
    type: ColormapType
  }

  export const colormaps: ColormapMeta[]

  export function makeColormap(
    name: string,
    options?: { count?: number; format?: 'hex' | 'rgb' },
  ): string[]

  export function useColormap(
    name: string,
    options?: { count?: number; format?: 'hex' | 'rgb' },
  ): string[]

  export function useThemedColormap(
    name: string,
    options?: { count?: number; format?: 'hex' | 'rgb' },
  ): string[]
}
