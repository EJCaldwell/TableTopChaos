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
import './styles/tokens.css'

// Locate the mount node declared in index.html. If it's missing the HTML is
// broken, so fail loudly rather than rendering into nothing.
const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
