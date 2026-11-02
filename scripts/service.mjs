#!/usr/bin/env node
// Background service + desktop launcher for Addarr.
//
//   npm start          install/refresh, start in the background, open the app
//   npm run stop       stop it
//   npm run restart    restart it
//   npm run status     is it running?
//   npm run logs       follow the log
//   npm run uninstall  remove the service and the app icon
//
// Platform pieces:
//   macOS   launchd LaunchAgent (com.addarr.server) + ~/Applications/Addarr.app,
//           which puts an icon in Launchpad/Spotlight and starts the server on
//           click.
//   Linux   systemd user unit (addarr.service) + XDG desktop entry + icon.
//   Windows hidden VBS launcher in the Startup folder + Start Menu shortcut.
//
// Nothing here runs as root. Everything lives in the user's own directories
// and `npm run uninstall` removes it again.
import { spawn, spawnSync } from 'node:child_process';
import {
	chmodSync,
	renameSync,
	statSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureIcons } from './icons.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, 'data');
const LOG_PATH = join(DATA_DIR, 'addarr.log');
const ERR_PATH = join(DATA_DIR, 'addarr.error.log');
const PID_PATH = join(DATA_DIR, 'addarr.pid');
const NODE = process.execPath;
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const IS_WIN = process.platform === 'win32';

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('-')) ?? 'start';
const SERVICE_JSON = join(ROOT, 'data', 'service.json');
function savedConfig() {
	try { return JSON.parse(readFileSync(SERVICE_JSON, 'utf8')); } catch { return null; }
}
function persistConfig() {
	try {
		writeFileSync(SERVICE_JSON, JSON.stringify({ port, host: process.env.HOST ?? '0.0.0.0', dbPath: process.env.ADDARR_DB ?? join(ROOT, 'data', 'addarr.db'), root: ROOT, savedAt: new Date().toISOString() }, null, 2));
	} catch { /* best-effort */ }
}
const port = Number(process.env.PORT ?? savedConfig()?.port) || 4545;
function effectiveHost() {
	const h = process.env.HOST ?? savedConfig()?.host ?? '0.0.0.0';
	return h;
}
function bracketHost(h) { return h.includes(':') && !h.startsWith('[') ? `[${h}]` : h; }
function probeBase() {
	const h = effectiveHost();
	const loopback = h === '0.0.0.0' || h === '::' ? 'localhost' : h;
	return `http://${bracketHost(loopback)}:${port}`;
}
const url = probeBase();
const LABEL = 'com.addarr.server';
const UNIT = 'addarr.service';

const VERSION = (() => {
	try {
		return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
})();

// --- small helpers ---------------------------------------------------------

function run(cmd, cmdArgs, options = {}) {
	return spawnSync(cmd, cmdArgs, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		...options
	});
}

function captured(cmd, cmdArgs) {
	const result = run(cmd, cmdArgs);
	return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Any HTTP response means the server is up (it may redirect to /setup). */
export async function waitForServer(target = url, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await fetch(target, { signal: AbortSignal.timeout(1500), redirect: 'manual' });
			return true;
		} catch {
			await sleep(400);
		}
	}
	return false;
}

async function portBusy() {
	try {
		await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'manual' });
		return true;
	} catch {
		return false;
	}
}

export function openBrowser(target = url) {
	if (process.env.ADDARR_NO_BROWSER === '1') return;
	try {
		if (IS_MAC) spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
		else if (IS_WIN)
			spawn('cmd', ['/c', 'start', '', target], {
				detached: true,
				stdio: 'ignore',
				windowsHide: true
			}).unref();
		else spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
	} catch {
		console.log(`Open ${target} in your browser.`);
	}
}

function xmlEscape(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function plistDict(entries) {
	return Object.entries(entries)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `\t<key>${xmlEscape(key)}</key>\n${plistValue(value)}`)
		.join('\n');
}

