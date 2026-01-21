// Regret Minimizer - Background Service Worker

// Configuração padrão
let config = {
  apiUrl: 'http://localhost:3777/api',
  dashboardUrl: 'http://localhost:3777',
  token: null
};

// Badge para mostrar tokens vistos
let tokensViewedToday = 0;
let badgeDate = null;

// Carrega configuração salva
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(['apiUrl', 'dashboardUrl', 'authToken', 'badgeCount', 'badgeDate']);
    if (result.apiUrl) config.apiUrl = result.apiUrl;
    if (result.dashboardUrl) config.dashboardUrl = result.dashboardUrl;
    if (result.authToken) config.token = result.authToken;

    // Carrega badge count (reseta se for um novo dia)
    const today = new Date().toDateString();
    if (result.badgeDate === today && result.badgeCount) {
      tokensViewedToday = result.badgeCount;
      badgeDate = today;
      updateBadge(tokensViewedToday);
    } else {
      // Novo dia - reseta contador
      tokensViewedToday = 0;
      badgeDate = today;
      await chrome.storage.local.set({ badgeCount: 0, badgeDate: today });
    }

    console.log('[Regret Minimizer] Config carregada:', config.apiUrl, '- Badge:', tokensViewedToday);
  } catch (error) {
    console.error('[Regret Minimizer] Erro ao carregar config:', error);
  }
}

// Salva configuração
async function saveConfig(newConfig) {
  try {
    if (newConfig.apiUrl) config.apiUrl = newConfig.apiUrl;
    if (newConfig.dashboardUrl) config.dashboardUrl = newConfig.dashboardUrl;
    if (newConfig.token !== undefined) config.token = newConfig.token;

    await chrome.storage.local.set({
      apiUrl: config.apiUrl,
      dashboardUrl: config.dashboardUrl,
      authToken: config.token
    });

    console.log('[Regret Minimizer] Config salva');
    return true;
  } catch (error) {
    console.error('[Regret Minimizer] Erro ao salvar config:', error);
    return false;
  }
}

// Headers de autenticação
function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }
  return headers;
}

// Atualiza badge e persiste
async function updateBadge(count) {
  tokensViewedToday = count;
  chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
  // Persiste para sobreviver ao unload do service worker
  const today = new Date().toDateString();
  await chrome.storage.local.set({ badgeCount: count, badgeDate: today });
}

// Sincroniza tokens pendentes quando backend estiver disponível
async function syncPendingTokens() {
  try {
    const result = await chrome.storage.local.get(['pendingTokens']);
    const pending = result.pendingTokens || [];

    if (pending.length === 0) return;

    const stillPending = [];
    for (const token of pending) {
      try {
        const response = await fetch(`${config.apiUrl}/tokens/viewed`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(token)
        });

        if (!response.ok) {
          stillPending.push(token);
        }
      } catch {
        stillPending.push(token);
      }
    }

    chrome.storage.local.set({ pendingTokens: stillPending });
  } catch (error) {
    console.error('[Regret Minimizer] Erro ao sincronizar:', error);
  }
}

// Busca estatísticas do backend
async function fetchStats() {
  try {
    const response = await fetch(`${config.apiUrl}/stats/today`, {
      headers: getAuthHeaders()
    });
    if (response.ok) {
      const data = await response.json();
      const count = data.tokensViewed || 0;
      console.log('[Regret Minimizer] Stats do servidor:', count, 'tokens hoje');
      await updateBadge(count);
    } else {
      console.log('[Regret Minimizer] Erro ao buscar stats:', response.status);
    }
  } catch (error) {
    console.log('[Regret Minimizer] Backend não disponível para stats');
  }
}

