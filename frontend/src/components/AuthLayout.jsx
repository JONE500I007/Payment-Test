import Icon from './Icon.jsx'
import { Logo } from './Layout.jsx'
import LanguageSwitch from './LanguageSwitch.jsx'
import { useI18n } from '../i18n.jsx'

const perks = [
  { icon: 'workspace_premium', key: 'auth.perk1' },
  { icon: 'toll', key: 'auth.perk2' },
  { icon: 'storefront', key: 'auth.perk3' },
]

export default function AuthLayout({ title, subtitle, children }) {
  const { t } = useI18n()
  return (
    <div className="auth-page">
      <div className="auth-frame">
        <section className="auth-brand">
          <Logo />
          <div>
            <h2>{t('auth.brandTitle')}</h2>
            <ul className="perks">
              {perks.map((p) => (
                <li key={p.key}>
                  <span className="perk-icon"><Icon name={p.icon} /></span>
                  <div>
                    <strong>{t(`${p.key}.title`)}</strong>
                    <p>{t(`${p.key}.text`)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="muted small"><Icon name="lock" size={16} /> {t('auth.secure')}</p>
        </section>
        <section className="auth-form-wrap">
          <div className="auth-lang"><LanguageSwitch /></div>
          <div className="auth-form">
            <h1>{title}</h1>
            <p className="muted">{subtitle}</p>
            {children}
          </div>
        </section>
      </div>
    </div>
  )
}