function plistValue(value) {
	if (typeof value === 'boolean') return `\t<${value}/>`;
	if (typeof value === 'number') return `\t<integer>${value}</integer>`;
	if (Array.isArray(value)) return `\t<array>\n${value.map((v) => `\t\t<string>${xmlEscape(v)}</string>`).join('\n')}\n\t</array>`;
	if (value && typeof value === 'object')
		return `\t<dict>\n${Object.entries(value)
			.map(([k, v]) => `\t\t<key>${xmlEscape(k)}</key>\n${plistValue(v).replace(/^\t/gm, '\t\t')}`)
			.join('\n')}\n\t</dict>`;
	return `\t<string>${xmlEscape(value)}</string>`;
}

/** User-facing overrides baked into the launcher, on every platform. */
function overrideEnv() {
	const env = { PORT: String(port) };
	for (const key of ['HOST', 'ADDARR_LAN', 'ADDARR_DB']) {
		const value = process.env[key];
		if (!value) continue;
		env[key] = key === 'ADDARR_DB' && !isAbsolute(value) ? resolve(process.cwd(), value) : value;
	}
	// Explicit --lan always wins, even over ADDARR_LAN=0 (F-SCRIPT-15).
	if (args.includes('--lan')) env.ADDARR_LAN = '1';
	return env;
}

/** Environment baked into the service, so restarts and logins behave the same. */
function serviceEnv() {
	const pathEntries = [
		dirname(NODE),
		...(process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin').split(IS_WIN ? ';' : ':')
	];
	return {
		PATH: [...new Set(pathEntries.filter(Boolean))].join(IS_WIN ? ';' : ':'),
		ADDARR_MANAGED: IS_MAC ? 'launchd' : IS_LINUX ? 'systemd' : '1',
		...overrideEnv()
	};
}

function rotateIfLarge(file, maxBytes = 5 * 1024 * 1024) {
	try {
		const s = statSync(file);
		if (s.size > maxBytes) {
			const bak = `${file}.1`;
			try { rmSync(bak, { force: true }); } catch {}
			try { renameSync(file, bak); } catch {}
			writeFileSync(file, '');
		}
	} catch { /* missing file */ }
}

function ensureDataDir() {
	mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
	persistConfigSafe();
	try { chmodSync(DATA_DIR, 0o700); } catch { /* Windows */ }
	for (const file of [LOG_PATH, ERR_PATH, join(DATA_DIR, 'addarr-tray.log')]) {
		if (!existsSync(file)) writeFileSync(file, '');
	}
}

function persistConfigSafe() { try { persistConfig(); } catch { /* ignore */ } }

function readPid() {
	try {
		const pid = Number(readFileSync(PID_PATH, 'utf8').trim());
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const stripEmpty = (value) => (value ? value : '');

// --- macOS -----------------------------------------------------------------

const MAC_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const MAC_APP = join(homedir(), 'Applications', 'Addarr.app');
// process.getuid() does not exist on Windows, so keep this lazy: this module
// is imported on every platform.
const macDomain = () => `gui/${process.getuid()}`;

/** Bootout returns before launchd has finished tearing the job down. */
function macUnload(timeoutMs = 5000) {
	run('launchctl', ['bootout', `${macDomain()}/${LABEL}`]);
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (captured('launchctl', ['print', `${macDomain()}/${LABEL}`]) === '') return true;
		run('sleep', ['0.1']);
	}
	return false;
}

function macWritePlist() {
	mkdirSync(dirname(MAC_PLIST), { recursive: true });
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${plistDict({
	Label: LABEL,
	ProgramArguments: [NODE, join(ROOT, 'scripts', 'serve.mjs')],
	WorkingDirectory: ROOT,
	EnvironmentVariables: serviceEnv(),
	RunAtLoad: true,
	KeepAlive: true,
	// Short enough that in-app restarts feel instant, long enough to avoid
	// hammering a crashing process.
	ThrottleInterval: 2,
	ProcessType: 'Interactive',
	StandardOutPath: LOG_PATH,
	StandardErrorPath: ERR_PATH
})}
</dict>
</plist>
`;
	writeFileSync(MAC_PLIST, body);
}

function macWriteApp() {
	const { icnsPath } = ensureIcons();
	rmSync(MAC_APP, { recursive: true, force: true });
	mkdirSync(join(MAC_APP, 'Contents', 'MacOS'), { recursive: true });
	mkdirSync(join(MAC_APP, 'Contents', 'Resources'), { recursive: true });

	const info = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${plistDict({
	CFBundleName: 'Addarr',
	CFBundleDisplayName: 'Addarr',
	CFBundleIdentifier: 'local.addarr.launcher',
	CFBundleExecutable: 'Addarr',
	CFBundleIconFile: icnsPath ? 'AppIcon' : undefined,
	CFBundlePackageType: 'APPL',
	CFBundleShortVersionString: VERSION,
	CFBundleVersion: VERSION,
	LSMinimumSystemVersion: '11.0',
	NSHighResolutionCapable: true,
	LSApplicationCategoryType: 'public.app-category.utilities'
})}
</dict>
</plist>
`;
	writeFileSync(join(MAC_APP, 'Contents', 'Info.plist'), info);

	// The bundle executable: make sure launchd knows the service, wait for the
	// HTTP port, then hand the URL to the default browser.
	const launcher = `#!/bin/sh
# Addarr — starts the background service if needed, then opens the app.
LABEL="${LABEL}"
DOMAIN="${macDomain()}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
URL="${url}"
NODE="${String(NODE).replace(/(["$`\\])/g, '\\$1')}"

