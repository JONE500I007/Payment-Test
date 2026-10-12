import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import Icon from '../components/Icon.jsx'
import TxList from '../components/TxList.jsx'
import { MethodGlyph } from '../components/PaymentMethods.jsx'

const STATUS_CHIP = { paid: 'ok', pending: 'gold', failed: 'soft' }

export default function History() {
  const { t, money, dateTime, describe } = useI18n()
  const [tab, setTab] = useState('coins')
  const [transactions, setTransactions] = useState(null)
  const [payments, setPayments] = useState(null)

  useEffect(() => {
    api('/billing/transactions').then((d) => setTransactions(d.transactions))
    api('/billing/payments').then((d) => setPayments(d.payments))
  }, [])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('hist.title')}</h1>
          <p className="muted">{t('hist.subtitle')}</p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'coins'} onClick={() => setTab('coins')}><Icon name="toll" /> {t('hist.coins')}</button>
        <button role="tab" aria-selected={tab === 'payments'} onClick={() => setTab('payments')}><Icon name="receipt_long" /> {t('hist.payments')}</button>
      </div>

      <section className="card">
        {tab === 'coins' && (transactions ? <TxList transactions={transactions} /> : <span className="spinner" />)}
        {tab === 'payments' && (!payments ? <span className="spinner" /> : payments.length === 0 ? (
          <div className="empty"><Icon name="receipt_long" size={32} /><p>{t('hist.noPayments')}</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('hist.date')}</th><th>{t('hist.desc')}</th><th>{t('hist.type')}</th>
                  <th>{t('hist.method')}</th><th>{t('hist.status')}</th><th className="right">{t('hist.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{dateTime(p.createdAt)}</td>
                    <td>{describe(p.description)}</td>
                    <td><span className="chip soft">{t(p.kind === 'topup' ? 'hist.topup' : 'hist.subscription')}</span></td>
                    <td>
                      {p.provider === 'mock' ? <small className="muted">{t('hist.mock')}</small> : (
                        <span className="method-cell">
                          <MethodGlyph id={p.method ?? 'card'} size={16} />
                          {t(`pm.${p.method ?? 'card'}`)}
                        </span>
                      )}
                    </td>
                    <td><span className={`chip ${STATUS_CHIP[p.status]}`}>{t(`hist.${p.status}`)}</span></td>
                    <td className="right"><strong>{money(p.amount, p.currency)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </>
  )
}
