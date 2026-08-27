/**
 * App — the root component and route table.
 *
 * Owns: the top-level route definitions. Routes are split into:
 *  - Public auth routes (login, signup, password reset) reachable while signed
 *    out.
 *  - A protected group behind <RequireAuth> (dashboard, campaign, profile) that
 *    redirects to /login without a session.
 *
 * The role-aware campaign workspace shell (1.4) will expand CampaignPage; the
 * dashboard is the signed-in landing page.
 */
import { Routes, Route, Link } from 'react-router-dom'
import { RequireAuth } from './features/auth/RequireAuth'
import { LoginPage } from './features/auth/LoginPage'
import { SignUpPage } from './features/auth/SignUpPage'
import { RequestPasswordResetPage } from './features/auth/RequestPasswordResetPage'
import { UpdatePasswordPage } from './features/auth/UpdatePasswordPage'
import { ProfilePage } from './features/profile/ProfilePage'
import { DashboardPage } from './features/campaigns/DashboardPage'
import { CampaignPage } from './features/campaigns/CampaignPage'
import { TermsPage } from './features/legal/TermsPage'
import { PrivacyPage } from './features/legal/PrivacyPage'
import { RefundsPage } from './features/legal/RefundsPage'

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
      {/* Public auth routes. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/reset-password" element={<RequestPasswordResetPage />} />

      {/* Legal pages (7.2) sit OUTSIDE the authenticated area on purpose: a
          prospective user must be able to read the terms before signing up, and
          a departing one after their account is gone. */}
      <Route path="/legal/terms" element={<TermsPage />} />
      <Route path="/legal/privacy" element={<PrivacyPage />} />
      <Route path="/legal/refunds" element={<RefundsPage />} />
      <Route path="/update-password" element={<UpdatePasswordPage />} />

      {/* Protected routes — redirect to /login without a session. */}
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/campaigns/:id" element={<CampaignPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