if ! /bin/launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
	/bin/launchctl bootstrap "$DOMAIN" "$PLIST" >/dev/null 2>&1
fi
/bin/launchctl kickstart "$DOMAIN/$LABEL" >/dev/null 2>&1

i=0
while [ "$i" -lt 60 ]; do
	if "$NODE" -e "fetch('$URL',{redirect:'manual'}).then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1; then
		break
	fi
	i=$((i + 1))
	/bin/sleep 0.5
done

if [ "$i" -ge 60 ]; then
	/usr/bin/osascript -e 'display alert "Addarr could not start" message "Try again, or run: npm run logs" as critical' >/dev/null 2>&1
	exit 1
fi

if [ "$ADDARR_NO_BROWSER" = "1" ]; then
	exit 0
fi
/usr/bin/open "$URL"
`;
	const launcherPath = join(MAC_APP, 'Contents', 'MacOS', 'Addarr');
	writeFileSync(launcherPath, launcher);
	chmodSync(launcherPath, 0o755);

	if (icnsPath) copyFileSync(icnsPath, join(MAC_APP, 'Contents', 'Resources', 'AppIcon.icns'));

	// Nudge Launchpad/Spotlight to pick the bundle up right away.
	const lsregister =
		'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
	if (existsSync(lsregister)) run(lsregister, ['-f', MAC_APP]);
}

const mac = {
	name: 'launchd LaunchAgent',
	install() {
		const loaded = captured('launchctl', ['print', `${macDomain()}/${LABEL}`]) !== '';
		macWritePlist();
		macWriteApp();
		// Unload a running job so the next start re-reads the plist; launchd only
		// picks up environment/argument changes at bootstrap time.
		if (loaded) macUnload();
	},
	running() {
		const out = captured('launchctl', ['print', `${macDomain()}/${LABEL}`]);
		const match = out.match(/state = running[\s\S]*?pid = (\d+)/);
		return match ? Number(match[1]) : null;
	},
	stop() {
		macUnload();
	},
	uninstall() {
		macUnload();
		rmSync(MAC_PLIST, { force: true });
		rmSync(MAC_APP, { recursive: true, force: true });
	},
	where: () => MAC_APP,
	startHint: 'Open Addarr from Launchpad (or run npm start).'
};

// --- Linux -----------------------------------------------------------------

const LINUX_UNIT = join(homedir(), '.config', 'systemd', 'user', UNIT);
const LINUX_APPS = join(homedir(), '.local', 'share', 'applications', 'addarr.desktop');
const LINUX_LAUNCH = join(homedir(), '.local', 'share', 'addarr', 'launch.sh');
const LINUX_ICON = join(homedir(), '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'addarr.png');
const systemctl = (ctlArgs) => run('systemctl', ['--user', ...ctlArgs]);

function linuxWriteUnit() {
	mkdirSync(dirname(LINUX_UNIT), { recursive: true });
	const env = serviceEnv();
	const envLines = Object.entries(env)
		.map(([k, v]) => `Environment="${k}=${String(v).replace(/%/g, '%%').replace(/"/g, '\\"')}"`)
		.join('\n');
	writeFileSync(
		LINUX_UNIT,
		`[Unit]
Description=Addarr — one-tap movie & series adds
After=network-online.target

[Service]
Type=simple
WorkingDirectory="${ROOT}"
ExecStart="${NODE}" "${join(ROOT, 'scripts', 'serve.mjs')}"
${envLines}
Restart=always
RestartSec=2
StandardOutput=append:"${LOG_PATH}"
StandardError=append:"${ERR_PATH}"

[Install]
WantedBy=default.target
`
	);
}

