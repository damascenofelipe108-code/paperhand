// Regret Minimizer - Content Script
// Detecta tokens visualizados em diferentes plataformas

(function() {
  'use strict';

  const API_URL = 'http://localhost:3777/api';
  let lastDetectedToken = null;
  let detectionTimeout = null;

  // Função para extrair nome/ticker/mcap da página
  function getTokenMetaFromPage() {
    let name = null;
    let symbol = null;
    let mcap = null;
    let pnl = null;
    let pnlPercent = null;
    let pnlCurrency = null;

    const title = document.title;
    const hostname = window.location.hostname;

    // Axiom: formato "SANE ↓ $11K | Axiom" ou "TOKEN ↑ $1.5M | Axiom"
    if (hostname.includes('axiom')) {
      const axiomMatch = title.match(/^([A-Za-z0-9_]+)\s*[↓↑]?\s*\$?([\d.]+[KMB]?)\s*\|/i);
      if (axiomMatch) {
        name = axiomMatch[1].trim();
        symbol = axiomMatch[1].trim(); // Na Axiom o nome é o ticker
        mcap = parseMarketCap(axiomMatch[2]);
      } else {
        // Fallback: pega só o nome antes de qualquer símbolo especial
        const simpleMatch = title.match(/^([A-Za-z0-9_]+)/);
        if (simpleMatch) {
          name = simpleMatch[1].trim();
          symbol = simpleMatch[1].trim();
        }
      }

      // Tenta pegar PNL da página (Axiom mostra PNL para tokens que você tradou)
      // Procura em vários seletores possíveis
      const pnlSelectors = [
        'span.text-increase',
        'span.text-decrease',
        '[class*="text-increase"]',
        '[class*="text-decrease"]'
      ];

      for (const selector of pnlSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const pnlText = el.textContent.trim();
          // Formato: "+1.175 (+9%)" ou "-0.5 (-10%)"
          const pnlMatch = pnlText.match(/([+-]?[\d.]+)\s*\(([+-]?\d+)%\)/);
          if (pnlMatch) {
            pnl = parseFloat(pnlMatch[1]);
            pnlPercent = parseInt(pnlMatch[2]);
            pnlCurrency = 'SOL';
            console.log('[Regret Minimizer] PNL detectado:', pnl, 'SOL (', pnlPercent, '%) - Elemento:', el.className);
            break;
          }
        }
        if (pnl !== null) break;
      }

      // Log para debug
      if (pnl === null) {
        console.log('[Regret Minimizer] PNL não encontrado na página');
      }
    }

    // GMGN: formato similar
    if (hostname.includes('gmgn')) {
      const gmgnMatch = title.match(/^([A-Za-z0-9_]+)/);
      if (gmgnMatch) {
        name = gmgnMatch[1].trim();
        symbol = gmgnMatch[1].trim();
      }
      // Tenta pegar MC do título
      const mcapMatch = title.match(/\$?([\d.]+[KMB])/i);
      if (mcapMatch) {
        mcap = parseMarketCap(mcapMatch[1]);
      }

      // Tenta pegar PNL da página (GMGN mostra PNL para tokens que você tradou)
      // O PNL tem formato: "+1.3 ETH(+1302%)" - DEVE ter o percentual junto
      // Seletor específico: div com justify-end e flex-nowrap
      const pnlCandidates = document.querySelectorAll('.flex.items-center.justify-end.flex-nowrap, [class*="justify-end"][class*="flex-nowrap"]');

      for (const el of pnlCandidates) {
        const text = el.textContent.trim();
        // DEVE ter percentual para ser PNL, formato: "+1.3 ETH(+1302%)" ou "1.3 ETH(+1302%)"
        // O percentual é obrigatório para diferenciar de valores de compra
        const pnlMatch = text.match(/([+-]?[\d.]+)\s*(ETH|BNB|SOL)[^\d]*\(([+-]?\d+)%\)/i);
        if (pnlMatch) {
          pnl = parseFloat(pnlMatch[1]);
          pnlPercent = parseInt(pnlMatch[3]);
          const currency = pnlMatch[2].toUpperCase();

          // Se o texto começa com - ou o percentual é negativo, PNL é negativo
          if (text.startsWith('-') || pnlPercent < 0) {
            pnl = -Math.abs(pnl);
          }

          pnlCurrency = currency;
          console.log('[Regret Minimizer] PNL GMGN detectado:', pnl, pnlCurrency, '(', pnlPercent, '%)');
          break;
        }
      }

      // Fallback: procura por cor verde/vermelha se não encontrou pelo seletor
      if (pnl === null) {
        const allElements = document.querySelectorAll('div, span');
        for (const el of allElements) {
          const text = el.textContent.trim();
          // DEVE ter percentual
          const pnlMatch = text.match(/([+-]?[\d.]+)\s*(ETH|BNB|SOL)[^\d]*\(([+-]?\d+)%\)/i);
          if (pnlMatch) {
            const style = window.getComputedStyle(el);
            const color = style.color;
            const isGreen = color.includes('134, 217, 159') || color.includes('134,217,159');
            const isRed = color.includes('239, 68') || color.includes('255, 99');

            if (isGreen || isRed) {
              pnl = parseFloat(pnlMatch[1]);
              pnlPercent = parseInt(pnlMatch[3]);
              if (isRed || pnlPercent < 0) {
                pnl = -Math.abs(pnl);
              }
              pnlCurrency = pnlMatch[2].toUpperCase();
              console.log('[Regret Minimizer] PNL GMGN detectado (fallback):', pnl, pnlCurrency, '(', pnlPercent, '%)');
              break;
            }
          }
        }
      }

      // Log para debug
      if (pnl === null) {
        console.log('[Regret Minimizer] PNL GMGN não encontrado na página');
      }
    }

    // DexScreener
    if (hostname.includes('dexscreener')) {
      const dexMatch = title.match(/^([A-Za-z0-9_]+)/);
      if (dexMatch) {
        name = dexMatch[1].trim();
        symbol = dexMatch[1].trim();
      }
    }

    return { name, symbol, mcap, pnl, pnlPercent, pnlCurrency };
  }

  // Converte string de market cap para número (ex: "11K" -> 11000, "1.5M" -> 1500000)
  function parseMarketCap(mcapStr) {
    if (!mcapStr) return null;
    const num = parseFloat(mcapStr);
    if (isNaN(num)) return null;

    const suffix = mcapStr.slice(-1).toUpperCase();
    if (suffix === 'K') return num * 1000;
    if (suffix === 'M') return num * 1000000;
    if (suffix === 'B') return num * 1000000000;
    return num;
  }

  // Configurações por plataforma
  const platforms = {
    'axiom.trade': {
      name: 'axiom',
      chain: 'solana',
      getTokenFromUrl: (url) => {
        // https://axiom.trade/t/CONTRACT_ADDRESS ou /meme/CONTRACT ou /pulse
        const match = url.match(/\/(?:t|meme|pulse\?[^\/]*address=)([A-Za-z0-9]{32,44})/);
        if (match) return match[1];
        // Também tenta pegar do query string
        const urlObj = new URL(url);
        const address = urlObj.searchParams.get('address');
        if (address && address.length >= 32) return address;
        // Tenta pegar da URL diretamente
        const simpleMatch = url.match(/\/([A-HJ-NP-Za-km-z1-9]{32,44})(?:\?|$)/);
        return simpleMatch ? simpleMatch[1] : null;
      },
      getTokenFromPage: () => {
        const addressEl = document.querySelector('[data-token-address]');
        if (addressEl) return addressEl.dataset.tokenAddress;
        return null;
      }
    },
    'gmgn.ai': {
      name: 'gmgn',
      chain: 'auto',
      getTokenFromUrl: (url) => {
        const match = url.match(/\/(sol|bsc|base|eth)\/token\/([A-Za-z0-9x]{32,44})/i);
        if (match) {
          return {
            contract: match[2],
            chain: match[1] === 'sol' ? 'solana' : match[1]
          };
        }
        return null;
      },
      getTokenFromPage: () => null
    },
    'dexscreener.com': {
      name: 'dexscreener',
      chain: 'auto',
      getTokenFromUrl: (url) => {
        // https://dexscreener.com/solana/CONTRACT ou /base/CONTRACT
        const match = url.match(/dexscreener\.com\/(\w+)\/([A-Za-z0-9]{32,44})/i);
        if (match) {
          const chainMap = {
            'solana': 'solana',
            'base': 'base',
            'bsc': 'bsc',
            'ethereum': 'eth'
          };
          return {
            contract: match[2],
            chain: chainMap[match[1].toLowerCase()] || match[1].toLowerCase()
          };
        }
        return null;
      },
      getTokenFromPage: () => null
    },
    'photon-sol.tinyastro.io': {
      name: 'photon',
      chain: 'solana',
      getTokenFromUrl: (url) => {
        const match = url.match(/\/([A-Za-z0-9]{32,44})/);
        return match ? match[1] : null;
      },
      getTokenFromPage: () => null
    },
    'bullx.io': {
      name: 'bullx',
      chain: 'auto',
      getTokenFromUrl: (url) => {
        // https://bullx.io/terminal?chainId=1399811149&address=CONTRACT
        const urlObj = new URL(url);
        const address = urlObj.searchParams.get('address');
        const chainId = urlObj.searchParams.get('chainId');
        if (address) {
          const chainMap = {
            '1399811149': 'solana',
            '56': 'bsc',
            '8453': 'base',
            '1': 'eth'
          };
          return {
            contract: address,
            chain: chainMap[chainId] || 'unknown'
          };
        }
        return null;
      },
      getTokenFromPage: () => null
    }
  };

  // Detecta qual plataforma estamos
  function getCurrentPlatform() {
    const hostname = window.location.hostname;
    for (const [domain, config] of Object.entries(platforms)) {
      if (hostname.includes(domain)) {
        return { domain, ...config };
      }
    }
    return null;
  }

  // Extrai informações do token
  function extractTokenInfo() {
    const platform = getCurrentPlatform();
    if (!platform) return null;

    const url = window.location.href;
    let tokenData = platform.getTokenFromUrl(url);

    if (!tokenData && platform.getTokenFromPage) {
      tokenData = platform.getTokenFromPage();
    }

    if (!tokenData) return null;

    // Normaliza o formato
    let contract, chain;
    if (typeof tokenData === 'string') {
      contract = tokenData;
      chain = platform.chain;
    } else {
      contract = tokenData.contract;
      chain = tokenData.chain;
    }

    // Pega nome, ticker e mcap da página
    const meta = getTokenMetaFromPage();

    return {
      contract_address: contract,
      chain: chain,
      source: platform.name,
      url: url,
      name: meta.name || null,
      symbol: meta.symbol || null,
      mcap: meta.mcap || null,
      pnl_sol: meta.pnl || null,
      pnl_percent: meta.pnlPercent || null,
      pnl_currency: meta.pnlCurrency || null,
      timestamp: new Date().toISOString()
    };
  }

  // Envia token para o backend via background script (evita CORS)
  async function sendTokenToBackend(tokenInfo) {
    try {
      // Envia para o background script que faz a requisição
      chrome.runtime.sendMessage({
        type: 'SAVE_TOKEN',
        data: tokenInfo
      }, (response) => {
        if (response && response.success) {
          console.log('[Regret Minimizer] Token registrado:', response.data);
        } else {
          console.log('[Regret Minimizer] Erro ao registrar, salvando localmente');
          saveLocally(tokenInfo);
        }
      });
    } catch (error) {
      console.log('[Regret Minimizer] Erro, salvando localmente');
      saveLocally(tokenInfo);
    }
  }

  function saveLocally(tokenInfo) {
    chrome.storage.local.get(['pendingTokens'], (result) => {
      const pending = result.pendingTokens || [];
      pending.push(tokenInfo);
      chrome.storage.local.set({ pendingTokens: pending });
    });
  }

  // Verifica e envia token
  function checkAndSendToken() {
    const tokenInfo = extractTokenInfo();

    if (tokenInfo && tokenInfo.contract_address !== lastDetectedToken) {
      lastDetectedToken = tokenInfo.contract_address;
      console.log('[Regret Minimizer] Token detectado:', tokenInfo);
      sendTokenToBackend(tokenInfo);
    }
  }

  // Observer para mudanças de URL (SPAs)
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;

      // Debounce para evitar múltiplas detecções
      clearTimeout(detectionTimeout);
      detectionTimeout = setTimeout(checkAndSendToken, 1000);
    }
  });

  // Inicia observação
  urlObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Verifica na carga inicial
  setTimeout(checkAndSendToken, 2000);

  // Verifica periodicamente (para páginas que não mudam URL)
  setInterval(checkAndSendToken, 10000);

  console.log('[Regret Minimizer] Content script carregado para', getCurrentPlatform()?.name);
})();
