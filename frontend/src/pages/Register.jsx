import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'
import AuthLayout from '../components/AuthLayout.jsx'
import Icon from '../components/Icon.jsx'

export default function Register() {
  const { register } = useAuth()
  const { t, locale, currency } = useI18n()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const strength = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(form.password)).length

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) return setError(t('err.passwordMismatch'))
    setBusy(true)
    try {
      await register(form.name, form.email, form.password, { locale, currency })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('register.title')} subtitle={t('register.subtitle')}>
      <form onSubmit={submit} className="form">
        {error && <div className="alert"><Icon name="error" /> {error}</div>}
        <label className="field">
          <span>{t('field.name')}</span>
          <div className="input">
            <Icon name="person" />
            <input autoComplete="name" value={form.name} onChange={set('name')} required minLength={2} placeholder={t('ph.name')} />
          </div>
        </label>
        <label className="field">
          <span>{t('field.email')}</span>
          <div className="input">
            <Icon name="mail" />
            <input type="email" autoComplete="email" value={form.email} onChange={set('email')} required placeholder="you@example.com" />
          </div>
        </label>
        <label className="field">
          <span>{t('field.password')}</span>
          <div className="input">
            <Icon name="lock" />
            <input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} placeholder={t('ph.newPassword')} />
            <button type="button" className="icon-btn ghost" onClick={() => setShowPw((s) => !s)} aria-label={t(showPw ? 'pw.hide' : 'pw.show')}>
              <Icon name={showPw ? 'visibility_off' : 'visibility'} />
            </button>
          </div>
          <div className="strength" data-level={strength} aria-hidden="true"><i /><i /><i /><i /></div>
        </label>
        <label className="field">
          <span>{t('field.confirmPassword')}</span>
          <div className="input">
            <Icon name="lock_reset" />
            <input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required placeholder={t('ph.confirm')} />
          </div>
        </label>
        <button className="btn btn-dark btn-block btn-lg" disabled={busy}>
          {busy ? <span className="spinner sm" /> : t('register.submit')}
        </button>
      </form>
      <p className="switch">{t('register.have')} <Link to="/login">{t('register.signin')}</Link></p>
    </AuthLayout>
  )
}