function linuxWriteLauncher() {
	let pngPath = '';
	try { ({ pngPath } = ensureIcons()); } catch (err) { console.warn(`Icons unavailable, continuing without them: ${err?.message ?? err}`); }
	mkdirSync(dirname(LINUX_LAUNCH), { recursive: true });
	mkdirSync(dirname(LINUX_ICON), { recursive: true });
	mkdirSync(dirname(LINUX_APPS), { recursive: true });
	copyFileSync(pngPath, LINUX_ICON);

	writeFileSync(
		LINUX_LAUNCH,
		`#!/bin/sh
# Addarr — starts the background service if needed, then opens the app.
systemctl --user start addarr.service >/dev/null 2>&1
i=0
while [ "$i" -lt 60 ]; do
	if "${NODE}" -e "fetch('${url}',{redirect:'manual'}).then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1; then
		break
	fi
	i=$((i + 1))
	sleep 0.5
done
[ "$ADDARR_NO_BROWSER" = "1" ] && exit 0
xdg-open "${url}" >/dev/null 2>&1 &
`
	);
	chmodSync(LINUX_LAUNCH, 0o755);

	writeFileSync(
		LINUX_APPS,
		`[Desktop Entry]
Type=Application
Name=Addarr
Comment=One-tap movie & series adds
Exec=${LINUX_LAUNCH}
Icon=addarr
Terminal=false
Categories=Network;AudioVideo;
StartupNotify=false
`
	);
}

const linux = {
	name: 'systemd user service',
	install() {
		linuxWriteUnit();
		linuxWriteLauncher();
		systemctl(['daemon-reload']);
		const result = systemctl(['enable', UNIT]);
		if (result.status !== 0) {
			throw new Error(
				`systemctl --user failed: ${stripEmpty(result.stderr) || 'no user session bus?'}\n` +
					'On a headless machine, enable the user session with: sudo loginctl enable-linger $USER'
			);
		}
	},
	running() {
		const out = captured('systemctl', ['--user', 'show', UNIT, '--property=MainPID', '--value']);
		return Number(out) > 0 ? Number(out) : null;
	},
	stop() {
		systemctl(['stop', UNIT]);
	},
	uninstall() {
		systemctl(['disable', '--now', UNIT]);
		rmSync(LINUX_UNIT, { force: true });
		rmSync(LINUX_APPS, { force: true });
		rmSync(LINUX_LAUNCH, { force: true });
		rmSync(LINUX_ICON, { force: true });
		systemctl(['daemon-reload']);
	},
	where: () => LINUX_APPS,
	startHint: 'Run npm start (or click Addarr in your apps menu).'
};

// --- Windows ---------------------------------------------------------------

