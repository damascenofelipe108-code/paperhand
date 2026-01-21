// Paper Hands - Popup Script

// URLs dos servidores
const SERVERS = {
  local: { api: 'http://localhost:3777/api', dashboard: 'http://localhost:3777' },
  railway: { api: 'https://paperhand-production.up.railway.app/api', dashboard: 'https://paperhand-production.up.railway.app' }
};

// Estado
let currentUser = null;
let currentConfig = null;

// Elements - Login
const loginView = document.getElementById('loginView');
const loginError = document.getElementById('loginError');
const serverSelect = document.getElementById('serverSelect');
const customUrlGroup = document.getElementById('customUrlGroup');
const customUrl = document.getElementById('customUrl');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');

// Elements - Main
const mainView = document.getElementById('mainView');
const viewedTodayEl = document.getElementById('viewedToday');
const missedProfitEl = document.getElementById('missedProfit');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const userNameEl = document.getElementById('userName');
const recentTokensEl = document.getElementById('recentTokens');
const openDashboardBtn = document.getElementById('openDashboard');
const settingsBtn = document.getElementById('settingsBtn');

// Elements - Settings
const settingsView = document.getElementById('settingsView');
const backBtn = document.getElementById('backBtn');
const settingsServerSelect = document.getElementById('settingsServerSelect');
const settingsCustomUrlGroup = document.getElementById('settingsCustomUrlGroup');
const settingsCustomUrl = document.getElementById('settingsCustomUrl');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const logoutBtn = document.getElementById('logoutBtn');

// Helpers
function showView(view) {
  loginView.classList.remove('active');
  mainView.classList.remove('active');
  settingsView.classList.remove('active');
  view.classList.add('active');
}

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.add('visible');
}

function hideError() {
  loginError.classList.remove('visible');
}

function getServerUrls(type, customApiUrl) {
  if (type === 'custom' && customApiUrl) {
    return { api: customApiUrl, dashboard: customApiUrl.replace('/api', '') };
  }
  return SERVERS[type] || SERVERS.local;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toFixed(2);
}

function truncateAddress(address) {
  if (!address) return '???';
  return address.slice(0, 6) + '...' + address.slice(-4);
}

// Server select handlers
function setupServerSelect(selectEl, customGroup, customInput) {
  selectEl.addEventListener('change', () => {
    if (selectEl.value === 'custom') {
      customGroup.classList.remove('hidden');
    } else {
      customGroup.classList.add('hidden');
    }
  });
}

setupServerSelect(serverSelect, customUrlGroup, customUrl);
setupServerSelect(settingsServerSelect, settingsCustomUrlGroup, settingsCustomUrl);

// Login
loginBtn.addEventListener('click', async () => {
  hideError();

  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  const serverType = serverSelect.value;
  const customApiUrl = customUrl.value.trim();

  if (!username || !password) {
    showError('Preencha todos os campos');
    return;
  }

  const urls = getServerUrls(serverType, customApiUrl);

  loginBtn.textContent = 'Entrando...';
  loginBtn.disabled = true;

  try {
    // Salva config primeiro
    await chrome.runtime.sendMessage({
      type: 'SET_CONFIG',
      config: {
        apiUrl: urls.api,
        dashboardUrl: urls.dashboard
      }
    });

    // Faz login
    const result = await chrome.runtime.sendMessage({
      type: 'LOGIN',
      username,
      password
    });

    if (result.success) {
      currentUser = result.user;
      showMainView();
    } else {
      showError(result.error || 'Erro ao entrar');
    }
  } catch (err) {
    showError('Erro de conexão');
  } finally {
    loginBtn.textContent = 'Entrar';
    loginBtn.disabled = false;
  }
});

