import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { usePage } from './usePage'

// ERR-1b: a render error anywhere shows this calm page instead of a blank one, and goes to Sentry when the build has a DSN.
export function CrashBoundary({ children }: { children: ReactNode }) {
  return <Boundary pathname={useLocation().pathname}>{children}</Boundary>
}

class Boundary extends Component<{ children: ReactNode; pathname: string }, { crashed: boolean; path: string }> {
  state = { crashed: false, path: this.props.pathname }
  static getDerivedStateFromError = () => ({ crashed: true })
  // Back or any other navigation leaves the crashed screen and tries the new page.
  static getDerivedStateFromProps = (p: { pathname: string }, s: { path: string }) => (p.pathname === s.path ? null : { crashed: false, path: p.pathname })
  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.VITE_SENTRY_DSN) import('./sentry').then((s) => s.report(error, info.componentStack ?? undefined))
  }
  render = () => (this.state.crashed ? <Crashed /> : this.props.children)
}

function Crashed() {
  const { t } = useTranslation()
  usePage(t('crashTitle'))
  return (
    <main>
      <div role="alert"><h1 className="error" tabIndex={-1}>{t('crashTitle')}</h1></div>
      <p>{t('crashText')}</p>
      <div className="actions">
        <button onClick={() => location.reload()}>{t('reload')}</button>
        {/* a full load, so it also escapes a crash on the dashboard itself */}
        <a href="/">{t('goToDashboard')}</a>
      </div>
    </main>
  )
}
