import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'
import { useToast } from '../components/Toast.jsx'
import Icon from '../components/Icon.jsx'
import Modal from '../components/Modal.jsx'

export default function Shop() {
  const { user, setCoins } = useAuth()
  const { t, num, itemName, itemDescription, category } = useI18n()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api('/shop/items').then(setData), [])
  useEffect(() => { load() }, [load])

  const buy = async () => {
    setBusy(true)
    try {
      const { coins } = await api(`/shop/items/${confirming.id}/buy`, { method: 'POST' })
      setCoins(coins)
      toast(t('shop.bought', { item: itemName(confirming.name) }))
      setConfirming(null)
      await load()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div className="splash inline"><span className="spinner" /></div>

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('shop.title')}</h1>
          <p className="muted">
            {t('shop.subtitle')}
            {data.discountPct > 0 && <> <b>{t('shop.saves', { pct: data.discountPct })}</b></>}
          </p>
        </div>
      </div>

      <div className="items">
        {data.items.map((item) => {
          const short = item.finalPrice > user.coins
          return (
            <article key={item.id} className={`item ${item.locked ? 'locked' : ''}`}>
              <div className="item-art"><Icon name={item.icon} size={40} /></div>
              <div className="item-body">
                <div className="item-meta">
                  <span className="chip soft">{category(item.category)}</span>
                  {item.requiredPlan && <span className="chip gold"><Icon name="lock" size={14} /> {item.requiredPlan}+</span>}
                </div>
                <h3>{itemName(item.name)}</h3>
                <p className="muted small">{itemDescription(item.name, item.description)}</p>
                <div className="item-foot">
                  <div className="item-price">
                    <Icon name="toll" fill size={18} /> {num(item.finalPrice)}
                    {item.finalPrice !== item.priceCoins && <s>{num(item.priceCoins)}</s>}
                  </div>
                  {item.owned ? (
                    <span className="chip ok"><Icon name="check" size={16} /> {t('shop.owned')}</span>
                  ) : item.locked ? (
                    <Link to="/plans" className="btn btn-sm btn-outline">{t('shop.unlock')}</Link>
                  ) : (
                    <button className="btn btn-sm btn-dark" disabled={short} title={short ? t('shop.notEnough') : undefined} onClick={() => setConfirming(item)}>
                      {t('shop.buy')}
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {confirming && (
        <Modal title={t('shop.confirmTitle')} onClose={() => !busy && setConfirming(null)}>
          <div className="checkout">
            <div className="confirm-item">
              <div className="item-art sm"><Icon name={confirming.icon} size={28} /></div>
              <div>
                <strong>{itemName(confirming.name)}</strong>
                <p className="muted small">{itemDescription(confirming.name, confirming.description)}</p>
              </div>
            </div>
            <div className="checkout-line"><span>{t('shop.price')}</span><strong>{t('coins.nCoins', { n: num(confirming.finalPrice) })}</strong></div>
            <div className="checkout-line"><span>{t('shop.balanceAfter')}</span><strong>{t('coins.nCoins', { n: num(user.coins - confirming.finalPrice) })}</strong></div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setConfirming(null)} disabled={busy}>{t('common.cancel')}</button>
              <button className="btn btn-dark" onClick={buy} disabled={busy}>
                {busy ? <span className="spinner sm" /> : t('shop.buyNow')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
