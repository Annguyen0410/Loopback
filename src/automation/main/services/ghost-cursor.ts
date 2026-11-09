import { BrowserWindow } from 'electron'

/**
 * A tiny click-through overlay that marks where the VIRTUAL auto-clicker is
 * working — a visual "second cursor" while the user's real mouse stays free.
 * Frameless, transparent, always-on-top, never focusable, mouse-transparent.
 */

let win: BrowserWindow | null = null
const SIZE = 34

const MARKUP = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
#ring{position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px;border-radius:50%;border:2px solid #5b8cff;opacity:0}
#dot{position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px;transform:rotate(45deg);background:#7aa3ff;border:2px solid #fff;border-radius:3px;box-shadow:0 0 6px rgba(0,0,0,.55)}
body.go #ring{animation:ripple .4s ease-out}
@keyframes ripple{0%{transform:scale(.4);opacity:.95}100%{transform:scale(2.6);opacity:0}}
</style><div id="ring"></div><div id="dot"></div>
<script>function flash(){var b=document.body;b.classList.remove('go');void b.offsetWidth;b.classList.add('go')}</script>`

function url(): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(MARKUP)
}

function place(x: number, y: number): void {
  if (!win || win.isDestroyed()) return
  win.setBounds({ x: Math.round(x - SIZE / 2), y: Math.round(y - SIZE / 2), width: SIZE, height: SIZE })
}

export function showGhost(x: number, y: number): void {
  if (win && !win.isDestroyed()) {
    place(x, y)
    return
  }
  win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: Math.round(x - SIZE / 2),
    y: Math.round(y - SIZE / 2),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: { backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true) // click-through so it never blocks the target
  win.loadURL(url())
  win.once('ready-to-show', () => win?.showInactive())
}

export function flashGhost(x: number, y: number): void {
  if (!win || win.isDestroyed()) {
    showGhost(x, y)
    return
  }
  place(x, y)
  void win.webContents.executeJavaScript('if(typeof flash==="function")flash()').catch(() => undefined)
}

export function hideGhost(): void {
  if (win && !win.isDestroyed()) {
    win.destroy()
  }
  win = null
}
