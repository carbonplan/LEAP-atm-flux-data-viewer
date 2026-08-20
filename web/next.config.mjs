/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 writes AGENTS.md/CLAUDE.md into the app dir on dev start; we keep
  // agent instructions at the repo root instead.
  agentRules: false,

  // Hide the Next.js dev-mode indicator badge.
  devIndicators: false,
}

export default nextConfig
