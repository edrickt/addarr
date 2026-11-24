import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	PS_GET_SERVER_PID,
	formatPidFile,
	parsePidFile,
	parsePidFileStartedAt
} from '../../../scripts/pid-file.mjs';

/**
 * AD-02: `scripts/serve.mjs` writes "<pid> <startedAtMs>" and every reader used
 * to parse the whole line as one integer. `Number("71723 1795529322443")` is
 * NaN and .NET `[int]::TryParse` on the same string is false, so on Windows
 * `npm run status` always said "not running", `npm run stop` deleted the PID
 * file without killing the server, and the tray's Stop/Restart/Quit were no-ops.
 */

test('AD-02: the PID file payload is two space-separated fields', () => {
	const text = formatPidFile(71723, 1795529322443);
	assert.equal(text, '71723 1795529322443\n');
	assert.equal(parsePidFile(text), 71723, 'the pid is the first field, not the whole line');
	assert.equal(parsePidFileStartedAt(text), 1795529322443);
});

test('AD-02: a bare pid (older files, tray pid file) still parses', () => {
	assert.equal(parsePidFile('4242\n'), 4242);
	assert.equal(parsePidFile(` 4242 `), 4242);
	assert.equal(parsePidFileStartedAt('4242\n'), null);
});

test('AD-02: unreadable or nonsensical PID files never invent a process', () => {
	for (const text of ['', '   ', '\n', 'abc 123', '0 123', '-5 123', '12.5 123', 'abc']) {
		assert.equal(parsePidFile(text), null, `"${text}" must not resolve to a pid`);
	}
});

test('AD-02: the generated Windows tray splits the first field like the CLI does', () => {
	// The tray is PowerShell and cannot import this module, so the contract is
	// asserted on the snippet it is generated from: TryParse on the whole line
	// is the bug, Split(' ')[0] is the fix.
	assert.match(PS_GET_SERVER_PID, /Split\(' '\)\[0\]/);
	assert.match(PS_GET_SERVER_PID, /function Get-ServerPid/);
	assert.doesNotMatch(PS_GET_SERVER_PID, /TryParse\(\$raw/);
});
