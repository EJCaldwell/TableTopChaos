/**
 * playspace/geometryBundle.ts — how the Edge Function's copy of the geometry is
 * produced (Phase 9.3).
 *
 * THE PROBLEM. `supabase/functions/vision/` cannot import from `src/` — Edge
 * Functions are deployed as a self-contained directory — but the visibility
 * maths must be the SAME code the unit tests exercise. A hand-maintained second
 * copy is exactly the arrangement that drifts: someone fixes a sign error in the
 * tested file, the deployed one keeps the bug, and every test still passes while
 * players see through walls.
 *
 * THE ARRANGEMENT. `_geometry.ts` is GENERATED from `walls.ts` + `vision.ts` by
 * the function below, and a test asserts the file on disk matches what this
 * function produces right now. So the copy cannot silently fall behind: editing
 * either source without regenerating fails the suite, with a message saying what
 * to run.
 *
 * Not a build step, because a build step that has to be remembered is the same
 * problem one layer down. A failing test is remembered for you.
 */

/** Header stamped on the generated file, so nobody edits it by hand. */
const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced from src/features/playspace/walls.ts + vision.ts by
 * geometryBundle.ts, because an Edge Function cannot import from src/.
 *
 * To change anything here, edit those files and run:
 *     npm run sync:geometry
 *
 * A test (geometryBundle.test.ts) fails if this file does not match its
 * sources, so the deployed maths can never quietly fall behind the tested maths.
 */
`

/**
 * Builds the Edge Function's geometry bundle from the two source modules.
 *
 * The transform is deliberately dumb — strip the imports that only make sense
 * inside `src/`, and concatenate. Anything cleverer would be a second thing that
 * can be wrong.
 *
 * @param wallsSrc - Contents of walls.ts.
 * @param visionSrc - Contents of vision.ts.
 * @returns The full text of _geometry.ts.
 */
export function buildGeometryBundle(wallsSrc: string, visionSrc: string): string {
  const strip = (src: string) =>
    src
      // The cross-module import and re-export exist only to keep the two files
      // separate in src/; in one bundled file they are noise, and the re-export
      // would be a duplicate declaration.
      .split('\n')
      .filter(
        (line) =>
          !/^import type \{[^}]*\} from '\.\/walls'$/.test(line.trim()) &&
          !/^export type \{ Point, Segment \}$/.test(line.trim()),
      )
      .join('\n')
      .trim()

  return `${HEADER}\n${strip(wallsSrc)}\n\n${strip(visionSrc)}\n`
}
