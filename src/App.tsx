/**
 * App — the root component and route table.
 *
 * Owns: the top-level route definitions and the shared page chrome. This is the
 * skeleton for subphase 1.1; auth guards (1.2), the campaign dashboard (1.3),
 * and the role-based workspace shell (1.4) will hang off these routes as they
 * are built. For now it renders a landing page with the setup/health check.
 */
import { Routes, Route, Link } from 'react-router-dom'
import { ConnectionCheck } from './features/health/ConnectionCheck'

/** Temporary landing page for the 1.1 scaffold. Replaced by the dashboard in 1.3. */
function Home() {
  return (
    <main style={{ padding: 'var(--space-8)', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 'var(--space-2)' }}>D&amp;D Campaign Manager</h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
        Foundations scaffold (Phase 1.1). Auth, campaigns, and the role-based
        workspace land in the following subphases.
      </p>
      <div style={{ marginTop: 'var(--space-6)' }}>
        <ConnectionCheck />
      </div>
    </main>
  )
}

/** Fallback for unmatched routes. */
function NotFound() {
  return (
    <main style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
      <h1>404</h1>
      <p>
        That page doesn&apos;t exist. <Link to="/">Go home</Link>.
      </p>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
