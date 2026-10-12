import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Overview from './pages/Overview.jsx'
import Plans from './pages/Plans.jsx'
import Coins from './pages/Coins.jsx'
import Shop from './pages/Shop.jsx'
import Inventory from './pages/Inventory.jsx'
import History from './pages/History.jsx'
import Settings from './pages/Settings.jsx'
import PaymentReturn from './pages/PaymentReturn.jsx'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="splash"><span className="spinner" /></div>
  return user ? children : <Navigate to="/login" replace />
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="splash"><span className="spinner" /></div>
  return user ? <Navigate to="/" replace /> : children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="plans" element={<Plans />} />
        <Route path="coins" element={<Coins />} />
        <Route path="shop" element={<Shop />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="history" element={<History />} />
        <Route path="settings" element={<Settings />} />
        <Route path="payment/return" element={<PaymentReturn />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
