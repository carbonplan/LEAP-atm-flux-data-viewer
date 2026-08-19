'use client'

import Image from 'next/image'
import { Box, Flex, Text } from 'theme-ui'
import { INTENDED_STORE_URL } from '@/lib/config'

const Code = ({ children }: { children: React.ReactNode }) => (
  <Box
    as='code'
    sx={{
      display: 'block',
      bg: 'hinted',
      color: 'primary',
      fontFamily: 'mono',
      fontSize: [0, 0, 0, 1],
      letterSpacing: 'mono',
      px: 3,
      py: 2,
      my: 2,
      textAlign: 'left',
      wordBreak: 'break-all',
    }}
  >
    {children}
  </Box>
)

export default function EmptyState() {
  return (
    <Flex
      sx={{
        position: 'absolute',
        inset: 0,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: 4,
      }}
    >
      <Box sx={{ maxWidth: '640px', width: '100%' }}>
        <Image
          src='/leap-logo.png'
          width={120}
          height={30}
          alt='LEAP'
          style={{ marginBottom: 24 }}
        />
        <Text
          as='h1'
          sx={{
            fontFamily: 'heading',
            fontSize: [5, 5, 5, 6],
            lineHeight: 'h1',
            letterSpacing: 'heading',
            display: 'block',
            mb: 3,
          }}
        >
          CERES EBAF TOA
        </Text>
        <Text
          sx={{
            display: 'block',
            fontSize: [2, 2, 2, 3],
            color: 'secondary',
            mb: 3,
          }}
        >
          No Icechunk store is configured, so there is nothing to render yet.
          Point the viewer at a store by setting an environment variable in{' '}
          <Box as='code' sx={{ fontFamily: 'mono', fontSize: 1 }}>
            web/.env.local
          </Box>
          :
        </Text>
        <Code>NEXT_PUBLIC_ICECHUNK_URL=&lt;url&gt;</Code>
        <Text
          sx={{
            display: 'block',
            fontSize: [1, 1, 1, 2],
            color: 'secondary',
            mt: 4,
          }}
        >
          Once the CERES pipeline publishes its store, that URL will be:
        </Text>
        <Code>{INTENDED_STORE_URL}</Code>
      </Box>
    </Flex>
  )
}
