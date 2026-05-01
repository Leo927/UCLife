// Translates Vite's `import raw from './foo.json5?raw'` syntax to a default
// string export when running tsx outside Vite.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAW_SUFFIX = '?raw'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(RAW_SUFFIX)) {
    const cleanSpec = specifier.slice(0, -RAW_SUFFIX.length)
    const parentURL = context.parentURL ?? pathToFileURL(process.cwd() + '/').href
    const parentPath = fileURLToPath(parentURL)
    const parentDir = path.dirname(parentPath)
    const filePath = path.resolve(parentDir, cleanSpec)
    return {
      url: pathToFileURL(filePath).href + RAW_SUFFIX,
      shortCircuit: true,
      format: 'module',
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(RAW_SUFFIX)) {
    const filePath = fileURLToPath(url.slice(0, -RAW_SUFFIX.length))
    const text = fs.readFileSync(filePath, 'utf8')
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(text)};`,
    }
  }
  return nextLoad(url, context)
}
