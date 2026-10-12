import Icon from './Icon.jsx'
import { useI18n } from '../i18n.jsx'

const typeIcon = {
  topup: 'add_card',
  subscription_bonus: 'workspace_premium',
  purchase: 'shopping_bag',
  welcome: 'celebration',
}

export default function TxList({ transactions }) {
  const { t, num, dateTime, describe } = useI18n()
  if (!transactions.length) {
    return <div className="empty"><Icon name="receipt_long" size={32} /><p>{t('tx.empty')}</p></div>
  }
  return (
    <ul className="tx-list">
      {transactions.map((tx) => (
        <li key={tx.id}>
          <span className={`tx-icon ${tx.amount < 0 ? 'neg' : 'pos'}`}><Icon name={typeIcon[tx.type]} /></span>
          <div className="tx-main">
            <strong>{describe(tx.description)}</strong>
            <small>{dateTime(tx.createdAt)}</small>
          </div>
          <div className="tx-amount">
            <strong className={tx.amount < 0 ? 'neg' : 'pos'}>{tx.amount > 0 ? '+' : ''}{num(tx.amount)}</strong>
            <small>{t('tx.balance', { n: num(tx.balanceAfter) })}</small>
          </div>
        </li>
      ))}
    </ul>
  )
}
