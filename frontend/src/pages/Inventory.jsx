import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import Icon from '../components/Icon.jsx'

export default function Inventory() {
  const { t, num, date, itemName, itemDescription, category } = useI18n()
  const [items, setItems] = useState(null)

  useEffect(() => { api('/shop/inventory').then((d) => setItems(d.items)) }, [])

  if (!items) return <div className="splash inline"><span className="spinner" /></div>

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('inv.title')}</h1>
          <p className="muted">{t('inv.subtitle')}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="card empty">
          <Icon name="inventory_2" size={36} />
          <p>{t('inv.empty')}</p>
          <Link to="/shop" className="btn btn-dark">{t('inv.browse')}</Link>
        </div>
      ) : (
        <div className="items">
          {items.map((item) => (
            <article key={item.id} className="item">
              <div className="item-art"><Icon name={item.icon} size={40} /></div>
              <div className="item-body">
                <div className="item-meta"><span className="chip soft">{category(item.category)}</span></div>
                <h3>{itemName(item.name)}</h3>
                <p className="muted small">{itemDescription(item.name, item.description)}</p>
                <div className="item-foot">
                  <small className="muted">{t('inv.bought', { date: date(item.createdAt) })}</small>
                  <small className="item-price"><Icon name="toll" fill size={16} /> {num(item.pricePaid)}</small>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
