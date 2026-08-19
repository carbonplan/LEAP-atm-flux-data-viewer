/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 writes AGENTS.md/CLAUDE.md into the app dir on dev start; we keep
  // agent instructions at the repo root instead.
  agentRules: false,

  // Hide the Next.js dev-mode indicator badge.
  devIndicators: false,

  // OSN serves no CORS headers, so the browser cannot read the icechunk store
  // directly. Proxy it same-origin. Range requests pass through unchanged.
  async rewrites() {
    return [
      {
        source: '/osn/:path*',
        destination: 'https://nyu1.osn.mghpcc.org/:path*',
      },
    ]
  },
}

export default nextConfig
