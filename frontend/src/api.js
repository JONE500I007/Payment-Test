import { translateError } from './i18n.jsx'

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(translateError(data.error || `Request failed (${res.status})`, res.status))
    err.status = res.status
    throw err
  }
  return data
}
