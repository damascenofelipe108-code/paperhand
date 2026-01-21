import { useState } from 'react'
import { Target, Eye, EyeOff, LogIn } from 'lucide-react'

const API_URL = '/api'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao entrar')
      }

      // Salva token no localStorage
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))

      // Chama callback de login
      onLogin(data.user, data.token)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center mx-auto mb-4">
            <Target size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-primary">PAPER HANDS</h1>
          <p className="text-muted mt-2">Aprenda com seus trades não feitos</p>
        </div>

        {/* Card de Login */}
        <div className="bg-secondary rounded-2xl p-8 border border-theme">
          <h2 className="text-xl font-semibold text-primary mb-6">Entrar</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Usuário */}
            <div>
              <label className="block text-sm text-secondary mb-2">Seu nome</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Digite seu nome"
                className="w-full bg-tertiary border border-theme rounded-lg px-4 py-3 text-primary placeholder:text-muted focus:outline-none focus:border-brand-500 transition"
                required
              />
            </div>

            {/* Senha */}
            <div>
              <label className="block text-sm text-secondary mb-2">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite a senha"
                  className="w-full bg-tertiary border border-theme rounded-lg px-4 py-3 pr-12 text-primary placeholder:text-muted focus:outline-none focus:border-brand-500 transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-secondary transition"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {/* Erro */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-500 text-sm">
                {error}
              </div>
            )}

            {/* Botão Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white font-medium py-3 rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn size={20} />
                  Entrar
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-muted text-sm mt-6">
          Rastreie tokens que você viu mas não comprou
        </p>
      </div>
    </div>
  )
}