const APPDATA = process.env.APPDATA || homedir();
const WIN_DIR = join(APPDATA, 'Addarr');
const WIN_SERVER_VBS = join(WIN_DIR, 'AddarrServer.vbs'); // hidden server launcher
const WIN_TRAY_PS1 = join(WIN_DIR, 'AddarrTray.ps1'); // notification-area host
const WIN_TRAY_VBS = join(WIN_DIR, 'AddarrTray.vbs'); // hidden launcher for the above
const WIN_START_VBS = join(WIN_DIR, 'Addarr.vbs'); // server + tray (Startup entry)
const WIN_OPEN_VBS = join(WIN_DIR, 'AddarrOpen.vbs'); // start if needed, open browser
const WIN_STARTUP = join(
	APPDATA,
	'Microsoft',
	'Windows',
	'Start Menu',
	'Programs',
	'Startup',
	'Addarr.vbs'
);
const WIN_LNK = join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Addarr.lnk');

// WSH reads .vbs as ANSI unless it sees a UTF-16 BOM, and Windows profile paths
// are not always ASCII, so write script files the way cscript expects them.
function writeUnicodeScript(file, content) {
	writeFileSync(
		file,
		Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')])
	);
}

function psQuote(value) {
	return `'${String(value).replace(/'/g, "''")}'`;
}

function winEnvLines() {
	return Object.entries({ ...overrideEnv(), ADDARR_LOG: '1' })
		.map(([key, value]) => `sh.Environment("PROCESS")("${key}") = "${String(value).replace(/"/g, '""')}"`)
		.join('\n');
}

/** Windows PowerShell 5.1 needs a BOM to read UTF-8 with non-ASCII paths. */
function writePowerShellScript(file, content) {
	writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')]));
}

function winTrayScript(pngPath, logPath, dataDir) {
	const pidFile = join(dataDir, 'addarr.pid');
	const trayPidFile = join(dataDir, 'addarr-tray.pid');
	const serverLog = join(dataDir, 'addarr.log');
	return `# Addarr tray icon. Generated by scripts/service.mjs (npm start) - do not edit.
$ErrorActionPreference = 'Continue'
$Url = 'http://localhost:${port}'
$DataDir = ${psQuote(dataDir)}
$PidFile = ${psQuote(pidFile)}
$TrayPidFile = ${psQuote(trayPidFile)}
$LogFile = ${psQuote(logPath)}
$IconPng = ${psQuote(pngPath)}
$ServerVbs = ${psQuote(WIN_SERVER_VBS)}

function Write-TrayLog([string]$Message) {
  try { Add-Content -Path $LogFile -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) } catch { }
}

# One tray per session.
if (Test-Path $TrayPidFile) {
  $other = 0
  $raw = Get-Content $TrayPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ([int]::TryParse($raw, [ref]$other) -and (Get-Process -Id $other -ErrorAction SilentlyContinue)) { exit 0 }
}
Set-Content -Path $TrayPidFile -Value $PID

function Get-ServerPid {
  if (-not (Test-Path $PidFile)) { return 0 }
  $raw = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  $serverPid = 0
  if ([int]::TryParse($raw, [ref]$serverPid) -and (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { return $serverPid }
  return 0
}

function Start-AddarrServer {
  if ((Get-ServerPid) -gt 0) { return }
  Write-TrayLog 'starting server'
  Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + $ServerVbs + '"') -WindowStyle Hidden -ErrorAction SilentlyContinue
}

function Stop-AddarrServer {
  $serverPid = Get-ServerPid
  if ($serverPid -gt 0) {
    Write-TrayLog ("stopping server (pid $serverPid)")
    Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

function Wait-Addarr([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Open-Addarr {
  Start-AddarrServer
  if (Wait-Addarr 30) { Start-Process $Url } else { Write-TrayLog 'open: server did not come up in time' }
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Text = 'Addarr'
  $notify.Icon = [System.Drawing.SystemIcons]::Application
  try {
    if (Test-Path $IconPng) {
      $bytes = [System.IO.File]::ReadAllBytes($IconPng)
      $stream = New-Object System.IO.MemoryStream(,$bytes)
      $image = [System.Drawing.Image]::FromStream($stream)
      $notify.Icon = [System.Drawing.Icon]::FromHandle($image.GetHicon())
    }
  } catch {
    Write-TrayLog ('icon load failed: ' + $_.Exception.Message)
  }

  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $itemOpen = $menu.Items.Add('Open Addarr')
  $itemRestart = $menu.Items.Add('Restart server')
  $itemStop = $menu.Items.Add('Stop server')
  $itemLog = $menu.Items.Add('Open log')
  [void]$menu.Items.Add('-')
  $itemQuit = $menu.Items.Add('Quit Addarr')
  $notify.ContextMenuStrip = $menu

  $itemOpen.add_Click({ try { Open-Addarr } catch { Write-TrayLog ('open failed: ' + $_.Exception.Message) } })
  $notify.add_MouseDoubleClick({ try { Open-Addarr } catch { Write-TrayLog ('open failed: ' + $_.Exception.Message) } })
  $itemRestart.add_Click({ try { Stop-AddarrServer; Start-Sleep -Milliseconds 500; Start-AddarrServer } catch { } })
  $itemStop.add_Click({ try { Stop-AddarrServer } catch { } })
  $itemLog.add_Click({ try { Start-Process ${psQuote(serverLog)} } catch { } })
  $itemQuit.add_Click({
    try {
      Stop-AddarrServer
      $notify.Visible = $false
      $notify.Dispose()
      Remove-Item $TrayPidFile -ErrorAction SilentlyContinue
    } catch { }
    [System.Windows.Forms.Application]::Exit()
  })

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 5000
  $timer.add_Tick({
    try { $notify.Text = if ((Get-ServerPid) -gt 0) { 'Addarr - running' } else { 'Addarr - stopped' } } catch { }
  })
  $timer.Start()

  $notify.Visible = $true
  Write-TrayLog 'tray started'
  [System.Windows.Forms.Application]::Run()
} catch {
  Write-TrayLog ('tray failed: ' + $_.Exception.Message)
  exit 1
}
`;
}