// Verifica autenticação ao abrir
async function checkAuth() {
  try {
    const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    currentConfig = config;

    // Define servidor selecionado baseado na config
    if (config.apiUrl.includes('localhost')) {
      serverSelect.value = 'local';
      settingsServerSelect.value = 'local';
    } else if (config.apiUrl.includes('railway.app')) {
      serverSelect.value = 'railway';
      settingsServerSelect.value = 'railway';
    } else {
      serverSelect.value = 'custom';
      settingsServerSelect.value = 'custom';
      customUrl.value = config.apiUrl;
      settingsCustomUrl.value = config.apiUrl;
      customUrlGroup.classList.remove('hidden');
      settingsCustomUrlGroup.classList.remove('hidden');
    }

    const result = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });

    if (result.authenticated) {
      currentUser = result.user;
      showMainView();
    } else {
      showView(loginView);
    }
  } catch (err) {
    showView(loginView);
  }
}

// Main view
async function showMainView() {
  showView(mainView);
  userNameEl.textContent = currentUser?.username || '';

  // Verifica conexão e carrega dados
  await checkConnection();
  await Promise.all([fetchStats(), fetchRecentTokens()]);
}

async function checkConnection() {
  try {
    const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    const response = await fetch(`${config.apiUrl.replace('/api', '')}/api/health`);

    if (response.ok) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Conectado';
      return true;
    }
  } catch {
    statusDot.classList.remove('connected');
    statusText.textContent = 'Servidor offline';
    return false;
  }
  return false;
}

async function fetchStats() {
  try {
    const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    const token = (await chrome.storage.local.get(['authToken'])).authToken;

    const response = await fetch(`${config.apiUrl.replace('/api', '')}/api/stats`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });

    if (response.ok) {
      const data = await response.json();
      viewedTodayEl.textContent = data.tokensViewedToday || 0;

      // Formata lucro perdido
      const missed = data.missedProfit || {};
      if (missed.SOL > 0) {
        missedProfitEl.textContent = `${missed.SOL.toFixed(2)} SOL`;
      } else if (missed.ETH > 0) {
        missedProfitEl.textContent = `${missed.ETH.toFixed(4)} ETH`;
      } else {
        missedProfitEl.textContent = '0';
      }
    }
  } catch (error) {
    console.error('Erro ao buscar stats:', error);
  }
}

async function fetchRecentTokens() {
  try {
    const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    const token = (await chrome.storage.local.get(['authToken'])).authToken;

    const response = await fetch(`${config.apiUrl.replace('/api', '')}/api/tokens/recent?limit=5`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });

    if (response.ok) {
      const tokens = await response.json();
      renderRecentTokens(tokens);
    }
  } catch (error) {
    console.error('Erro ao buscar tokens:', error);
  }
}

function renderRecentTokens(tokens) {
  if (!tokens || tokens.length === 0) {
    recentTokensEl.innerHTML = '<div class="empty-state">Nenhum token rastreado ainda</div>';
    return;
  }

  recentTokensEl.innerHTML = tokens.map(token => {
    const change = token.price_change_percent || 0;
    const changeClass = change >= 0 ? 'positive' : 'negative';
    const changePrefix = change >= 0 ? '+' : '';

    return `
      <div class="recent-item">
        <div class="token-info">
          <span class="token-name">${token.symbol || truncateAddress(token.contract_address)}</span>
          <span class="token-chain">${token.chain || ''} ${token.source ? '• ' + token.source : ''}</span>
        </div>
        <span class="token-change ${changeClass}">${changePrefix}${change.toFixed(1)}%</span>
      </div>
    `;
  }).join('');
}

// Dashboard button
openDashboardBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
});

// Settings
settingsBtn.addEventListener('click', () => {
  showView(settingsView);
});

backBtn.addEventListener('click', () => {
  showView(mainView);
});

saveSettingsBtn.addEventListener('click', async () => {
  const serverType = settingsServerSelect.value;
  const customApiUrl = settingsCustomUrl.value.trim();
  const urls = getServerUrls(serverType, customApiUrl);

  await chrome.runtime.sendMessage({
    type: 'SET_CONFIG',
    config: {
      apiUrl: urls.api,
      dashboardUrl: urls.dashboard
    }
  });

  showView(mainView);
  await checkConnection();
});

logoutBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'LOGOUT' });
  currentUser = null;
  showView(loginView);
  loginUsername.value = '';
  loginPassword.value = '';
});

// Initialize
checkAuth();
