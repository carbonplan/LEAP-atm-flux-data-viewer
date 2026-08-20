import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import Providers from '@/app/providers'
import '@carbonplan/components/fonts.css'
import '@carbonplan/components/globals.css'
import '@/app/globals.css'

// LEAP's Style Guide specifies Montserrat for headings and titles. The mono
// face stays carbonplan's: the guide has no monospace, and the control labels
// and numeric readouts depend on one.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-montserrat',
  display: 'swap',
})

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
    <html lang='en' className={montserrat.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
