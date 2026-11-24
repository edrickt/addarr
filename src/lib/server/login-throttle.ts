/**
 * Failed-login backoff.
 *
 * Two things went wrong with the inline map this replaces:
 *
 * - It was keyed `username@ip` and the username is attacker-controlled, so a
 *   loop of distinct *valid-format* names never tripped it: each request bought
 *   a full argon2id verification against `DUMMY_HASH` on the single event loop
 *   (AS-04). Nothing else was rate limited either.
 * - The opportunistic prune only dropped entries older than the window, so
 *   inside a window nothing was ever evicted and the map grew one ~300 B entry
 *   per distinct name, unbounded (AD-06).
 *
 * Now every failure is recorded under both keys (`user:<name>@<ip>` and
 * `ip:<ip>`), and the table is capped by size as well as by age.
 */

export const WINDOW_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 10;
/** Hard ceiling on tracked keys, so a spray cannot grow the map without bound. */
export const MAX_KEYS = 500;

export type ThrottleOptions = {
	windowMs?: number;
	maxAttempts?: number;
	maxKeys?: number;
	/** Injectable clock, for tests. */
	now?: () => number;
};

export type Throttle = {
	/** True when any of the keys has burned its budget inside the window. */
	isBlocked(keys: readonly string[]): boolean;
	recordFailure(keys: readonly string[]): void;
	/** Success: the caller proved the credentials, so forget its failures. */
	clear(keys: readonly string[]): void;
	prune(): void;
	readonly size: number;
};

type Entry = { count: number; first: number };

export function createThrottle(options: ThrottleOptions = {}): Throttle {
	const windowMs = options.windowMs ?? WINDOW_MS;
	const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
	const maxKeys = options.maxKeys ?? MAX_KEYS;
	const clock = options.now ?? Date.now;
	const attempts = new Map<string, Entry>();

	const stale = (entry: Entry, at: number): boolean => at - entry.first > windowMs;

	function prune(at: number = clock()): void {
		for (const [key, entry] of attempts) {
			if (stale(entry, at)) attempts.delete(key);
		}
		// Still over the cap: drop oldest-first (Map keeps insertion order, and a
		// spray always inserts new keys). Age alone cannot evict fresh keys.
		if (attempts.size > maxKeys) {
			for (const key of attempts.keys()) {
				attempts.delete(key);
				if (attempts.size <= maxKeys) break;
			}
		}
	}

	return {
		isBlocked(keys) {
			const at = clock();
			for (const key of keys) {
				const entry = attempts.get(key);
				if (!entry) continue;
				if (stale(entry, at)) {
					attempts.delete(key);
					continue;
				}
				if (entry.count >= maxAttempts) return true;
			}
			return false;
		},

		recordFailure(keys) {
			const at = clock();
			for (const key of keys) {
				const entry = attempts.get(key);
				if (!entry || stale(entry, at)) attempts.set(key, { count: 1, first: at });
				else entry.count++;
			}
			// Cheap on the common path: only walks the table when it can matter.
			if (attempts.size > maxKeys) prune(at);
		},

		clear(keys) {
			for (const key of keys) attempts.delete(key);
		},

		prune,

		get size() {
			return attempts.size;
		}
	};
}
