/**
 * Regenerates supabase/functions/vision/_geometry.ts from its sources.
 *
 * Run via `npm run sync:geometry` after changing walls.ts or vision.ts. The
 * accompanying test fails until this has been run, so it cannot be forgotten
 * quietly.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGeometryBundle } from '../../src/features/playspace/geometryBundle.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const bundle = buildGeometryBundle(
  read('src/features/playspace/walls.ts'),
  read('src/features/playspace/vision.ts'),
)
const out = resolve(root, 'supabase/functions/vision/_geometry.ts')
writeFileSync(out, bundle, 'utf8')
console.log(`wrote ${out} (${bundle.length} bytes)`)
