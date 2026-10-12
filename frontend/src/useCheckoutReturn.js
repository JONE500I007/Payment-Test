import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from './api.js'
import { useI18n } from './i18n.jsx'
import { useToast } from './components/Toast.jsx'

// Handles the redirect back from Stripe Checkout (?checkout=success&session_id=... or ?checkout=cancel).
export function useCheckoutReturn(onConfirmed) {
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const { t } = useI18n()
  const handled = useRef(false)
  const status = params.get('checkout')
  const sessionId = params.get('session_id')

  useEffect(() => {
    if (!status || handled.current) return
    handled.current = true
    setParams({}, { replace: true })
    if (status === 'cancel') {
      toast(t('checkout.canceled'), 'error')
      return
    }
    if (status === 'success' && sessionId) {
      api('/billing/checkout/confirm', { method: 'POST', body: { sessionId } })
        .then(onConfirmed)
        .catch((err) => toast(err.message, 'error'))
    }
  }, [status, sessionId, setParams, toast, onConfirmed, t])
}
