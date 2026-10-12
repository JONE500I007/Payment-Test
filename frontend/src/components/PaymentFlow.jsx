import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import Modal from './Modal.jsx'

const POLL_MS = 3000

// Shown when a provider gives us a QR code to scan instead of a page to redirect to.
function QrModal({ paymentId, qrImage, testUri, onDone, onClose }) {
  const { t } = useI18n()

  useEffect(() => {
    const timer = setInterval(async () => {
      const result = await api(`/billing/payments/${paymentId}/confirm`, { method: 'POST' }).catch(() => null)
      if (result && result.status !== 'pending') {
        clearInterval(timer)
        onDone(result)
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [paymentId, onDone])

  return (
    <Modal title={t('qr.title')} onClose={onClose}>
      <div className="qr">
        <img src={qrImage} alt={t('qr.title')} />
        <p className="muted small">{t('qr.hint')}</p>
        <p className="qr-wait"><span className="spinner sm dark" /> {t('qr.waiting')}</p>
        {testUri && (
          <a className="link small" href={testUri} target="_blank" rel="noreferrer">{t('qr.simulate')}</a>
        )}
      </div>
    </Modal>
  )
}

// Starts a checkout with the chosen method. Redirect-based methods leave the page;
// QR-based ones open a modal that polls until paid. `onDone(result)` gets the confirm result.
export function usePaymentFlow(onDone) {
  const [qr, setQr] = useState(null)
  // Stable so the QR modal's polling timer isn't restarted on every render.
  const handleDone = useCallback((result) => { setQr(null); onDone(result) }, [onDone])

  const pay = async (body) => {
    const res = await api('/billing/checkout', { method: 'POST', body })
    if (res.url) {
      window.location.href = res.url
      return 'redirect'
    }
    setQr({ paymentId: res.paymentId, qrImage: res.qrImage, testUri: res.testUri })
    return 'qr'
  }

  const qrModal = qr && (
    <QrModal
      {...qr}
      onDone={handleDone}
      onClose={() => setQr(null)}
    />
  )

  return { pay, qrModal }
}
