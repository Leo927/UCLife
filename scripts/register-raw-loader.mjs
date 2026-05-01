import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./raw-json5-loader.mjs', import.meta.url)