function winWriteLauncher() {
	const { icoPath, png32Path } = ensureIcons();
	mkdirSync(WIN_DIR, { recursive: true });
	mkdirSync(dirname(WIN_STARTUP), { recursive: true });

	// Server launcher: hidden node, repo as cwd (data/addarr.db resolves from it).
	writeUnicodeScript(
		WIN_SERVER_VBS,
		`Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "${ROOT}"
${winEnvLines()}
sh.Run """${NODE}"" ""${join(ROOT, 'scripts', 'serve.mjs')}""", 0, False
`
	);

	// Tray host + hidden launcher for it.
	writePowerShellScript(WIN_TRAY_PS1, winTrayScript(png32Path, join(DATA_DIR, 'addarr-tray.log'), DATA_DIR));
	writeUnicodeScript(
		WIN_TRAY_VBS,
		`Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${WIN_TRAY_PS1}""", 0, False
`
	);

	// Startup entry: server first, tray second, so a broken tray host still
	// leaves a running server. This is also what `npm start` launches.
	writeUnicodeScript(
		WIN_START_VBS,
		`Set sh = CreateObject("WScript.Shell")
sh.Run """wscript.exe"" ""${WIN_SERVER_VBS}""", 0, False
sh.Run """wscript.exe"" ""${WIN_TRAY_VBS}""", 0, False
`
	);
	copyFileSync(WIN_START_VBS, WIN_STARTUP);

	// Start menu shortcut: start the server if needed, then open the browser.
	writeUnicodeScript(
		WIN_OPEN_VBS,
		`Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "${ROOT}"
sh.Run """${NODE}"" ""${join(ROOT, 'scripts', 'service.mjs')}"" open", 0, False
`
	);

	const ps = [
		'$ws = New-Object -ComObject WScript.Shell',
		`$sc = $ws.CreateShortcut('${WIN_LNK.replace(/'/g, "''")}')`,
		'$sc.TargetPath = "wscript.exe"',
		`$sc.Arguments = '"${WIN_OPEN_VBS}"'`,
		'$sc.WorkingDirectory = "' + ROOT + '"',
		'$sc.Description = "Addarr"',
		icoPath ? `$sc.IconLocation = "${icoPath}"` : '',
		'$sc.Save()'
	]
		.filter(Boolean)
		.join('; ');
	const result = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
	if (!existsSync(WIN_LNK)) {
		console.warn(`Could not create the Start menu shortcut at ${WIN_LNK}`);
		if (result.stderr) console.warn(result.stderr.trim());
	}
}

