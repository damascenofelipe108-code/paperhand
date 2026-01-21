# Regret Minimizer

Rastreia tokens que você viu mas não comprou e mostra o resultado - ajudando a calibrar suas decisões de trading.

## Como Funciona

1. **Extensão Chrome** detecta tokens que você abre na Axiom, GMGN, DexScreener, etc.
2. **App Desktop** salva os dados localmente e busca preços atualizados
3. **Dashboard** mostra: lucro perdido, padrões de comportamento, e score de decisão

## Instalação

### Passo 1: Instalar dependências

```bash
cd regret-minimizer
npm run install:all
```

### Passo 2: Rodar em modo desenvolvimento

```bash
npm run dev
```

Ou rodar o app Electron completo:

```bash
npm start
```

### Passo 3: Instalar extensão Chrome

1. Abra `chrome://extensions/` no Chrome
2. Ative "Modo do desenvolvedor" (canto superior direito)
3. Clique em "Carregar sem compactação"
4. Selecione a pasta `extension/` deste projeto

### Passo 4: Configurar suas wallets

1. Abra o dashboard em `http://localhost:3777`
2. Clique no ícone de configurações
3. Adicione seu endereço Solana (para Axiom)
4. Adicione seu endereço EVM (para GMGN - Base/BSC)

## Uso

1. Navegue normalmente na Axiom, GMGN, ou DexScreener
2. A extensão detecta automaticamente os tokens que você visualiza
3. O app rastreia os preços e compara com sua wallet
4. Veja os resultados no dashboard

## Build para produção

```bash
npm run build
```

Isso gera o instalador em `dist/`.

## Tecnologias

- **Extensão**: Chrome Extension Manifest V3
- **Backend**: Node.js + Express + SQLite
- **Frontend**: React + TailwindCSS
- **Desktop**: Electron
- **APIs**: DexScreener (preços), Solscan/BscScan (transações)

## Estrutura

```
regret-minimizer/
├── extension/           # Extensão Chrome
├── app/
│   ├── main.js          # Electron main process
│   ├── server/          # Backend Express
│   ├── database/        # SQLite schema
│   └── frontend/        # React dashboard
└── package.json
```
