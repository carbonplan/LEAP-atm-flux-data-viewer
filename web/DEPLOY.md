# Deploying `web/` to Vercel

## Project settings

- **Root Directory**: `web`
- **Framework Preset**: `Next.js` (must not be `Other` — with `Other`, Vercel
  serves `web/public/` as static files and `/` returns 404 while the deployment
  still shows "Ready")
- **Build / Output / Install Command**: no overrides, Next.js defaults
- Settings changes do not apply retroactively. After changing them, redeploy
  with "Use existing Build Cache" unchecked.

Debugging tip: if `/` 404s but `/leap-logo.png` returns 200, the framework
preset is wrong.

## Environment variables

| Key | Value |
| --- | --- |
| `NEXT_PUBLIC_ICECHUNK_URL` | `https://storage.googleapis.com/leap-public/data/CERES_EBAF/store.icechunk` |

Set for Production and Preview. Not a secret — leave the sensitive/lock toggle
off so the value stays readable.

`NEXT_PUBLIC_*` vars are inlined at build time, so the var must exist before
the build runs. Changing it requires a redeploy. If it is missing,
`lib/config.ts` falls back to `''` and the app renders the empty state.

The store is read directly from the browser, so its host must send CORS headers
for the deployed origin. The GCS mirror (`leap-public`) does; the OSN source
does not.

## Custom domain

`leap.columbia.edu` is not a delegated zone — its records live in the
`columbia.edu` zone, managed by Columbia CUIT. Subdomains cannot be self-served
and must be requested.

Precedent: `catalog.leap.columbia.edu` (repo `carbonplan/leap-data-catalog`)
is `CNAME -> cname.vercel-dns.com`.

Steps:

1. Vercel project -> Settings -> Domains -> add `<name>.leap.columbia.edu`
2. Vercel shows the required record (a subdomain gets
   `CNAME -> cname.vercel-dns.com`)
3. Ask the LEAP / Columbia IT DNS contact to add that record
4. Vercel verifies and issues the TLS cert once the record propagates

Until then, the `*.vercel.app` alias works and can be renamed under Domains;
both stay attached after the custom domain is added.

## Deployment protection

Deployment URLs (`...-<hash>-carbonplan.vercel.app`) 302 to team SSO because
Vercel Authentication is on for the carbonplan team. The production alias is
public. Turn protection off under Settings -> Deployment Protection only if
preview links need to be shareable externally.
