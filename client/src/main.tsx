import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './i18n'
import { AuthProvider } from './auth'
import App from './App.tsx'
import { CrashBoundary } from './crash'

// ERR-1b: Sentry in its own chunk, so a build without a DSN has none of it and the main bundle stays as it was.
// shortcut: an error in the first moments, before the chunk loads, is not reported; load it eagerly if those ever matter.
if (import.meta.env.VITE_SENTRY_DSN) import('./sentry')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <CrashBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </CrashBoundary>
    </BrowserRouter>
  </StrictMode>,
)
