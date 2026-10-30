import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

// Spending (owner, 2026-10-30): the service history and the reports, one menu item with two tabs. The filters stay each tab's own.
export function SpendingTabs() {
  const { t } = useTranslation()
  return (
    <nav className="subnav" aria-label={t('spending')}>
      <NavLink to="/spending" end>{t('serviceHistory')}</NavLink>
      <NavLink to="/spending/reports">{t('reports')}</NavLink>
    </nav>
  )
}
