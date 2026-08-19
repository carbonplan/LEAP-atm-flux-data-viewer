'use client'

// `ssr: false` is only legal inside a Client Component on Next 15+, which is
// why this page opts in rather than staying a Server Component.
import dynamic from 'next/dynamic'
import { Box } from 'theme-ui'
import { STORE_URL } from '@/lib/config'
import EmptyState from '@/components/empty-state'

const Viewer = dynamic(() => import('@/components/viewer'), {
  ssr: false,
  loading: () => (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'mono',
        fontSize: 1,
        color: 'secondary',
        letterSpacing: 'mono',
      }}
    >
      loading…
    </Box>
  ),
})

export default function Page() {
  return (
    // Fixed, not absolute: an absolute root rides the document, and focusing
    // a native select near the bottom scrolls it out of view with no
    // scrollbar left to scroll back.
    <Box sx={{ position: 'fixed', inset: 0, bg: 'background' }}>
      {STORE_URL ? <Viewer /> : <EmptyState />}
    </Box>
  )
}
