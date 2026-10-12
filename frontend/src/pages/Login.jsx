import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'
import AuthLayout from '../components/AuthLayout.jsx'
import Icon from '../components/Icon.jsx'

export default function Login() {
  const { login } = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('login.title')} subtitle={t('login.subtitle')}>
      <form onSubmit={submit} className="form">
        {error && <div className="alert"><Icon name="error" /> {error}</div>}
        <label className="field">
          <span>{t('field.email')}</span>
          <div className="input">
            <Icon name="mail" />
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
          </div>
        </label>
        <label className="field">
          <span>{t('field.password')}</span>
          <div className="input">
            <Icon name="lock" />
            <input type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder={t('ph.password')} />
            <button type="button" className="icon-btn ghost" onClick={() => setShowPw((s) => !s)} aria-label={t(showPw ? 'pw.hide' : 'pw.show')}>
              <Icon name={showPw ? 'visibility_off' : 'visibility'} />
            </button>
          </div>
        </label>
        <button className="btn btn-dark btn-block btn-lg" disabled={busy}>
          {busy ? <span className="spinner sm" /> : t('login.submit')}
        </button>
      </form>
      <p className="switch">{t('login.new')} <Link to="/register">{t('login.create')}</Link></p>
    </AuthLayout>
  )
}
