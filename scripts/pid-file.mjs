// PID file format shared by the launcher (scripts/serve.mjs), the service CLI
// (scripts/service.mjs) and the generated Windows tray.
//
// Line 1 is "<pid> <startedAtMs>\n": the pid for status/stop/restart, plus the
// process start time so a reader can tell a live pid from a recycled one (D-02).
//
// Readers must take the FIRST field. Parsing the whole line as one integer is
// NaN in JavaScript and false for .NET [int]::TryParse, which is why Windows
// status always reported "not running" and stop/restart/tray-Quit silently did
// nothing (AD-02).

/**
 * @param {number} pid
 * @param {number} [startedAtMs]
 * @returns {string} the exact contents of data/addarr.pid
 */
export function formatPidFile(pid, startedAtMs = Date.now()) {
	return `${pid} ${startedAtMs}\n`;
}

/**
 * @param {string | null | undefined} text
 * @returns {number | null} the pid, or null for anything unusable
 */
export function parsePidFile(text) {
	const first = String(text ?? '').trim().split(/\s+/)[0] ?? '';
	if (!/^\d+$/.test(first)) return null;
	const pid = Number(first);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * @param {string | null | undefined} text
 * @returns {number | null} the start time in ms, or null when absent/unusable
 */
export function parsePidFileStartedAt(text) {
	const second = String(text ?? '').trim().split(/\s+/)[1] ?? '';
	if (!/^\d+$/.test(second)) return null;
	const started = Number(second);
	return Number.isSafeInteger(started) && started > 0 ? started : null;
}

/**
 * PowerShell twin of `parsePidFile`, interpolated into the generated tray
 * script so the two readers cannot drift. `$PidFile` is defined by the caller.
 */
export const PS_GET_SERVER_PID = `function Get-ServerPid {
  if (-not (Test-Path $PidFile)) { return 0 }
  $line = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $line) { return 0 }
  $serverPid = 0
  if ([int]::TryParse(([string]$line).Split(' ')[0], [ref]$serverPid) -and (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { return $serverPid }
  return 0
}`;
