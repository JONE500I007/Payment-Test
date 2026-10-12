import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import Icon from './Icon.jsx'

// Logo tile for each method: brand colour + a Font Awesome brand mark, a Material Symbol, or a short wordmark.
const LOGOS = {
  promptpay: { bg: '#1b3f73', icon: 'qr_code_2' },
  truemoney_qr: { bg: '#ff6b00', icon: 'qr_code_scanner' },
  card: { bg: 'linear-gradient(135deg, #8f84ff, #4b3cc9)', icon: 'credit_card' },
  truemoney: { bg: '#ff6b00', icon: 'account_balance_wallet' },
  shopeepay: { bg: '#ee4d2d', text: 'S' },
  linepay: { bg: '#06c755', fa: 'fa-line' },
  mobile_banking_kbank: { bg: '#138f2d', text: 'K+' },
  mobile_banking_scb: { bg: '#4e2a84', text: 'SCB' },
  mobile_banking_bay: { bg: '#fec43b', fg: '#5a4700', text: 'KMA' },
  mobile_banking_bbl: { bg: '#1e4598', text: 'BBL' },
  mobile_banking_ktb: { bg: '#00a6e6', text: 'KTB' },
  paypal: { bg: '#003087', fa: 'fa-paypal' },
  alipay: { bg: '#1677ff', fa: 'fa-alipay' },
}

const GROUPS = ['qr', 'card', 'wallet', 'bank', 'global']
const CARD_BRANDS = ['fa-cc-visa', 'fa-cc-mastercard', 'fa-cc-jcb']

export function MethodGlyph({ id, size = 22 }) {
  const logo = LOGOS[id] ?? LOGOS.card
  return (
    <span className="method-logo" style={{ background: logo.bg, color: logo.fg ?? '#fff', '--logo-size': `${size}px` }}>
      {logo.fa ? <i className={`fa-brands ${logo.fa}`} />
        : logo.icon ? <Icon name={logo.icon} size={size} />
          : <b>{logo.text}</b>}
    </span>
  )
}

let methodsCache = null
// eslint-disable-next-line react-refresh/only-export-components
export async function loadMethods() {
  methodsCache ??= api('/billing/methods').then((d) => d.methods).catch((err) => {
    methodsCache = null
    throw err
  })
  return methodsCache
}

// Grid of payment method tiles grouped by kind, filtered to the user's currency.
// `purpose` is 'topup' or 'plan' (plans show auto-renew vs 30-day pass on each tile).
export default function PaymentMethods({ purpose, value, onChange }) {
  const { t, currency, setCurrency } = useI18n()
  const [switching, setSwitching] = useState(false)
  const [methods, setMethods] = useState(null)

  useEffect(() => { loadMethods().then(setMethods).catch(() => setMethods([])) }, [])

  const available = (methods ?? []).filter((m) => m.currencies.includes(currency))
  // Thai methods only take THB; tell USD users how many more they'd get by switching.
  const thbOnly = (methods ?? []).filter((m) => !m.currencies.includes(currency) && m.currencies.includes('thb'))
  const firstId = available[0]?.id

  // Preselect the first method when nothing valid is chosen.
  useEffect(() => {
    if (firstId && !available.some((m) => m.id === value)) onChange(firstId)
  }, [firstId, available, value, onChange])

  if (!methods) return <div className="methods-loading"><span className="spinner sm dark" /></div>
  if (!available.length) return <div className="alert"><Icon name="credit_card_off" /> {t('pm.none')}</div>

  return (
    <div className="pm-groups" role="radiogroup" aria-label={t('checkout.method')}>
      {thbOnly.length > 0 && (
        <div className="pm-more">
          <Icon name="currency_exchange" size={20} />
          <span>{t('pm.moreInThb', { n: thbOnly.length })}</span>
          <button
            type="button" className="btn btn-sm btn-outline" disabled={switching}
            onClick={async () => { setSwitching(true); await setCurrency('thb').finally(() => setSwitching(false)) }}
          >
            {switching ? <span className="spinner sm dark" /> : t('pm.switchThb')}
          </button>
        </div>
      )}
      {GROUPS.map((group) => {
        const items = available.filter((m) => m.group === group)
        if (!items.length) return null
        return (
          <section key={group} className="pm-group">
            <h4>{t(`pmg.${group}`)}</h4>
            <div className="pm-grid">
              {items.map((m) => {
                const selected = value === m.id
                const badge = purpose === 'plan'
                  ? t(m.recurring ? 'pmb.recurring' : 'pmb.pass')
                  : t(`pmb.${m.id.startsWith('mobile_banking') ? 'bank' : m.id}`)
                return (
                  <button
                    key={m.id} type="button" role="radio" aria-checked={selected}
                    className={`pm-tile ${selected ? 'selected' : ''}`}
                    onClick={() => onChange(m.id)}
                  >
                    <span className="pm-top">
                      <MethodGlyph id={m.id} />
                      <span className="pm-name">{t(`pm.${m.id}`)}</span>
                      <span className="pm-check" aria-hidden="true"><Icon name="check" size={14} /></span>
                    </span>
                    <span className="pm-badge">
                      <Icon name="check_circle" fill size={16} />
                      {badge}
                      {m.id === 'card' && (
                        <span className="pm-cards" aria-hidden="true">
                          {CARD_BRANDS.map((b) => <i key={b} className={`fa-brands ${b}`} />)}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
