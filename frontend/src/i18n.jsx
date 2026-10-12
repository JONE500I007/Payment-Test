import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './auth.jsx'
import { en, th } from './locales.js'
import { api } from './api.js'

const dictionaries = { en, th }
export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'th', label: 'ไทย' },
]
export const CURRENCIES = ['usd', 'thb']

const STORAGE_KEY = 'coinly.prefs'

function readGuestPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (saved?.locale && saved?.currency) return saved
  } catch { /* storage unavailable */ }
  const thai = navigator.language?.toLowerCase().startsWith('th')
  return { locale: thai ? 'th' : 'en', currency: thai ? 'thb' : 'usd' }
}

function saveGuestPrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)) } catch { /* storage unavailable */ }
}

// The locale API errors are translated into; kept in sync by I18nProvider.
let activeLocale = 'en'

function lookup(locale, key) {
  return dictionaries[locale]?.[key] ?? dictionaries.en[key]
}

function interpolate(text, vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`)) : text
}

// Translate outside React state, e.g. into a language that was just selected.
export const translate = (locale, key, vars) => interpolate(lookup(locale, key) ?? key, vars)

// Server error messages are English; show the translated version when we have one.
export function translateError(message, status) {
  if (status === 429) return lookup(activeLocale, 'err.tooMany')
  return dictionaries[activeLocale]?.errors?.[message] ?? message
}

export function formatters(locale) {
  const numberTag = locale === 'th' ? 'th-TH' : 'en-US'
  const dateTag = locale === 'th' ? 'th-TH' : 'en-GB'
  return {
    num: (n) => new Intl.NumberFormat(numberTag).format(n),
    // Amounts are in minor units (cents / satang).
    money: (amount, currency) => new Intl.NumberFormat(numberTag, {
      style: 'currency',
      currency: currency.toUpperCase(),
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount / 100),
    date: (iso) => new Date(iso).toLocaleDateString(dateTag, { day: 'numeric', month: 'short', year: 'numeric' }),
    dateTime: (iso) => new Date(iso).toLocaleString(dateTag, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  }
}

// Coin ledger / payment descriptions are stored in English; rebuild them in the active language.
const DESCRIPTION_PATTERNS = [
  [/^Welcome bonus$/, 'desc.welcome'],
  [/^Top up ([\d,]+) coins$/, 'desc.topup', ['n']],
  [/^(.+) monthly coins$/, 'desc.monthly', ['plan']],
  [/^Upgrade to (.+) bonus coins$/, 'desc.upgradeBonus', ['plan']],
  [/^Bought (.+)$/, 'desc.bought', ['item']],
  [/^(.+) plan 30-day pass$/, 'desc.pass', ['plan']],
  [/^(.+) plan subscription$/, 'desc.subscription', ['plan']],
  [/^(.+) plan renewal$/, 'desc.renewal', ['plan']],
  [/^(.+) plan change$/, 'desc.change', ['plan']],
]

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const { user, setUser } = useAuth()
  const [guest, setGuest] = useState(readGuestPrefs)

  // Signed-in users carry their preferences on the account; guests keep them in the browser.
  const locale = user?.locale ?? guest.locale
  const currency = user?.currency ?? guest.currency
  activeLocale = locale

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const updatePrefs = useCallback(async (changes) => {
    const next = { locale, currency, ...changes }
    setGuest(next)
    saveGuestPrefs(next)
    if (user) {
      const { user: updated } = await api('/profile/preferences', { method: 'PATCH', body: changes })
      setUser(updated)
    }
  }, [locale, currency, user, setUser])

  const value = useMemo(() => {
    const t = (key, vars) => translate(locale, key, vars)
    const items = dictionaries[locale].items ?? {}
    return {
      locale,
      currency,
      t,
      // Switching language also switches to that language's currency (ไทย → THB, English → USD);
      // the currency can still be changed on its own in Settings.
      setLocale: (code) => updatePrefs({ locale: code, currency: code === 'th' ? 'thb' : 'usd' }),
      setCurrency: (code) => updatePrefs({ currency: code }),
      ...formatters(locale),
      itemName: (name) => items[name]?.name ?? name,
      itemDescription: (name, fallback) => items[name]?.description ?? fallback,
      category: (name) => lookup(locale, `cat.${name}`) ?? name,
      planDescription: (code, fallback) => lookup(locale, `plan.${code}.desc`) ?? fallback,
      describe: (text) => {
        if (locale === 'en') return text
        for (const [re, key, names = []] of DESCRIPTION_PATTERNS) {
          const m = text.match(re)
          if (!m) continue
          const vars = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]))
          if (vars.item) vars.item = items[vars.item]?.name ?? vars.item
          return t(key, vars)
        }
        return text
      },
    }
  }, [locale, currency, updatePrefs])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useI18n = () => useContext(I18nContext)
