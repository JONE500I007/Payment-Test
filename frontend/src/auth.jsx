import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { user } = await api('/auth/me')
      setUser(user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = async (email, password) => {
    const { user } = await api('/auth/login', { method: 'POST', body: { email, password } })
    setUser(user)
  }

  // prefs = { locale, currency } the visitor picked before signing up.
  const register = async (name, email, password, prefs) => {
    const { user } = await api('/auth/register', { method: 'POST', body: { name, email, password, ...prefs } })
    setUser(user)
  }

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' })
    setUser(null)
  }

  const setCoins = (coins) => setUser((u) => (u ? { ...u, coins } : u))

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh, setCoins, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
