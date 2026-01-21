// Regret Minimizer - Helius WebSocket Service
// Detecta transações em tempo real via Helius Enhanced WebSockets

const WebSocket = require('ws');

// API Key hardcoded (mesmo usado no devtracker.js)
const HELIUS_API_KEY = '0e541cd9-6780-402d-a36c-e449c1eaa8f5';
const HELIUS_WS_URL = `wss://atlas-mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

class HeliusWebSocketManager {
  constructor(onTransactionCallback) {
    this.ws = null;
    this.walletAddress = null;
    this.onTransaction = onTransactionCallback;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 3000;
    this.pingInterval = null;
    this.subscriptionId = null;
    this.isConnected = false;
  }

  /**
   * Conecta ao WebSocket e se inscreve na wallet
   * @param {string} walletAddress - Endereço da wallet Solana
   */
  connect(walletAddress) {
    if (!walletAddress) {
      console.log('[Helius WS] Wallet não configurada, ignorando conexão');
      return;
    }

    this.walletAddress = walletAddress;
    console.log(`[Helius WS] Conectando para monitorar wallet ${walletAddress.slice(0, 8)}...`);

    try {
      this.ws = new WebSocket(HELIUS_WS_URL);

      this.ws.on('open', () => this.onOpen());
      this.ws.on('message', (data) => this.onMessage(data));
      this.ws.on('error', (error) => this.onError(error));
      this.ws.on('close', () => this.onClose());
      this.ws.on('pong', () => {
        // Conexão está viva
      });
    } catch (error) {
      console.error('[Helius WS] Erro ao criar conexão:', error.message);
    }
  }

  onOpen() {
    console.log('[Helius WS] Conectado com sucesso');
    this.isConnected = true;
    this.reconnectAttempts = 0;

    // Ping a cada 30 segundos para manter conexão viva
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);

    // Inscreve na wallet
    this.subscribe();
  }

  subscribe() {
    const request = {
      jsonrpc: "2.0",
      id: 420,
      method: "transactionSubscribe",
      params: [
        {
          accountInclude: [this.walletAddress],
          failed: false // Ignora transações falhadas
        },
        {
          commitment: "confirmed", // Espera confirmação
          encoding: "jsonParsed",
          transactionDetails: "full",
          showRewards: false,
          maxSupportedTransactionVersion: 0
        }
      ]
    };

    this.ws.send(JSON.stringify(request));
    console.log(`[Helius WS] Inscrito para transações da wallet ${this.walletAddress.slice(0, 8)}...`);
  }

  onMessage(data) {
    try {
      const message = JSON.parse(data.toString('utf8'));

      // Confirmação de inscrição
      if (message.result !== undefined && message.id === 420) {
        this.subscriptionId = message.result;
        console.log(`[Helius WS] Inscrição confirmada, ID: ${this.subscriptionId}`);
        return;
      }

      // Notificação de transação
      if (message.method === "transactionNotification") {
        const value = message.params?.result?.value;
        if (value && value.transaction) {
          this.handleTransaction(value);
        }
      }
    } catch (error) {
      console.error('[Helius WS] Erro ao processar mensagem:', error.message);
    }
  }

  handleTransaction(result) {
    const { transaction, meta } = result;
    if (!transaction || !transaction.signatures) {
      console.log('[Helius WS] Transação sem dados completos, ignorando');
      return;
    }
    const signature = transaction.signatures[0];

    console.log(`[Helius WS] Nova transação detectada: ${signature.slice(0, 16)}...`);

    // Analisa mudanças de token
    const tokenChanges = this.analyzeTokenChanges(meta);

    if (tokenChanges.length > 0) {
      console.log('[Helius WS] Mudanças de token detectadas:');
      tokenChanges.forEach(change => {
        console.log(`  ${change.direction}: ${change.uiAmount} de ${change.mint.slice(0, 8)}...`);
      });

      // Notifica o callback com os dados da transação
      if (this.onTransaction) {
        this.onTransaction({
          signature,
          slot: result.slot,
          timestamp: Date.now(),
          tokenChanges,
          fee: meta.fee
        });
      }
    }
  }

  /**
   * Analisa mudanças de saldo de tokens na transação
   */
  analyzeTokenChanges(meta) {
    const changes = [];
    const preTokenBalances = meta.preTokenBalances || [];
    const postTokenBalances = meta.postTokenBalances || [];

    // Mapeia saldos anteriores por mint+owner
    const preMap = new Map();
    preTokenBalances.forEach(pre => {
      const key = `${pre.mint}_${pre.owner}`;
      preMap.set(key, pre);
    });

    // Compara com saldos posteriores
    postTokenBalances.forEach(post => {
      const key = `${post.mint}_${post.owner}`;
      const pre = preMap.get(key);

      // Só considera mudanças na wallet do usuário
      if (post.owner !== this.walletAddress) return;

      const preAmount = pre ? parseFloat(pre.uiTokenAmount?.uiAmount || 0) : 0;
      const postAmount = parseFloat(post.uiTokenAmount?.uiAmount || 0);
      const change = postAmount - preAmount;

      if (Math.abs(change) > 0.000001) { // Ignora mudanças muito pequenas
        changes.push({
          mint: post.mint,
          preAmount,
          postAmount,
          change,
          uiAmount: Math.abs(change),
          direction: change > 0 ? 'BUY' : 'SELL',
          owner: post.owner
        });
      }
    });

    // Verifica tokens que existiam antes mas não depois (vendeu tudo)
    preTokenBalances.forEach(pre => {
      if (pre.owner !== this.walletAddress) return;

      const key = `${pre.mint}_${pre.owner}`;
      const hasPost = postTokenBalances.some(p => `${p.mint}_${p.owner}` === key);

      if (!hasPost && parseFloat(pre.uiTokenAmount?.uiAmount || 0) > 0) {
        changes.push({
          mint: pre.mint,
          preAmount: parseFloat(pre.uiTokenAmount?.uiAmount || 0),
          postAmount: 0,
          change: -parseFloat(pre.uiTokenAmount?.uiAmount || 0),
          uiAmount: parseFloat(pre.uiTokenAmount?.uiAmount || 0),
          direction: 'SELL',
          owner: pre.owner
        });
      }
    });

    return changes;
  }

  onError(error) {
    console.error('[Helius WS] Erro:', error.message);
  }

  onClose() {
    console.log('[Helius WS] Conexão fechada');
    this.isConnected = false;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.attemptReconnect();
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
      console.log(`[Helius WS] Reconectando em ${delay}ms (tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(() => {
        if (this.walletAddress) {
          this.connect(this.walletAddress);
        }
      }, delay);
    } else {
      console.error('[Helius WS] Máximo de tentativas de reconexão atingido');
    }
  }

  /**
   * Atualiza a wallet monitorada
   */
  updateWallet(newWalletAddress) {
    if (newWalletAddress === this.walletAddress) return;

    console.log(`[Helius WS] Atualizando wallet para ${newWalletAddress?.slice(0, 8) || 'nenhuma'}...`);

    // Desconecta e reconecta com nova wallet
    this.disconnect();

    if (newWalletAddress) {
      setTimeout(() => this.connect(newWalletAddress), 1000);
    }
  }

  /**
   * Desconecta o WebSocket
   */
  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.walletAddress = null;
    this.subscriptionId = null;
    this.reconnectAttempts = this.maxReconnectAttempts; // Evita reconexão automática
  }

  /**
   * Retorna status da conexão
   */
  getStatus() {
    return {
      connected: this.isConnected,
      wallet: this.walletAddress,
      subscriptionId: this.subscriptionId
    };
  }
}

module.exports = HeliusWebSocketManager;
