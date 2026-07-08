/**
 * Application entry point.
 *
 * Owns: mounting the React tree into #root and installing the top-level
 * providers. Right now that's just the router; auth context, query caching,
 * etc. will be added as later subphases need them.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { AuthProvider } from './features/auth/AuthProvider'
import { supabase } from './lib/supabase'
import './styles/tokens.css'

// QA helper (dev builds only): expose the shared Supabase client on `window` so
// manual test checklists (e.g. QA/1.5_tests/*) can call `supabase.functions
// .invoke(...)` and `supabase.from(...).select(...)` straight from the browser
// devtools console, using whichever account is currently signed in. `import.meta
// .env.DEV` is false in production builds, so this line is stripped from any
// deployed bundle — the client is never attached to window in prod.
if (import.meta.env.DEV) {
  ;(window as unknown as { supabase: typeof supabase }).supabase = supabase
}

// Locate the mount node declared in index.html. If it's missing the HTML is
// broken, so fail loudly rather than rendering into nothing.
const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      {/* AuthProvider lives inside the router so auth-aware guards/pages can use
          both router hooks and useAuth(). */}
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
