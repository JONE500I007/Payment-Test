import Icon from './Icon.jsx'
import { useI18n } from '../i18n.jsx'

export default function PaymentsOffBanner() {
  const { t } = useI18n()
  return (
    <div className="sub-banner warn">
      <Icon name="credit_card_off" />
      <span className="sub-text">{t('pay.off')}</span>
    </div>
  )
}
