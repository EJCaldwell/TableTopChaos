/**
 * Asserts the Edge Function's geometry is the geometry the tests exercise.
 *
 * This is the guard on the one genuinely dangerous thing about Phase 9.3: the
 * visibility maths exists twice, because an Edge Function cannot import from
 * src/. Without this test, a fix to the tested copy would leave the DEPLOYED
 * copy wrong — every test green, and players seeing through walls in production.
 *
 * It is a test rather than a build step because a build step that must be
 * remembered has the same failure mode as the copy it was meant to protect.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGeometryBundle } from './geometryBundle'

const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('the Edge Function geometry bundle', () => {
  it('matches its sources exactly', () => {
    const expected = buildGeometryBundle(
      read('src/features/playspace/walls.ts'),
      read('src/features/playspace/vision.ts'),
    )
    const actual = read('supabase/functions/vision/_geometry.ts')
    // If this fails, the deployed maths has fallen behind the tested maths.
    // Run `npm run sync:geometry`.
    expect(actual).toBe(expected)
  })

  it('carries the functions the vision function actually calls', () => {
    // A generation bug that silently dropped an export would fail at deploy
    // time with a module error, which is a slow way to find out.
    const bundle = read('supabase/functions/vision/_geometry.ts')
    for (const fn of ['segmentsOf', 'pointsFromJson', 'visibilityPolygon', 'sightRadiusPx']) {
      expect(bundle).toContain(`export function ${fn}`)
    }
  })

  it('contains no import of src/', () => {
    // The whole reason the bundle exists: an Edge Function cannot reach src/.
    expect(read('supabase/functions/vision/_geometry.ts')).not.toMatch(/from '\.\/walls'/)
  })
})
