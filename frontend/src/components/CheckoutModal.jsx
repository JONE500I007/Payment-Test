import { useCallback, useState } from 'react'
import Modal from './Modal.jsx'
import Icon from './Icon.jsx'
import PaymentMethods from './PaymentMethods.jsx'
import { useI18n } from '../i18n.jsx'

// Order summary + (optionally) a payment method picker.
// `total` is { amount, currency } in minor units, or omitted when the provider calculates it (proration).
// With `purpose` set, the picker is shown and onConfirm receives the chosen method id.
export default function CheckoutModal({ title, lines, total, note, secureNote, confirmLabel, purpose, onConfirm, onClose }) {
  const { t, money } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [method, setMethod] = useState(null)
  const onMethodChange = useCallback((id) => setMethod(id), [])

  const pay = async () => {
    setBusy(true)
    setError('')
    try {
      // Redirecting away keeps the spinner up; a QR or an error hands control back.
      if ((await onConfirm(method)) !== 'redirect') setBusy(false)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={title} wide={!!purpose} onClose={busy ? () => {} : onClose}>
      <div className="checkout">
        {lines.map(([label, value]) => (
          <div className="checkout-line" key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
        {total && (
          <div className="checkout-line total"><span>{t('checkout.total')}</span><strong>{money(total.amount, total.currency)}</strong></div>
        )}
        {note && <p className="muted small">{note}</p>}
        {purpose && (
          <>
            <span className="checkout-label">{t('checkout.method')}</span>
            <PaymentMethods purpose={purpose} value={method} onChange={onMethodChange} />
          </>
        )}
        <div className="secure-note">
          <Icon name="verified_user" />
          <span>{secureNote ?? t('checkout.secure')}</span>
        </div>
        {error && <div className="alert"><Icon name="error" /> {error}</div>}
        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="btn btn-dark" onClick={pay} disabled={busy || (purpose && !method)}>
            {busy ? <span className="spinner sm" /> : <><Icon name="lock" size={18} /> {confirmLabel}</>}
          </button>
        </div>
      </div>
    </Modal>
  )
}
