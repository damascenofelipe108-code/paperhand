import { useState, useEffect } from 'react'
import {
  TrendingUp,
  TrendingDown,
  Eye,
  Target,
  Settings,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  BarChart3,
  Clock,
  Layers,
  Trash2,
  Sun,
  Moon,
  Monitor,
  LogOut
} from 'lucide-react'
import Login from './pages/Login'

const API_URL = '/api'

// Helper para fazer requisições autenticadas
function getAuthHeaders() {
  const token = localStorage.getItem('token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  }
}

async function fetchAuth(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers
    }
  })

  // Se receber 401, limpa token e recarrega
  if (response.status === 401) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    window.location.reload()
    throw new Error('Sessão expirada')
  }

  return response
}

// Componente de Card de Estatística
function StatCard({ title, value, subtitle, icon: Icon, color = 'brand', trend }) {
  const colorClasses = {
    brand: 'bg-brand-500/10 text-brand-500',
    red: 'bg-red-500/10 text-red-500',
    yellow: 'bg-yellow-500/10 text-yellow-500',
    blue: 'bg-blue-500/10 text-blue-500'
  }

  return (
    <div className="bg-secondary rounded-xl p-5 border border-theme">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-secondary text-sm">{title}</p>
          <p className="text-2xl font-bold mt-1 text-primary">{value}</p>
          {subtitle && <p className="text-muted text-sm mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          <Icon size={20} />
        </div>
      </div>
      {trend !== undefined && (
        <div className={`flex items-center mt-3 text-sm ${trend >= 0 ? 'text-brand-500' : 'text-red-500'}`}>
          {trend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          <span className="ml-1">{trend >= 0 ? '+' : ''}{trend}% vs ontem</span>
        </div>
      )}
    </div>
  )
}

// Componente de Lista de Tokens
function TokenList({ tokens, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="animate-spin text-muted" />
      </div>
    )
  }

  if (!tokens || tokens.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <Eye size={48} className="mx-auto mb-4 opacity-50" />
        <p>Nenhum token rastreado ainda</p>
        <p className="text-sm mt-2">Navegue na Axiom, GMGN ou DexScreener com a extensão ativa</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-left text-secondary text-sm border-b border-theme">
            <th className="pb-3 font-medium">Token</th>
            <th className="pb-3 font-medium">Chain</th>
            <th className="pb-3 font-medium">MC quando viu</th>
            <th className="pb-3 font-medium">PNL</th>
            <th className="pb-3 font-medium">Variação</th>
            <th className="pb-3 font-medium">Status</th>
            <th className="pb-3 font-medium">Quando</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => {
            const change = Number(token.price_change_percent) || 0
            const isPositive = change >= 0
            const isBigWin = change > 100
            const isRug = change < -90

            return (
              <tr key={token.id} className="border-b border-theme opacity-row hover:bg-hover">
                <td className="py-4">
                  <div>
                    <a
                      href={getTokenUrl(token)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:text-brand-500 cursor-pointer transition"
                    >
                      {token.name || token.symbol || truncateAddress(token.contract_address)}
                    </a>
                  </div>
                  <span className="text-muted text-xs">{truncateAddress(token.contract_address)}</span>
                </td>
                <td className="py-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getChainColor(token.chain)}`}>
                    {token.chain?.toUpperCase()}
                  </span>
                </td>
                <td className="py-4 text-secondary">
                  {formatMcap(token.mcap_when_viewed)}
                </td>
                <td className="py-4">
                  {token.pnl_sol !== undefined && token.pnl_sol !== null ? (
                    <span className={`font-medium ${Number(token.pnl_sol) >= 0 ? 'text-brand-500' : 'text-red-500'}`}>
                      {Number(token.pnl_sol) >= 0 ? '+' : ''}{Number(token.pnl_sol).toFixed(3)} {token.pnl_currency || 'SOL'}
                    </span>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td className="py-4">
                  <span className={`font-medium ${isPositive ? 'text-brand-500' : 'text-red-500'}`}>
                    {isPositive ? '+' : ''}{change.toFixed(1)}%
                  </span>
                </td>
                <td className="py-4">
                  {token.bought ? (
                    <span className="flex items-center text-brand-500">
                      <CheckCircle size={16} className="mr-1" /> Comprou
                    </span>
                  ) : isBigWin ? (
                    <span className="flex items-center text-red-500">
                      <XCircle size={16} className="mr-1" /> Perdeu {change.toFixed(0)}%
                    </span>
                  ) : isRug ? (
                    <span className="flex items-center text-brand-500">
                      <CheckCircle size={16} className="mr-1" /> Evitou rug
                    </span>
                  ) : (
                    <span className="flex items-center text-muted">
                      <AlertCircle size={16} className="mr-1" /> Não comprou
                    </span>
                  )}
                </td>
                <td className="py-4 text-muted text-sm">
                  {formatDate(token.viewed_at)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Componente de Padrões
function PatternsCard({ patterns }) {
  if (!patterns || patterns.length === 0) {
    return (
      <div className="bg-secondary rounded-xl p-5 border border-theme">
        <h3 className="font-semibold mb-4 flex items-center text-primary">
          <BarChart3 className="mr-2 text-brand-500" size={20} />
          Padrões Identificados
        </h3>
        <p className="text-muted text-center py-8">
          Precisa de mais dados para identificar padrões
        </p>
      </div>
    )
  }

  return (
    <div className="bg-secondary rounded-xl p-5 border border-theme">
      <h3 className="font-semibold mb-4 flex items-center text-primary">
        <BarChart3 className="mr-2 text-brand-500" size={20} />
        Padrões Identificados
      </h3>
      <div className="space-y-4">
        {patterns.map((pattern, i) => (
          <div key={i} className="p-4 bg-tertiary rounded-lg">
            <div className="flex items-start">
              {pattern.type === 'chain' && <Layers className="text-blue-500 mr-3 mt-0.5" size={18} />}
              {pattern.type === 'hour' && <Clock className="text-yellow-500 mr-3 mt-0.5" size={18} />}
              {pattern.type === 'mcap' && <Target className="text-purple-500 mr-3 mt-0.5" size={18} />}
              {pattern.type === 'source' && <Eye className="text-brand-500 mr-3 mt-0.5" size={18} />}
              <div>
                <p className="text-sm text-primary">{pattern.message}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Componente de Configurações
function SettingsModal({ isOpen, onClose, settings, onSave }) {
  const [solanaWallet, setSolanaWallet] = useState('')
  const [evmWallet, setEvmWallet] = useState('')
  const [saving, setSaving] = useState(false)

  // Atualiza os campos quando o modal abre ou settings mudam
  useEffect(() => {
    if (isOpen) {
      setSolanaWallet(settings?.wallets?.solana || '')
      setEvmWallet(settings?.wallets?.evm || '')
    }
  }, [isOpen, settings])

  const handleSave = async () => {
    setSaving(true)
    await onSave({
      wallets: {
        solana: solanaWallet,
        evm: evmWallet
      }
    })
    setSaving(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-secondary rounded-xl p-6 w-full max-w-md border border-theme my-8">
        <h2 className="text-xl font-bold mb-6 flex items-center text-primary">
          <Settings className="mr-2" size={24} />
          Configurações
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-secondary mb-2">Wallet Solana</label>
            <input
              type="text"
              value={solanaWallet}
              onChange={(e) => setSolanaWallet(e.target.value)}
              placeholder="Seu endereço Solana"
              className="w-full bg-tertiary border border-theme rounded-lg px-4 py-3 text-primary focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-sm text-secondary mb-2">Wallet EVM (Base, BSC, ETH)</label>
            <input
              type="text"
              value={evmWallet}
              onChange={(e) => setEvmWallet(e.target.value)}
              placeholder="Seu endereço 0x..."
              className="w-full bg-tertiary border border-theme rounded-lg px-4 py-3 text-primary focus:outline-none focus:border-brand-500"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-tertiary text-primary rounded-lg hover:bg-hover transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-3 bg-brand-500 rounded-lg hover:bg-brand-600 transition font-medium disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Funções auxiliares
function truncateAddress(address) {
  if (!address) return '???'
  return address.slice(0, 6) + '...' + address.slice(-4)
}

function formatPrice(price) {
  const num = Number(price)
  if (!num || isNaN(num)) return '-'
  if (num < 0.00001) return `$${num.toExponential(2)}`
  if (num < 0.01) return `$${num.toFixed(6)}`
  if (num < 1) return `$${num.toFixed(4)}`
  return `$${num.toFixed(2)}`
}

function formatMcap(mcap) {
  const num = Number(mcap)
  if (!num || isNaN(num)) return '-'
  if (num >= 1000000000) return `$${(num / 1000000000).toFixed(2)}B`
  if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`
  return `$${num.toFixed(0)}`
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  // Garante que o timestamp seja interpretado como UTC
  const date = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z')
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(Math.abs(diffMs) / 60000)
  const diffHours = Math.floor(Math.abs(diffMs) / 3600000)
  const diffDays = Math.floor(Math.abs(diffMs) / 86400000)

  // Se for no futuro ou muito recente, mostra "agora"
  if (diffMs < 0 || diffMins < 1) return 'agora'
  if (diffMins < 60) return `${diffMins}m atrás`
  if (diffHours < 24) return `${diffHours}h atrás`
  if (diffDays < 7) return `${diffDays}d atrás`
  return date.toLocaleDateString('pt-BR')
}

function getChainColor(chain) {
  const colors = {
    solana: 'bg-purple-500/20 text-purple-400',
    base: 'bg-blue-500/20 text-blue-400',
    bsc: 'bg-yellow-500/20 text-yellow-400',
    eth: 'bg-gray-500/20 text-gray-400'
  }
  return colors[chain] || 'bg-gray-500/20 text-gray-400'
}

function getTokenUrl(token) {
  const contract = token.contract_address
  const chain = token.chain?.toLowerCase()

  if (chain === 'solana') {
    return `https://axiom.trade/meme/${contract}`
  }
  if (chain === 'base') {
    return `https://gmgn.ai/base/token/${contract}`
  }
  if (chain === 'bsc') {
    return `https://gmgn.ai/bsc/token/${contract}`
  }
  if (chain === 'eth') {
    return `https://dexscreener.com/ethereum/${contract}`
  }
  return `https://dexscreener.com/${chain}/${contract}`
}

function formatNumber(num) {
  const n = Number(num) || 0
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toFixed(0)
}

// Formata lucro perdido em moeda nativa
function formatMissedProfit(missedProfit) {
  if (!missedProfit) return '0'

  // Prioriza mostrar a moeda com maior valor
  const SOL = Number(missedProfit.SOL) || 0
  const ETH = Number(missedProfit.ETH) || 0
  const BNB = Number(missedProfit.BNB) || 0

  if (SOL > 0 && SOL >= ETH && SOL >= BNB) {
    return `${SOL.toFixed(2)} SOL`
  }
  if (ETH > 0 && ETH >= SOL && ETH >= BNB) {
    return `${ETH.toFixed(4)} ETH`
  }
  if (BNB > 0) {
    return `${BNB.toFixed(4)} BNB`
  }

  return '0'
}

// App Principal
export default function App() {
  // Auth state
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })
  const [token, setToken] = useState(() => localStorage.getItem('token'))

  const [stats, setStats] = useState(null)
  const [tokens, setTokens] = useState([])
  const [patterns, setPatterns] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [activeTab, setActiveTab] = useState('all')
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'default'
  })

  // Login handler
  const handleLogin = (userData, authToken) => {
    setUser(userData)
    setToken(authToken)
  }

  // Logout handler
  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
    setToken(null)
  }

  // Se não está logado, mostra tela de login
  if (!user || !token) {
    return <Login onLogin={handleLogin} />
  }

  // Aplica tema ao documento
  useEffect(() => {
    if (theme === 'default') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  // Cicla entre os temas
  const cycleTheme = () => {
    setTheme(current => {
      if (current === 'default') return 'light'
      if (current === 'light') return 'dark'
      return 'default'
    })
  }

  // Ícone do tema atual
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  // Fetch dados
  const fetchData = async () => {
    try {
      const [statsRes, tokensRes, patternsRes, settingsRes] = await Promise.all([
        fetchAuth(`${API_URL}/stats`),
        fetchAuth(`${API_URL}/tokens/recent?limit=50`),
        fetchAuth(`${API_URL}/analysis/patterns`),
        fetchAuth(`${API_URL}/settings`)
      ])

      if (statsRes.ok) setStats(await statsRes.json())
      if (tokensRes.ok) setTokens(await tokensRes.json())
      if (patternsRes.ok) setPatterns(await patternsRes.json())
      if (settingsRes.ok) setSettings(await settingsRes.json())
    } catch (error) {
      console.error('Erro ao buscar dados:', error)
    } finally {
      setLoading(false)
    }
  }

  // Salvar configurações
  const saveSettings = async (newSettings) => {
    try {
      // Salva wallets
      await fetchAuth(`${API_URL}/settings`, {
        method: 'POST',
        body: JSON.stringify({ key: 'wallets', value: newSettings.wallets })
      })

      setSettings({ ...settings, ...newSettings })
    } catch (error) {
      console.error('Erro ao salvar:', error)
    }
  }

  // Limpar todos os tokens
  const clearTokens = async () => {
    if (!confirm('Tem certeza que quer limpar todos os tokens?')) return
    try {
      await fetchAuth(`${API_URL}/tokens/clear`, { method: 'DELETE' })
      setTokens([])
      fetchData()
    } catch (error) {
      console.error('Erro ao limpar:', error)
    }
  }


  // Conecta ao SSE para receber updates em tempo real
  useEffect(() => {
    fetchData()

    // Conecta ao Server-Sent Events (com token se disponível)
    const sseUrl = token ? `${API_URL}/events?token=${token}` : `${API_URL}/events`
    const eventSource = new EventSource(sseUrl)

    eventSource.addEventListener('connected', () => {
      console.log('[SSE] Conectado ao servidor')
    })

    eventSource.addEventListener('new-token', (e) => {
      try {
        const token = JSON.parse(e.data)
        console.log('[SSE] Novo token recebido:', token.name || token.contract_address)
        setTokens(prev => {
          // Evita duplicatas
          if (prev.some(t => t.id === token.id)) return prev
          return [token, ...prev]
        })
        // Atualiza stats também
        fetchData()
      } catch (err) {
        console.error('[SSE] Erro ao processar novo token:', err)
      }
    })

    eventSource.addEventListener('token-updated', (e) => {
      try {
        const updated = JSON.parse(e.data)
        console.log('[SSE] Token atualizado:', updated.name || updated.contract_address)
        setTokens(prev => prev.map(t => t.id === updated.id ? updated : t))
      } catch (err) {
        console.error('[SSE] Erro ao processar token atualizado:', err)
      }
    })

    eventSource.onerror = (err) => {
      console.log('[SSE] Erro de conexão, reconectando...')
    }

    // Fallback: atualiza stats a cada 60 segundos
    const interval = setInterval(() => {
      fetchAuth(`${API_URL}/stats`).then(r => r.json()).then(setStats).catch(() => {})
    }, 60000)

    return () => {
      eventSource.close()
      clearInterval(interval)
    }
  }, [])

  // Filtra tokens por tab
  const filteredTokens = tokens.filter(t => {
    if (activeTab === 'all') return true
    if (activeTab === 'missed') return !t.bought && t.price_change_percent > 100
    if (activeTab === 'avoided') return !t.bought && t.price_change_percent < -50
    if (activeTab === 'bought') return t.bought
    return true
  })

  return (
    <div className="min-h-screen bg-primary">
      {/* Header */}
      <header className="border-b border-theme bg-header backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center">
              <Target size={24} />
            </div>
            <div>
              <h1 className="font-bold text-lg text-primary">PAPER HANDS</h1>
              <p className="text-muted text-xs">Aprenda com seus trades não feitos</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={cycleTheme}
              className="p-2 hover:bg-hover rounded-lg transition text-secondary"
              title={`Tema: ${theme === 'default' ? 'Padrão' : theme === 'light' ? 'Claro' : 'Escuro'}`}
            >
              <ThemeIcon size={20} />
            </button>
            <button
              onClick={clearTokens}
              className="p-2 hover:bg-red-500/20 text-red-500 rounded-lg transition"
              title="Limpar tokens"
            >
              <Trash2 size={20} />
            </button>
            <button
              onClick={fetchData}
              className="p-2 hover:bg-hover rounded-lg transition text-secondary"
              title="Atualizar"
            >
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-hover rounded-lg transition text-secondary"
              title="Configurações"
            >
              <Settings size={20} />
            </button>
            <div className="flex items-center gap-2 ml-2 pl-2 border-l border-theme">
              <span className="text-sm text-muted hidden sm:block">{user?.username}</span>
              <button
                onClick={handleLogout}
                className="p-2 hover:bg-red-500/20 text-red-500 rounded-lg transition"
                title="Sair"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="Tokens Vistos Hoje"
            value={stats?.tokensViewedToday || 0}
            subtitle={`${stats?.totalTokensViewed || 0} total`}
            icon={Eye}
            color="brand"
          />
          <StatCard
            title="Lucro Perdido"
            value={formatMissedProfit(stats?.missedProfit)}
            subtitle={`${stats?.missedProfitTokens || 0} tokens`}
            icon={TrendingDown}
            color="red"
          />
          <StatCard
            title="Dev Dumps Evitados"
            value={stats?.devDumpsEvitados || 0}
            subtitle={`+ ${stats?.avoidedLosses || 0} quedas >50%`}
            icon={CheckCircle}
            color="brand"
          />
          <StatCard
            title="Win / Loss"
            value={`${stats?.tradesWon || 0}W / ${stats?.tradesLost || 0}L`}
            subtitle=""
            icon={Target}
            color={(stats?.tradesWon || 0) >= (stats?.tradesLost || 0) ? 'brand' : 'red'}
          />
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Token List */}
          <div className="lg:col-span-2 bg-secondary rounded-xl border border-theme">
            {/* Tabs */}
            <div className="flex gap-1 p-2 border-b border-theme">
              {[
                { id: 'all', label: 'Todos' },
                { id: 'missed', label: 'Oportunidades Perdidas' },
                { id: 'avoided', label: 'Rugs Evitados' },
                { id: 'bought', label: 'Comprados' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm transition ${
                    activeTab === tab.id
                      ? 'bg-brand-500/20 text-brand-500'
                      : 'hover:bg-hover text-secondary'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-4">
              <TokenList tokens={filteredTokens} loading={loading} />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <PatternsCard patterns={patterns} />

            {/* Quick Stats */}
            <div className="bg-secondary rounded-xl p-5 border border-theme">
              <h3 className="font-semibold mb-4 text-primary">Resumo Rápido</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Win / Loss</span>
                  <span className={(stats?.tradesWon || 0) >= (stats?.tradesLost || 0) ? 'text-brand-500' : 'text-red-500'}>{stats?.tradesWon || 0}W / {stats?.tradesLost || 0}L</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Maior oportunidade perdida</span>
                  <span className="text-red-500">
                    {Math.round(Number(tokens.filter(t => !t.bought)
                      .sort((a, b) => (Number(b.price_change_percent) || 0) - (Number(a.price_change_percent) || 0))[0]
                      ?.price_change_percent) || 0)}%
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Pior rug evitado</span>
                  <span className="text-brand-500">
                    {Math.round(Math.abs(Number(tokens.filter(t => !t.bought && Number(t.price_change_percent) < 0)
                      .sort((a, b) => (Number(a.price_change_percent) || 0) - (Number(b.price_change_percent) || 0))[0]
                      ?.price_change_percent) || 0))}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={saveSettings}
      />
    </div>
  )
}
