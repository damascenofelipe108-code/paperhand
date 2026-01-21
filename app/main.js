const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let tray;
let serverProcess;

// Porta do servidor
const SERVER_PORT = 3777;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'frontend', 'public', 'icon.png'),
    show: false,
    titleBarStyle: 'default',
    backgroundColor: '#0a0a0a'
  });

  // Carrega a URL do servidor
  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  // Mostra quando estiver pronto
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimiza para tray ao invés de fechar
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // Abre links externos no browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'frontend', 'public', 'icon.png');

  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Regret Minimizer',
      click: () => {
        mainWindow.show();
      }
    },
    {
      label: 'Abrir no Browser',
      click: () => {
        shell.openExternal(`http://localhost:${SERVER_PORT}`);
      }
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Regret Minimizer');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'server', 'index.js');

    serverProcess = spawn('node', [serverPath], {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`[Server] ${data}`);
      if (data.toString().includes('Servidor rodando')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server Error] ${data}`);
    });

    serverProcess.on('error', (error) => {
      console.error('[Server] Failed to start:', error);
      reject(error);
    });

    // Timeout para garantir que o servidor iniciou
    setTimeout(resolve, 3000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// App ready
app.whenReady().then(async () => {
  try {
    // Inicia o servidor
    await startServer();

    // Cria janela e tray
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error('Erro ao iniciar:', error);
    app.quit();
  }
});

// Fecha tudo ao sair
app.on('before-quit', () => {
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // No Windows/Linux, não fecha ao fechar janelas (fica no tray)
  }
});

// Previne múltiplas instâncias
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
