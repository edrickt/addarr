import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThrottle, MAX_ATTEMPTS, MAX_KEYS, WINDOW_MS } from './login-throttle.ts';

/** AD-06: the login backoff table could not evict fresh keys. */
test('AD-06: a username spray cannot grow the table without bound', () => {
	// 5,000 distinct `username@ip` keys inside one window: the old prune only
	// deleted entries older than the window, so all 5,000 stayed (the audit
	// measured ~300 B each, 8.9 MB → 15.1 MB heap from 20,000 requests).
	const throttle = createThrottle();
	for (let i = 0; i < 5000; i++) {
		throttle.recordFailure([`user:nobody${i}@10.0.0.9`, `ip:10.0.0.${i % 250}`]);
	}
	assert.ok(throttle.size <= MAX_KEYS, `table must stay capped, hold ${throttle.size} keys`);
});

test('AD-06: expired keys are dropped when the table is pruned', () => {
	let now = 1_000_000;
	const throttle = createThrottle({ now: () => now });
	throttle.recordFailure(['ip:10.0.0.1']);
	assert.equal(throttle.size, 1);

	now += WINDOW_MS + 1;
	throttle.prune();
	assert.equal(throttle.size, 0, 'a key older than the window is gone');
});

test('AS-04: a key is blocked after MAX_ATTEMPTS failures in the window', () => {
	let now = 5_000_000;
	const throttle = createThrottle({ now: () => now });
	const keys = ['user:alice@192.168.1.9', 'ip:192.168.1.9'];

	for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
		assert.equal(throttle.isBlocked(keys), false);
		throttle.recordFailure(keys);
	}
	assert.equal(throttle.isBlocked(keys), false, 'the 10th attempt is still answered');
	throttle.recordFailure(keys);
	assert.equal(throttle.isBlocked(keys), true, 'the 11th is refused');

	// The window slides: the same keys are usable again afterwards.
	now += WINDOW_MS + 1;
	assert.equal(throttle.isBlocked(keys), false);
});

test('AS-04: the per-IP key throttles username churn', () => {
	// This is the whole point: `user:<name>@<ip>` alone lets an attacker pick a
	// new name per request and buy unlimited argon2 work.
	const throttle = createThrottle();
	const ip = 'ip:192.168.1.9';
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		assert.equal(throttle.isBlocked([`user:nobody${i}@192.168.1.9`, ip]), false);
		throttle.recordFailure([`user:nobody${i}@192.168.1.9`, ip]);
	}
	assert.equal(throttle.isBlocked([`user:nobody${MAX_ATTEMPTS + 1}@192.168.1.9`, ip]), true);
	assert.equal(throttle.isBlocked([`user:someoneelse@192.168.1.10`, 'ip:192.168.1.10']), false, 'other clients are unaffected');
});

test('AS-04: a successful login clears both keys', () => {
	let now = 9_000_000;
	const throttle = createThrottle({ now: () => now });
	const keys = ['user:admin@10.0.0.2', 'ip:10.0.0.2'];
	for (let i = 0; i < MAX_ATTEMPTS; i++) throttle.recordFailure(keys);
	assert.equal(throttle.isBlocked(keys), true);

	throttle.clear(keys);
	assert.equal(throttle.isBlocked(keys), false);
	assert.equal(throttle.size, 0);
});
