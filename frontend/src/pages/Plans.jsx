import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'
import { useToast } from '../components/Toast.jsx'
import Icon from '../components/Icon.jsx'
import CheckoutModal from '../components/CheckoutModal.jsx'
import { useCheckoutReturn } from '../useCheckoutReturn.js'
import { usePaymentFlow } from '../components/PaymentFlow.jsx'

const MAX_DISCOUNT = 20
const FEATURE_KEYS = ['feat.coins', 'feat.discount', 'feat.badge', 'feat.exclusive', 'feat.support']

export default function Plans() {
  const { refresh } = useAuth()
  const { t, num, money, date, currency, planDescription } = useI18n()
  const toast = useToast()
  const [plans, setPlans] = useState([])
  const [sub, setSub] = useState(undefined)
  const [checkout, setCheckout] = useState(null)

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([api('/billing/plans'), api('/billing/subscription')])
    setPlans(p.plans)
    setSub(s.subscription)
  }, [])

  useEffect(() => { load() }, [load])

  const onCheckoutReturn = useCallback(async ({ subscription }) => {
    await Promise.all([load(), refresh()])
    if (subscription) toast(t('plans.welcome', { plan: subscription.planName, coins: num(subscription.monthlyCoins) }))
    else toast(t('plans.processing'))
  }, [load, refresh, toast, t, num])
  useCheckoutReturn(onCheckoutReturn)

  // QR payments for 30-day passes finish here.
  const onPaid = useCallback(async (result) => {
    await Promise.all([load(), refresh()])
    if (result.status === 'paid' && result.subscription) {
      toast(t('ret.paidPass', { plan: result.subscription.planName, date: date(result.subscription.currentPeriodEnd) }))
    } else toast(t('ret.failed'), 'error')
  }, [load, refresh, toast, t, date])
  const { pay, qrModal } = usePaymentFlow(onPaid)

  // New plan or 30-day pass: card starts a renewing Stripe subscription, other methods buy a pass.
  const buyPlan = async (plan, method) => {
    const outcome = await pay({ purpose: 'plan', planCode: plan.code, method })
    if (outcome === 'qr') setCheckout(null)
    return outcome
  }

  // Switching an existing auto-renewing card subscription (charged to the saved card).
  const subscribe = async (plan) => {
    const res = await api('/billing/subscription', { method: 'POST', body: { planCode: plan.code } })
    if (res.url) {
      window.location.href = res.url // Stripe Checkout
      return
    }
    await Promise.all([load(), refresh()])
    setCheckout(null)
    toast(t('plans.switched', { plan: plan.name }))
  }

  const resume = async () => {
    try {
      await api('/billing/subscription', { method: 'POST', body: { planCode: sub.planCode } })
      await load()
      toast(t('plans.resumed'))
    } catch (err) { toast(err.message, 'error') }
  }

  const cancel = async () => {
    if (!confirm(t('plans.cancelConfirm', { plan: sub.planName, date: date(sub.currentPeriodEnd) }))) return
    try {
      await api('/billing/subscription/cancel', { method: 'POST' })
      await load()
      toast(t('plans.canceled'))
    } catch (err) { toast(err.message, 'error') }
  }

  if (sub === undefined) return <div className="splash inline"><span className="spinner" /></div>

  const current = plans.find((p) => p.code === sub?.planCode)
  const isPass = sub && !sub.managedByStripe
  const daysLeft = sub ? Math.ceil((new Date(sub.currentPeriodEnd) - Date.now()) / 86_400_000) : 0
  // An existing Stripe subscription can't change currency, so show its prices in that currency.
  const shownCurrency = sub?.managedByStripe ? sub.currency : currency
  const price = (plan) => money(plan.prices[shownCurrency], shownCurrency)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('plans.title')}</h1>
          <p className="muted">{t('plans.subtitle')}</p>
        </div>
      </div>

      <div className="stats three">
        <div className="stat">
          <span className="stat-label">{t('plans.current')}</span>
          <strong>{sub ? sub.planName : t('common.free')}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">{t('plans.monthlyCoins')}</span>
          <strong>{num(sub?.monthlyCoins ?? 0)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">{t(sub?.cancelAtPeriodEnd ? 'plans.endsOn' : 'plans.nextRenewal')}</span>
          <strong>{sub ? date(sub.currentPeriodEnd) : '—'}</strong>
        </div>
      </div>

      {isPass && (
        <div className={`sub-banner ${daysLeft <= 5 ? 'warn' : ''}`}>
          <Icon name={daysLeft <= 5 ? 'hourglass_bottom' : 'event_available'} fill />
          <span className="sub-text">
            {daysLeft <= 5
              ? t('plans.expiringSoon', { plan: sub.planName, days: Math.max(daysLeft, 0) })
              : t('plans.passBanner', { plan: sub.planName, date: date(sub.currentPeriodEnd) })}
          </span>
          {current && <button className="btn btn-sm btn-dark" onClick={() => setCheckout(current)}>{t('plans.extend')}</button>}
        </div>
      )}

      {sub && !isPass && (
        <div className={`sub-banner ${sub.cancelAtPeriodEnd ? 'warn' : ''}`}>
          <Icon name={sub.cancelAtPeriodEnd ? 'event_busy' : 'verified'} fill />
          <span className="sub-text">
            {sub.cancelAtPeriodEnd
              ? t('plans.bannerEnds', { plan: sub.planName, date: date(sub.currentPeriodEnd) })
              : t('plans.bannerActive', { plan: sub.planName, price: money(sub.price, sub.currency), date: date(sub.currentPeriodEnd) })}
          </span>
          {sub.cancelAtPeriodEnd
            ? <button className="btn btn-sm btn-dark" onClick={resume}>{t('plans.keep')}</button>
            : <button className="btn btn-sm btn-outline" onClick={cancel}>{t('plans.cancel')}</button>}
        </div>
      )}

      {sub?.managedByStripe && sub.currency !== currency && (
        <p className="muted small">{t('plans.billedIn', { currency: sub.currency.toUpperCase() })}</p>
      )}

      <div className="plans">
        {plans.map((plan) => {
          const isCurrent = plan.code === sub?.planCode
          const actionKey = !current ? 'plans.btnSubscribe' : plan.rank > current.rank ? 'plans.btnUpgrade' : 'plans.btnSwitch'
          return (
            <article key={plan.code} className={`plan ${plan.popular ? 'popular' : ''} ${isCurrent ? 'current' : ''}`}>
              {plan.popular && <span className="plan-tag">{t('plans.popular')}</span>}
              <div className="plan-top">
                <span className="plan-glyph"><Icon name={plan.icon} size={30} /></span>
                {isCurrent && <span className="chip"><Icon name="check" size={16} /> {t('plans.currentChip')}</span>}
              </div>
              <h3>{plan.name}</h3>
              <p className="muted plan-desc">{planDescription(plan.code, plan.description)}</p>
              <hr />
              <div className="price">{price(plan)}<span>{t('plans.perMonth')}</span></div>
              <ul className="features">
                {plan.features.map((f, i) => (
                  <li key={FEATURE_KEYS[i]} className={f.included ? '' : 'off'}>
                    <Icon name="check" size={18} />
                    {t(FEATURE_KEYS[i], { n: num(plan.monthlyCoins), pct: plan.discountPct })}
                  </li>
                ))}
              </ul>
              <hr />
              <div className="plan-metrics">
                <div>
                  <small><Icon name="group" size={16} /> {t('plans.members')}</small>
                  <strong>{num(plan.subscribers)}</strong>
                </div>
                <div>
                  <small><Icon name="trending_up" size={16} /> {t('plans.coinsPerMonth')}</small>
                  <strong>{num(plan.monthlyCoins)}</strong>
                </div>
                <div className="bar-row">
                  <small>{t('plans.shopDiscount')}</small>
                  <small>{plan.discountPct}%</small>
                </div>
                <div className="bar"><i style={{ width: `${(plan.discountPct / MAX_DISCOUNT) * 100}%` }} /></div>
              </div>
              <button
                className={`btn btn-block ${plan.popular && !isCurrent ? 'btn-dark' : 'btn-outline'}`}
                disabled={isCurrent && !isPass}
                onClick={() => setCheckout(plan)}
              >
                {isCurrent ? t(isPass ? 'plans.extend' : 'plans.btnCurrent') : t(actionKey, { plan: plan.name })}
              </button>
            </article>
          )
        })}
      </div>

      {checkout && (sub?.managedByStripe ? (
        <CheckoutModal
          title={t('sw.title', { plan: checkout.name })}
          lines={[
            [t('sw.newPlan'), `${checkout.name} — ${price(checkout)}${t('plans.perMonth')}`],
            [t('sw.bonus'), `+${num(Math.max(0, checkout.monthlyCoins - current.monthlyCoins))}`],
            [t('plans.shopDiscount'), `${checkout.discountPct}%`],
          ]}
          note={t(checkout.rank > current.rank ? 'sw.noteUp' : 'sw.noteDown')}
          secureNote={t('sw.secure')}
          confirmLabel={t('sw.confirm')}
          onConfirm={() => subscribe(checkout)}
          onClose={() => setCheckout(null)}
        />
      ) : (
        <CheckoutModal
          title={t(checkout.code === sub?.planCode ? 'sub.extendTitle' : 'sub.title', { plan: checkout.name })}
          lines={[
            [t('sub.plan'), t('sub.monthly', { plan: checkout.name })],
            [t('sub.bonus'), t('sub.bonusEvery', { n: num(checkout.monthlyCoins) })],
            [t('plans.shopDiscount'), `${checkout.discountPct}%`],
          ]}
          total={{ amount: checkout.prices[shownCurrency], currency: shownCurrency }}
          note={current && current.code !== checkout.code ? t('sub.replace', { plan: current.name }) : t('sub.passNote')}
          purpose="plan"
          secureNote={t('pm.secure')}
          confirmLabel={t('checkout.continue')}
          onConfirm={(method) => buyPlan(checkout, method)}
          onClose={() => setCheckout(null)}
        />
      ))}
      {qrModal}
    </>
  )
}
