import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'
import { useToast } from '../components/Toast.jsx'
import Icon from '../components/Icon.jsx'
import CheckoutModal from '../components/CheckoutModal.jsx'
import { usePaymentFlow } from '../components/PaymentFlow.jsx'

export default function Coins() {
  const { user, setCoins } = useAuth()
  const { t, num, money, currency } = useI18n()
  const toast = useToast()
  const [packages, setPackages] = useState([])
  const [checkout, setCheckout] = useState(null)

  useEffect(() => { api('/billing/coin-packages').then((d) => setPackages(d.packages)) }, [])

  // QR payments finish on this page (redirects finish on /payment/return).
  const onPaid = useCallback((result) => {
    setCoins(result.coins)
    if (result.status === 'paid') toast(t('coins.added', { n: num(result.meta.coins) }))
    else toast(t('ret.failed'), 'error')
  }, [setCoins, toast, t, num])
  const { pay, qrModal } = usePaymentFlow(onPaid)

  const coinsPerUnit = (p) => (p.coins + p.bonus) / p.prices[currency]
  const bestValue = packages.reduce((best, p) => (!best || coinsPerUnit(p) > coinsPerUnit(best) ? p : best), null)

  const buy = async (pkg, method) => {
    const outcome = await pay({ purpose: 'topup', packageId: pkg.id, method })
    if (outcome === 'qr') setCheckout(null)
    return outcome
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('coins.title')}</h1>
          <p className="muted">{t('coins.subtitle')}</p>
        </div>
      </div>

      <div className="wallet">
        <div>
          <span className="stat-label"><Icon name="account_balance_wallet" /> {t('coins.wallet')}</span>
          <strong className="wallet-amount"><Icon name="toll" fill /> {num(user.coins)}</strong>
        </div>
        <p>{t('coins.promo')} <Link className="link" to="/plans">{t('nav.plans')}</Link></p>
      </div>

      <p className="muted small currency-hint">
        <Icon name="currency_exchange" size={16} /> {t('coins.priceHint', { currency: currency.toUpperCase() })}
      </p>

      <div className="packages">
        {packages.map((p) => (
          <article key={p.id} className={`package ${p === bestValue ? 'best' : ''}`}>
            {p === bestValue && <span className="plan-tag">{t('coins.best')}</span>}
            <span className="coin-stack"><Icon name="toll" fill size={34} /></span>
            <div className="package-coins">{num(p.coins)}</div>
            <div className="package-bonus">{p.bonus ? t('coins.bonus', { n: num(p.bonus) }) : t('coins.noBonus')}</div>
            <button className="btn btn-block btn-outline" onClick={() => setCheckout(p)}>
              {money(p.prices[currency], currency)}
            </button>
          </article>
        ))}
      </div>

      {checkout && (
        <CheckoutModal
          title={t('coins.modalTitle')}
          lines={[
            [t('coins.coins'), num(checkout.coins)],
            [t('coins.bonusLabel'), `+${num(checkout.bonus)}`],
            [t('coins.receive'), t('coins.nCoins', { n: num(checkout.coins + checkout.bonus) })],
          ]}
          total={{ amount: checkout.prices[currency], currency }}
          purpose="topup"
          secureNote={t('pm.secure')}
          confirmLabel={t('checkout.continue')}
          onConfirm={(choice) => buy(checkout, choice)}
          onClose={() => setCheckout(null)}
        />
      )}
      {qrModal}
    </>
  )
}
