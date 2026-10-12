import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'
import Icon from '../components/Icon.jsx'
import TxList from '../components/TxList.jsx'

export default function Overview() {
  const { user, refresh } = useAuth()
  const { t, num, money, date, currency } = useI18n()
  const [data, setData] = useState(null)

  useEffect(() => { api('/shop/overview').then(setData) }, [user.coins])

  // Payments finished in a banking/wallet app without coming back to the site get picked up here.
  useEffect(() => {
    api('/billing/payments/reconcile', { method: 'POST' })
      .then(({ paid }) => paid > 0 && refresh())
      .catch(() => {})
  }, [refresh])

  if (!data) return <div className="splash inline"><span className="spinner" /></div>

  const totalPaid = data.totalPaid.length
    ? data.totalPaid.map((p) => money(p.amount, p.currency)).join(' + ')
    : money(0, currency)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('ov.hi', { name: user.name.split(' ')[0] })}</h1>
          <p className="muted">{t('ov.subtitle')}</p>
        </div>
        <Link to="/coins" className="btn btn-outline"><Icon name="add" /> {t('ov.topup')}</Link>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-label"><Icon name="toll" /> {t('ov.balance')}</span>
          <strong>{num(data.coins)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label"><Icon name="workspace_premium" /> {t('ov.plan')}</span>
          <strong>{data.plan ? data.plan.name : t('common.free')}</strong>
          {data.plan && (
            <small className="muted">
              {t(data.plan.cancelAtPeriodEnd ? 'ov.ends' : 'ov.renews', { date: date(data.plan.currentPeriodEnd) })}
            </small>
          )}
        </div>
        <div className="stat">
          <span className="stat-label"><Icon name="inventory_2" /> {t('ov.items')}</span>
          <strong>{num(data.itemsOwned)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label"><Icon name="payments" /> {t('ov.paid')}</span>
          <strong>{totalPaid}</strong>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>{t('ov.recent')}</h2>
            <Link to="/history" className="link">{t('common.viewAll')}</Link>
          </div>
          <TxList transactions={data.recent} />
        </section>

        <section className="card highlight-card">
          {data.plan ? (
            <>
              <span className="plan-icon"><Icon name={data.plan.icon} /></span>
              <h2>{t('ov.member', { plan: data.plan.name })}</h2>
              <p className="muted">{t('ov.save', { pct: data.plan.discountPct })}</p>
              <Link to="/shop" className="btn btn-dark">{t('ov.goShop')}</Link>
            </>
          ) : (
            <>
              <span className="plan-icon"><Icon name="bolt" /></span>
              <h2>{t('ov.getMore')}</h2>
              <p className="muted">{t('ov.getMoreText')}</p>
              <Link to="/plans" className="btn btn-dark">{t('ov.seePlans')}</Link>
            </>
          )}
        </section>
      </div>
    </>
  )
}
