import type { Metadata } from 'next'
import Providers from '@/app/providers'
import '@carbonplan/components/fonts.css'
import '@carbonplan/components/globals.css'
import '@/app/globals.css'

export const metadata: Metadata = {
  title: "Earth's Radiation Budget",
  description:
    'Maps of the radiative energy arriving at and leaving the top of the atmosphere and the surface.',
  icons: {
    icon: 'https://leap.columbia.edu/wp-content/uploads/2021/11/cropped-favicon-1-1-32x32.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang='en'>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