// Login
async function login(username, password) {
  try {
    const response = await fetch(`${config.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Erro ao entrar' };
    }

    // Salva token
    await saveConfig({ token: data.token });

    return { success: true, user: data.user, token: data.token };
  } catch (error) {
    return { success: false, error: 'Servidor não disponível' };
  }
}

// Logout
async function logout() {
  await saveConfig({ token: null });
  return { success: true };
}

// Verifica se está autenticado
async function checkAuth() {
  if (!config.token) {
    return { authenticated: false };
  }

  try {
    const response = await fetch(`${config.apiUrl}/auth/me`, {
      headers: getAuthHeaders()
    });

    if (response.ok) {
      const user = await response.json();
      return { authenticated: true, user };
    }

    // Token inválido
    await saveConfig({ token: null });
    return { authenticated: false };
  } catch {
    return { authenticated: false, error: 'Servidor não disponível' };
  }
}

// Listener para mensagens
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_TOKEN') {
    fetch(`${config.apiUrl}/tokens/viewed`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(message.data)
    })
      .then(res => res.json())
      .then(async data => {
        const newCount = tokensViewedToday + 1;
        await updateBadge(newCount);
        console.log('[Regret Minimizer] Token salvo, badge:', newCount);
        sendResponse({ success: true, data });
      })
      .catch(async err => {
        console.error('[Regret Minimizer] Erro ao salvar token:', err);
        // Salva para sincronizar depois
        const result = await chrome.storage.local.get(['pendingTokens']);
        const pending = result.pendingTokens || [];
        pending.push(message.data);
        await chrome.storage.local.set({ pendingTokens: pending });
        sendResponse({ success: false, error: err.message, queued: true });
      });
    return true;
  }

  if (message.type === 'TOKEN_VIEWED') {
    const newCount = tokensViewedToday + 1;
    updateBadge(newCount).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_STATS') {
    fetchStats().then(() => {
      console.log('[Regret Minimizer] GET_STATS retornando:', tokensViewedToday);
      sendResponse({ tokensViewedToday });
    });
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: config.dashboardUrl });
    sendResponse({ success: true });
  }

  if (message.type === 'GET_CONFIG') {
    sendResponse({
      apiUrl: config.apiUrl,
      dashboardUrl: config.dashboardUrl,
      hasToken: !!config.token
    });
  }

  if (message.type === 'SET_CONFIG') {
    saveConfig(message.config).then(success => {
      sendResponse({ success });
    });
    return true;
  }

  if (message.type === 'LOGIN') {
    login(message.username, message.password).then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (message.type === 'LOGOUT') {
    logout().then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (message.type === 'CHECK_AUTH') {
    checkAuth().then(result => {
      sendResponse(result);
    });
    return true;
  }
});

// Verifica backend a cada 5 minutos
setInterval(() => {
  syncPendingTokens();
  fetchStats();
}, 5 * 60 * 1000);

// Sites suportados para injeção do content script
const SUPPORTED_SITES = [
  'https://axiom.trade/*',
  'https://gmgn.ai/*',
  'https://dexscreener.com/*',
  'https://photon-sol.tinyastro.io/*',
  'https://bullx.io/*'
];

// Injeta content script em abas já abertas
async function injectContentScripts() {
  try {
    for (const pattern of SUPPORTED_SITES) {
      const tabs = await chrome.tabs.query({ url: pattern });
      for (const tab of tabs) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          console.log(`[Regret Minimizer] Script injetado na aba: ${tab.url}`);
        } catch (err) {
          // Tab pode não estar pronta ou já ter o script
          console.log(`[Regret Minimizer] Não foi possível injetar em: ${tab.url}`, err.message);
        }
      }
    }
  } catch (error) {
    console.error('[Regret Minimizer] Erro ao injetar scripts:', error);
  }
}

// Quando a extensão é instalada ou atualizada
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Regret Minimizer] Extensão instalada/atualizada:', details.reason);
  // Injeta scripts em abas já abertas
  injectContentScripts();
});

// Quando o service worker inicia (pode ser após idle)
chrome.runtime.onStartup.addListener(() => {
  console.log('[Regret Minimizer] Chrome iniciado');
  injectContentScripts();
});

// Inicialização
loadConfig().then(() => {
  syncPendingTokens();
  fetchStats();
  // Também injeta scripts na inicialização do service worker
  injectContentScripts();
});

console.log('[Regret Minimizer] Background service worker iniciado');
