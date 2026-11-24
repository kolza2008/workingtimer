import * as vscode from "vscode";

let saveOnClose: (() => Promise<void>) | undefined;

type Session = {
  startTime: string;
  workTimeSeconds: number;
};

export function activate(context: vscode.ExtensionContext): void {
  let elapsed = 0;
  let startedAt: number | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let displayTimer: NodeJS.Timeout | undefined;
  let saveTimer: NodeJS.Timeout | undefined;
  let documentActivityTimer: NodeJS.Timeout | undefined;

  let currentSession: Session | undefined;
  let sessions: Session[] = [];

  let directory: vscode.Uri;
  if (vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0) {
    directory = vscode.workspace.workspaceFolders[0].uri;
  } else {
    directory = context.globalStorageUri;
  }

  const file = vscode.Uri.joinPath(directory, "working-timer-sessions.json");

  const loadSessions = (async function (): Promise<void> {
    try {
      const content = await vscode.workspace.fs.readFile(file);
      const data = JSON.parse(Buffer.from(content).toString("utf8"));

      if (Array.isArray(data.sessions)) {
        sessions = data.sessions;
      }
    } catch {
      sessions = [];
    }
  })();

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );

  statusBar.command = "workingTimer.toggle";
  statusBar.show();

  function getElapsed(): number {
    if (startedAt === undefined) {
      return elapsed;
    }

    return elapsed + Date.now() - startedAt;
  }

  function updateDisplay(): void {
    const seconds = Math.floor(getElapsed() / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;

    let time: string;

    if (hours > 0) {
      time =
        String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(rest).padStart(2, "0");
    } else {
      time =
        String(minutes).padStart(2, "0") + ":" +
        String(rest).padStart(2, "0");
    }

    if (startedAt === undefined) {
      statusBar.text = "$(debug-pause) ПАУЗА · " + time;
      statusBar.tooltip = "Timer paused — click to start";
    } else {
      statusBar.text = "$(clock) " + time;
      statusBar.tooltip = "Pause timer";
    }
  }

  async function save(): Promise<void> {
    if (currentSession === undefined) {
      return;
    }

    await loadSessions;

    currentSession.workTimeSeconds = Math.floor(getElapsed() / 1000);

    if (sessions.indexOf(currentSession) === -1) {
      sessions.push(currentSession);
    }

    try {
      await vscode.workspace.fs.createDirectory(directory);
      const data = JSON.stringify({ sessions: sessions }, null, 2);
      await vscode.workspace.fs.writeFile(file, Buffer.from(data));
    } catch (error) {
      console.error("Working Timer: could not save sessions", error);
    }
  }

  function stopIdleTimer(): void {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  }

  function pause(): void {
    if (startedAt === undefined) {
      return;
    }

    console.log("Пауза секундомера:", new Date().toLocaleTimeString());

    elapsed = getElapsed();
    startedAt = undefined;
    stopIdleTimer();

    if (displayTimer !== undefined) {
      clearInterval(displayTimer);
      displayTimer = undefined;
    }

    updateDisplay();
    void save();
  }

  function resetIdleTimer(): void {
    stopIdleTimer();

    console.log("Таймер бездействия запущен:", new Date().toLocaleTimeString());

    idleTimer = setTimeout(function (): void {
      console.log("15 секунд бездействия. Ставим на паузу.");
      pause();
    }, 15000);
  }

  function start(): void {
    if (startedAt !== undefined) {
      return;
    }

    if (currentSession === undefined) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");

      currentSession = {
        startTime: year + "-" + month + "-" + day + " " +
          hours + ":" + minutes + ":" + seconds,
        workTimeSeconds: 0
      };
    }

    console.log("Секундомер запущен:", new Date().toLocaleTimeString());

    startedAt = Date.now();
    displayTimer = setInterval(updateDisplay, 250);
    updateDisplay();
    resetIdleTimer();
  }

  function activity(): void {
    if (!vscode.window.state.focused) {
      return;
    }

    console.log("Обнаружено событие активности:", new Date().toLocaleTimeString());

    if (startedAt === undefined) {
      start();
    } else {
      resetIdleTimer();
    }
  }

  function documentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0) {
      return;
    }

    if (documentActivityTimer !== undefined) {
      clearTimeout(documentActivityTimer);
    }

    documentActivityTimer = setTimeout(function (): void {
      documentActivityTimer = undefined;
      console.log("Обнаружено изменение текста:", new Date().toLocaleTimeString());
      activity();
    }, 1000);
  }

  function documentSaved(document: vscode.TextDocument): void {
    if (documentActivityTimer !== undefined) {
      clearTimeout(documentActivityTimer);
      documentActivityTimer = undefined;
    }

    console.log("Файл сохранён, сохранение не считается активностью");
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("workingTimer.toggle", function (): void {
      if (startedAt === undefined) {
        start();
      } else {
        pause();
      }
    }),
    vscode.commands.registerCommand("workingTimer.start", start),
    vscode.commands.registerCommand("workingTimer.pause", pause),
    vscode.commands.registerCommand("workingTimer.reset", function (): void {
      elapsed = 0;

      if (startedAt !== undefined) {
        startedAt = Date.now();
      }

      updateDisplay();
      void save();
    }),
    vscode.window.onDidChangeTextEditorSelection(activity),
    vscode.workspace.onDidChangeTextDocument(documentChanged),
    vscode.workspace.onDidSaveTextDocument(documentSaved),
    vscode.window.onDidChangeActiveTextEditor(activity),
    vscode.window.onDidChangeWindowState(function (state): void {
      if (state.focused) {
        console.log("Окно VS Code получило фокус");
        activity();
      } else {
        console.log("Окно VS Code потеряло фокус");
      }
    }),
    statusBar
  );

  saveTimer = setInterval(function (): void {
    void save();
  }, 10000);

  saveOnClose = async function (): Promise<void> {
    pause();
    stopIdleTimer();

    if (documentActivityTimer !== undefined) {
      clearTimeout(documentActivityTimer);
      documentActivityTimer = undefined;
    }

    if (displayTimer !== undefined) {
      clearInterval(displayTimer);
      displayTimer = undefined;
    }

    if (saveTimer !== undefined) {
      clearInterval(saveTimer);
      saveTimer = undefined;
    }

    await save();
  };
}

export async function deactivate(): Promise<void> {
  if (saveOnClose !== undefined) {
    await saveOnClose();
    saveOnClose = undefined;
  }
}
