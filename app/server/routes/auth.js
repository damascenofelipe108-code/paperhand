// Rotas de autenticação simples
const express = require('express');
const { generateToken } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

// Senha mestra que libera acesso
const MASTER_PASSWORD = '12345';

// Injeta database adapter
let db = null;
function setDb(database) {
  db = database;
}

// POST /api/auth/login - Login simples (qualquer nome, senha 12345)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    // Verifica senha mestra
    if (password !== MASTER_PASSWORD) {
      return res.status(401).json({ error: 'Senha inválida' });
    }

    // Busca ou cria usuário
    let user = await db.queryOne('SELECT * FROM users WHERE username = ?', [username.toLowerCase()]);

    if (!user) {
      // Cria usuário automaticamente
      const result = await db.run(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        [username.toLowerCase(), 'master']
      );
      user = {
        id: result.lastInsertRowid,
        username: username.toLowerCase()
      };
    }

    // Gera token
    const token = generateToken(user.id, user.username);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        walletSolana: user.wallet_solana,
        walletEvm: user.wallet_evm
      }
    });
  } catch (error) {
    console.error('[Auth] Erro ao fazer login:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/me - Retorna usuário atual
router.get('/me', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const user = await db.queryOne('SELECT id, username, wallet_solana, wallet_evm FROM users WHERE id = ?', [req.user.id]);

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    res.json({
      id: user.id,
      username: user.username,
      walletSolana: user.wallet_solana,
      walletEvm: user.wallet_evm
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/auth/wallets - Atualiza wallets do usuário
router.put('/wallets', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { walletSolana, walletEvm } = req.body;

    await db.run(
      'UPDATE users SET wallet_solana = ?, wallet_evm = ? WHERE id = ?',
      [walletSolana || null, walletEvm || null, req.user.id]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, setDb };
