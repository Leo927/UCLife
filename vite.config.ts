import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { existsSync, statSync, createReadStream } from 'node:fs'
import type { Plugin } from 'vite'

// In dev, mount the sibling Universal-LPC-Spritesheet-Character-Generator
// repo's spritesheets/ tree at /lpc/. The LPC PNGs are too large (and too
// numerous) to vendor into UC; serving them straight from the sibling
// checkout keeps the source of truth in one place.
//
// For prod builds, set VITE_LPC_BASE_URL to wherever the sprites are hosted
// (e.g. a CDN) — the sprite composer reads that env var via
// src/render/sprite/compose.ts.
function lpcAssetsPlugin(): Plugin {
  const lpcRoot = resolve(__dirname, '..', 'Universal-LPC-Spritesheet-Character-Generator', 'spritesheets')
  const prefix = '/lpc/'
  return {
    name: 'uclife-lpc-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(prefix)) return next()
        const rel = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
        if (rel.includes('..')) {
          res.statusCode = 400
          res.end('bad path')
          return
        }
        const full = resolve(lpcRoot, rel)
        if (!full.startsWith(lpcRoot) || !existsSync(full) || !statSync(full).isFile()) {
          res.statusCode = 404
          res.end('not found')
          return
        }
        res.setHeader('Content-Type', full.endsWith('.png') ? 'image/png' : 'application/octet-stream')
        res.setHeader('Cache-Control', 'public, max-age=3600')
        createReadStream(full).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), lpcAssetsPlugin()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
})