function readTrayPid() {
	try {
		const pid = Number(readFileSync(join(DATA_DIR, 'addarr-tray.pid'), 'utf8').trim());
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

const windows = {
	name: 'Startup launcher + tray icon',
	install() {
		winWriteLauncher();
	},
	installed() {
		return existsSync(WIN_START_VBS) && existsSync(WIN_LNK);
	},
	running() {
		const pid = readPid();
		return pid && pidAlive(pid) ? pid : null;
	},
	stop() {
		const pid = readPid();
		if (pid) run('taskkill', ['/PID', String(pid), '/T', '/F']);
		rmSync(PID_PATH, { force: true });
	},
	uninstall() {
		this.stop();
		const trayPid = readTrayPid();
		if (trayPid) run('taskkill', ['/PID', String(trayPid), '/T', '/F']);
		rmSync(join(DATA_DIR, 'addarr-tray.pid'), { force: true });
		rmSync(WIN_STARTUP, { force: true });
		rmSync(WIN_LNK, { force: true });
		rmSync(WIN_START_VBS, { force: true });
		rmSync(WIN_SERVER_VBS, { force: true });
		rmSync(WIN_TRAY_VBS, { force: true });
		rmSync(WIN_OPEN_VBS, { force: true });
		rmSync(WIN_TRAY_PS1, { force: true });
	},
	where: () => WIN_LNK,
	startHint: 'Run npm start (or search "Addarr" in the Start menu).'
};

const platform = IS_MAC ? mac : IS_LINUX ? linux : IS_WIN ? windows : null;

// --- commands --------------------------------------------------------------

function startService() {
	if (IS_MAC) {
		const loaded = captured('launchctl', ['print', `${macDomain()}/${LABEL}`]) !== '';
		if (!loaded) {
			const boot = run('launchctl', ['bootstrap', macDomain(), MAC_PLIST]);
			if (boot.status !== 0) {
				throw new Error(`launchctl bootstrap failed: ${stripEmpty(boot.stderr) || 'unknown error'}`);
			}
		}
		const kick = run('launchctl', ['kickstart', '-k', `${macDomain()}/${LABEL}`]);
		if (kick.status !== 0) {
			throw new Error(`launchctl kickstart failed: ${stripEmpty(kick.stderr) || 'unknown error'}`);
		}
	} else if (IS_LINUX) {
		// restart, not start: `systemctl start` on a running unit is a no-op, and
		// a reinstalled unit only takes effect on the next start.
		const active = captured('systemctl', ['--user', 'is-active', UNIT]) === 'active';
		const result = systemctl([active ? 'restart' : 'start', UNIT]);
		if (result.status !== 0) throw new Error(stripEmpty(result.stderr) || 'systemctl start failed');
	} else if (IS_WIN) {
		const pid = windows.running();
		if (pid) windows.stop();
		// Start VBS = server, then tray. The tray's single-instance guard keeps a
		// second launch from adding a duplicate icon.
		spawn('wscript.exe', [WIN_START_VBS], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
	}
}

function verifyStopped() {
	const pid = platform?.running?.();
	if (pid) { console.error(`Stop failed — Addarr still running (pid ${pid}).`); return false; }
	return true;
}

function printStatus() {
	if (!platform) {
		console.log('Background service install is supported on macOS, Linux, and Windows.');
		return 1;
	}
	const pid = platform.running();
	if (pid) {
		console.log(`Addarr is running (pid ${pid}) at ${url}`);
		return 0;
	}
	console.log(`Addarr is not running. ${platform.startHint}`);
	return 1;
}

async function commandStart() {
	ensureDataDir();
	if (!platform) {
		console.log('No service manager on this platform — starting in the foreground instead.');
		const child = spawn(NODE, [join(ROOT, 'scripts', 'serve.mjs')], { stdio: 'inherit' });
		child.on('error', (err) => { console.error(`Failed to start server: ${err.message}`); process.exit(1); });
		child.on('exit', (code) => process.exit(code ?? 0));
		return;
	}

	const wasRunning = Boolean(platform.running());
	platform.install();

	// Start only if nothing else owns the port; a foreign listener would leave
	// the service crash-looping against it.
	const busy = !wasRunning && (await portBusy());
	if (busy) {
		console.log(`Port ${port} is already in use — Addarr is installed but left stopped.`);
	} else {
		startService();
	}

	const up = busy ? false : await waitForServer();
	console.log('');
	if (up) {
		console.log(`  Addarr is running in the background at ${url}`);
	} else {
		console.log(`  Addarr was installed but has not answered yet on ${url}.`);
	}
	console.log('');
	console.log(`  App icon:  ${platform.where()}`);
	console.log(`  Logs:      npm run logs`);
	console.log(`  Stop:      npm run stop`);
	console.log(`  Remove:    npm run uninstall`);
	console.log('');
	console.log('  It also starts automatically at login. You can close this terminal.');
	console.log('');
	if (up) openBrowser();
	else console.log(`  Check the log for details: ${LOG_PATH}`);
}

async function commandRestart() {
	if (!platform) return printStatus();
	if (!platform.running()) {
		console.log('Addarr was not running — starting it.');
		platform.install();
	}
	startService();
	const up = await waitForServer();
	console.log(up ? `Addarr restarted at ${url}` : `Addarr did not come back up — see ${LOG_PATH}`);
	process.exitCode = up ? 0 : 1;
}

async function commandOpen() {
	if (platform && !platform.running() && !(await portBusy())) {
		console.log('Addarr is not running — starting it…');
		if (!platform.installed?.()) platform.install();
		startService();
		await waitForServer();
	}
	openBrowser();
}

function commandLogs() {
	ensureDataDir();
	const trayLog = join(DATA_DIR, 'addarr-tray.log');
	const cmd = IS_WIN ? 'powershell' : 'tail';
	const cmdArgs = IS_WIN
		? [
				'-NoProfile',
				'-Command',
				`Get-Content -Path '${LOG_PATH}','${ERR_PATH}','${trayLog}' -Tail 50 -Wait`
			]
		: ['-n', '50', '-f', LOG_PATH, ERR_PATH, trayLog];
	const child = spawn(cmd, cmdArgs, { stdio: 'inherit' });
	child.on('exit', (code) => process.exit(code ?? 0));
}

function refuseRoot() {
	try {
		if (typeof process.getuid === 'function' && process.getuid() === 0) {
			console.error('Refusing to install as root — run npm start as your desktop user.');
			process.exit(1);
		}
	} catch { /* ignore */ }
}

async function main() {
	switch (command) {
		case 'install': {
			refuseRoot();
			ensureDataDir();
			if (!platform) {
				console.log('Unsupported platform.');
				break;
			}
			platform.install();
			if (!(await portBusy())) {
				startService();
				await waitForServer();
			}
			printStatus();
			break;
		}
		case 'start':
			await commandStart();
			break;
		case 'open':
			await commandOpen();
			break;
		case 'restart':
			await commandRestart();
			break;
		case 'stop':
			platform?.stop();
			console.log('Addarr stopped. Start it again with npm start or the app icon.');
			break;
		case 'status':
			process.exitCode = printStatus();
			break;
		case 'logs':
			commandLogs();
			break;
		case 'uninstall':
			platform?.uninstall();
			console.log('Addarr service and app icon removed. Your data in data/addarr.db is untouched.');
			break;
		default:
			console.log(`Unknown command: ${command}\nUse: start | stop | restart | status | logs | open | uninstall`);
			process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
