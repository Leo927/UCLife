import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(here, '..')
const assetsDir = join(repoRoot, 'src', 'render', 'portrait', 'assets')
const cacheDir = join(assetsDir, 'cache')

async function buildOne(srcDir: string, outFile: string): Promise<{ count: number; bytes: number }> {
  const entries = await readdir(srcDir)
  const svgFiles = entries.filter((f) => f.toLowerCase().endsWith('.svg')).sort()
  const dict: Record<string, string> = {}
  let totalIn = 0
  for (const f of svgFiles) {
    const full = join(srcDir, f)
    const body = await readFile(full, 'utf8')
    totalIn += body.length
    const key = basename(f, '.svg')
    dict[key] = body.trim()
  }
  const json = JSON.stringify(dict)
  await writeFile(outFile, json, 'utf8')
  return { count: svgFiles.length, bytes: json.length }
}

async function main() {
  await mkdir(cacheDir, { recursive: true })
  const tasks = [
    { name: 'vector', src: join(assetsDir, 'vector'), out: join(cacheDir, 'vector.cache.json') },
    { name: 'vector_revamp', src: join(assetsDir, 'vector_revamp'), out: join(cacheDir, 'vector_revamp.cache.json') },
  ]
  for (const t of tasks) {
    try {
      await stat(t.src)
    } catch {
      console.warn(`[portrait-cache] missing source dir, skipping: ${t.src}`)
      continue
    }
    const { count, bytes } = await buildOne(t.src, t.out)
    console.log(`[portrait-cache] ${t.name}: ${count} files → ${(bytes / 1024 / 1024).toFixed(2)} MB at ${t.out}`)
  }
}

main().catch((err) => {
  console.error('[portrait-cache] failed:', err)
  process.exit(1)
})
