import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { CURRENCIES, LOCALES, translate, translateError, useI18n } from '../i18n.jsx'
import { useToast } from '../components/Toast.jsx'
import Icon from '../components/Icon.jsx'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'

const AVATAR_SIZE = 256

// Center-crops the picked image to a square and shrinks it so uploads stay small.
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = AVATAR_SIZE
      canvas.getContext('2d').drawImage(
        img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE,
      )
      URL.revokeObjectURL(img.src)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('bad-image'))), 'image/webp', 0.9)
    }
    img.onerror = () => reject(new Error('bad-image'))
    img.src = URL.createObjectURL(file)
  })
}

function Section({ icon, title, description, children }) {
  return (
    <section className="card settings-section">
      <div className="settings-intro">
        <span className="settings-icon"><Icon name={icon} /></span>
        <div>
          <h2>{title}</h2>
          <p className="muted small">{description}</p>
        </div>
      </div>
      <div className="settings-body">{children}</div>
    </section>
  )
}

function Field({ label, icon, hint, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input">
        <Icon name={icon} />
        <input {...props} />
      </div>
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

function Segmented({ label, options, value, onChange, disabled }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value} type="button" role="radio" aria-checked={value === o.value}
            disabled={disabled} onClick={() => value !== o.value && onChange(o.value)}
          >
            {o.icon && <span className="seg-flag">{o.icon}</span>}{o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PreferencesSection({ subscription }) {
  const { t, locale, currency, setLocale, setCurrency } = useI18n()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  // `savedIn` picks the language for the confirmation, so switching to Thai confirms in Thai.
  const change = (fn, savedIn) => async (value) => {
    setBusy(true)
    try {
      await fn(value)
      toast(translate(savedIn(value), 'set.saved'))
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const locked = subscription?.managedByStripe && subscription.currency !== currency
  return (
    <Section icon="translate" title={t('set.prefs')} description={t('set.prefsDesc')}>
      <div className="form-row">
        <Segmented
          label={t('set.language')} value={locale} disabled={busy} onChange={change(setLocale, (value) => value)}
          options={LOCALES.map((l) => ({ value: l.code, label: l.label, icon: l.code === 'th' ? 'TH' : 'EN' }))}
        />
        <Segmented
          label={t('set.currency')} value={currency} disabled={busy} onChange={change(setCurrency, () => locale)}
          options={CURRENCIES.map((c) => ({ value: c, label: t(`set.${c}`), icon: c === 'thb' ? '฿' : '$' }))}
        />
      </div>
      {locked && (
        <p className="muted small"><Icon name="info" size={16} /> {t('set.currencyNote', { currency: subscription.currency.toUpperCase() })}</p>
      )}
    </Section>
  )
}

function ProfileSection() {
  const { user, setUser } = useAuth()
  const { t } = useI18n()
  const toast = useToast()
  const fileRef = useRef(null)
  const [form, setForm] = useState({ name: user.name, email: user.email, currentPassword: '' })
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const emailChanged = form.email.trim().toLowerCase() !== user.email
  const dirty = form.name.trim() !== user.name || emailChanged
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { user: updated } = await api('/profile', { method: 'PATCH', body: form })
      setUser(updated)
      setForm({ name: updated.name, email: updated.email, currentPassword: '' })
      toast(t('set.profileSaved'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const pickAvatar = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const blob = await resizeImage(file).catch(() => { throw new Error(t('set.badImage')) })
      const res = await fetch('/api/profile/avatar', { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ? translateError(data.error, res.status) : t('set.uploadFailed'))
      setUser(data.user)
      toast(t('set.photoUpdated'))
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  const removeAvatar = async () => {
    const { user: updated } = await api('/profile/avatar', { method: 'DELETE' })
    setUser(updated)
    toast(t('set.photoRemoved'))
  }

  return (
    <Section icon="person" title={t('set.profile')} description={t('set.profileDesc')}>
      <div className="avatar-row">
        <Avatar user={user} size={72} />
        <div className="avatar-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => fileRef.current.click()} disabled={uploading}>
            {uploading ? <span className="spinner sm dark" /> : <><Icon name="upload" size={18} /> {t('set.upload')}</>}
          </button>
          {user.avatarUrl && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={removeAvatar}>{t('set.remove')}</button>
          )}
          <small className="muted">{t('set.photoHint')}</small>
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickAvatar} />
      </div>
      <form className="form compact" onSubmit={save}>
        {error && <div className="alert"><Icon name="error" /> {error}</div>}
        <div className="form-row">
          <Field label={t('field.name')} icon="badge" value={form.name} onChange={set('name')} required minLength={2} autoComplete="name" />
          <Field label={t('field.email')} icon="mail" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </div>
        {emailChanged && (
          <Field
            label={t('set.currentPassword')} icon="lock" type="password" value={form.currentPassword}
            onChange={set('currentPassword')} required autoComplete="current-password"
            hint={t('set.emailPwHint')}
          />
        )}
        <div className="form-actions">
          <button className="btn btn-dark" disabled={!dirty || busy}>
            {busy ? <span className="spinner sm" /> : t('set.save')}
          </button>
        </div>
      </form>
    </Section>
  )
}

function PasswordSection() {
  const { t } = useI18n()
  const toast = useToast()
  const empty = { currentPassword: '', newPassword: '', confirm: '' }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    setError('')
    if (form.newPassword !== form.confirm) return setError(t('set.pwMismatch'))
    setBusy(true)
    try {
      await api('/profile/password', { method: 'POST', body: form })
      setForm(empty)
      toast(t('set.pwChanged'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section icon="key" title={t('set.password')} description={t('set.passwordDesc')}>
      <form className="form compact" onSubmit={save}>
        {error && <div className="alert"><Icon name="error" /> {error}</div>}
        <Field label={t('set.currentPassword')} icon="lock" type="password" value={form.currentPassword} onChange={set('currentPassword')} required autoComplete="current-password" />
        <div className="form-row">
          <Field label={t('set.newPassword')} icon="lock_reset" type="password" value={form.newPassword} onChange={set('newPassword')} required minLength={8} autoComplete="new-password" hint={t('set.min8')} />
          <Field label={t('set.confirmNew')} icon="lock_reset" type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
        </div>
        <div className="form-actions">
          <button className="btn btn-dark" disabled={busy || !form.currentPassword || !form.newPassword}>
            {busy ? <span className="spinner sm" /> : t('set.updatePassword')}
          </button>
        </div>
      </form>
    </Section>
  )
}

function BillingSection({ subscription: sub }) {
  const { t, money, date } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [opening, setOpening] = useState(false)

  const openPortal = async () => {
    setOpening(true)
    try {
      const { url } = await api('/billing/portal', { method: 'POST' })
      window.location.href = url
    } catch (err) {
      toast(err.message, 'error')
      setOpening(false)
    }
  }

  return (
    <Section icon="credit_card" title={t('set.billing')} description={t('set.billingDesc')}>
      <div className="billing-row">
        <div>
          <small className="muted">{t('set.currentPlan')}</small>
          <strong>
            {sub === undefined ? '…' : sub
              ? t('set.planLine', { plan: sub.planName, price: money(sub.price, sub.currency) })
              : t('common.free')}
          </strong>
          {sub && <small className="muted">{t(sub.cancelAtPeriodEnd ? 'ov.ends' : 'ov.renews', { date: date(sub.currentPeriodEnd) })}</small>}
        </div>
        <button className="btn btn-sm btn-outline" onClick={() => navigate('/plans')}>{t('set.changePlan')}</button>
      </div>
      <div className="billing-row">
        <div>
          <strong>{t('set.manage')}</strong>
          <small className="muted">{t('set.manageDesc')}</small>
        </div>
        <button className="btn btn-sm btn-dark" onClick={openPortal} disabled={opening}>
          {opening ? <span className="spinner sm" /> : <><Icon name="open_in_new" size={18} /> {t('set.open')}</>}
        </button>
      </div>
    </Section>
  )
}

function DangerSection() {
  const { setUser } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const remove = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/profile', { method: 'DELETE', body: { password } })
      setUser(null)
      navigate('/register')
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Section icon="warning" title={t('set.delete')} description={t('set.deleteDesc')}>
      <div className="billing-row">
        <small className="muted">{t('set.deleteWarn')}</small>
        <button className="btn btn-sm btn-danger" onClick={() => setOpen(true)}>{t('set.delete')}</button>
      </div>
      {open && (
        <Modal title={t('set.deleteTitle')} onClose={() => !busy && setOpen(false)}>
          <form className="form compact" onSubmit={remove}>
            <p className="muted small">{t('set.deleteBody')}</p>
            {error && <div className="alert"><Icon name="error" /> {error}</div>}
            <Field label={t('field.password')} icon="lock" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" autoFocus />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)} disabled={busy}>{t('common.cancel')}</button>
              <button className="btn btn-danger" disabled={busy || !password}>
                {busy ? <span className="spinner sm" /> : t('set.deleteForever')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Section>
  )
}

export default function Settings() {
  const { t } = useI18n()
  const [subscription, setSubscription] = useState(undefined)

  useEffect(() => { api('/billing/subscription').then((d) => setSubscription(d.subscription)) }, [])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('set.title')}</h1>
          <p className="muted">{t('set.subtitle')}</p>
        </div>
      </div>
      <div className="settings">
        <PreferencesSection subscription={subscription} />
        <ProfileSection />
        <PasswordSection />
        <BillingSection subscription={subscription} />
        <DangerSection />
      </div>
    </>
  )
}
