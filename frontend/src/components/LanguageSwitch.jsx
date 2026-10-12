import { LOCALES, useI18n } from '../i18n.jsx'
import Icon from './Icon.jsx'

// Compact EN / ไทย toggle used on the auth pages and in the top bar.
export default function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n()
  return (
    <div className="lang-switch" role="group" aria-label={t('top.language')}>
      <Icon name="language" size={18} />
      {LOCALES.map((l) => (
        <button key={l.code} type="button" aria-pressed={locale === l.code} onClick={() => setLocale(l.code)}>
          {l.code === 'en' ? 'EN' : 'ไทย'}
        </button>
      ))}
    </div>
  )
}
