import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'
import Icon from '../components/Icon.jsx'
import { MethodGlyph } from '../components/PaymentMethods.jsx'

const POLL_MS = 3000
const MAX_POLLS = 40 // ~2 minutes, then the page offers to keep waiting in the background

// Where Stripe (one-time), Opn and PayPal send the customer back to: ?pid=<payment id>[&canceled=1]
export default function PaymentReturn() {
  const [params] = useSearchParams()
  const { setCoins, refresh } = useAuth()
  const { t, num, money, date } = useI18n()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const started = useRef(false)
  const pid = params.get('pid')
  const canceled = params.get('canceled') === '1'

  useEffect(() => {
    if (started.current || !pid) return
    started.current = true
    let polls = 0
    let timer

    const check = async () => {
      try {
        const path = `/billing/payments/${pid}/${canceled ? 'cancel' : 'confirm'}`
        const res = await api(path, { method: 'POST' })
        setResult(res)
        if (res.status === 'paid') {
          setCoins(res.coins)
          refresh()
        } else if (res.status === 'pending' && ++polls < MAX_POLLS) {
          timer = setTimeout(check, POLL_MS)
        }
      } catch (err) {
        setError(err.message)
      }
    }
    check()
    return () => clearTimeout(timer)
  }, [pid, canceled, setCoins, refresh])

  const back = result?.kind === 'subscription' ? '/plans' : '/coins'
  const status = error ? 'failed' : result?.status ?? 'checking'
  const icon = { checking: 'hourglass_top', pending: 'hourglass_top', paid: 'check_circle', failed: 'cancel' }[status]

  let headline = t('ret.checking')
  let detail = ''
  if (status === 'paid' && result.meta?.type === 'topup') {
    headline = t('ret.paidTopup', { n: num(result.meta.coins) })
  } else if (status === 'paid' && result.subscription) {
    headline = t('ret.paidPass', { plan: result.subscription.planName, date: date(result.subscription.currentPeriodEnd) })
  } else if (status === 'pending') {
    headline = t('ret.pending')
    detail = t('ret.pendingHint')
  } else if (status === 'failed') {
    headline = t('ret.failed')
    detail = error || t('ret.failedHint')
  }

  return (
    <div className="return-page">
      <section className={`card return-card ${status}`}>
        <span className="return-icon"><Icon name={icon} fill size={44} /></span>
        <h1>{headline}</h1>
        {detail && <p className="muted">{detail}</p>}
        {result && (
          <div className="return-summary">
            <MethodGlyph id={result.method ?? 'card'} size={18} />
            <span>{t(`pm.${result.method ?? 'card'}`)}</span>
            <strong>{money(result.amount, result.currency)}</strong>
          </div>
        )}
        {status !== 'checking' && (
          <div className="return-actions">
            <Link to={back} className="btn btn-dark">{t(status === 'failed' ? 'ret.tryAgain' : back === '/plans' ? 'ret.toPlans' : 'ret.toCoins')}</Link>
            <Link to="/" className="btn btn-outline">{t('nav.overview')}</Link>
          </div>
        )}
        {status === 'checking' && <span className="spinner" />}
      </section>
    </div>
  )
}
