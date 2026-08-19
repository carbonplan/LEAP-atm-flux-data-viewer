'use client'

import { Box, Flex, Text } from 'theme-ui'

/** Uppercase mono caption + optional right-aligned readout, the LEAP control idiom. */
export default function Label({
  children,
  value,
}: {
  children: React.ReactNode
  value?: React.ReactNode
}) {
  return (
    <Flex sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 2 }}>
      <Text
        sx={{
          fontFamily: 'mono',
          fontSize: 0,
          letterSpacing: 'mono',
          textTransform: 'uppercase',
          color: 'secondary',
        }}
      >
        {children}
      </Text>
      {value != null && (
        <Box
          sx={{
            fontFamily: 'mono',
            fontSize: 0,
            letterSpacing: 'mono',
            color: 'text',
          }}
        >
          {value}
        </Box>
      )}
    </Flex>
  )
}
