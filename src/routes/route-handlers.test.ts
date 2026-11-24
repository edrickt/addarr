import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Route-handler regression tests, run in-process against a throwaway SQLite
 * database. SvelteKit route modules import `$lib/...` (Vite alias) and
 * extensionless relative paths (Vite resolution); a small resolve hook teaches
 * plain `node --test` those two rules so the real handlers can be called
 * without starting the app or a browser. No network beyond 127.0.0.1 fakes.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = join(ROOT, 'src', 'lib');
const SRC_PREFIX = join(ROOT, 'src') + sep;

const isFile = (path: string): boolean => {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		let base: string | null = null;
		if (specifier.startsWith('$lib/')) {
			base = resolve(LIB, specifier.slice(5));
		} else if (specifier.startsWith('.') && !/\.[mc]?[jt]s$/.test(specifier) && context.parentURL?.startsWith('file:')) {
			try {
				const parent = fileURLToPath(context.parentURL);
				if (parent.startsWith(SRC_PREFIX)) base = resolve(dirname(parent), specifier);
			} catch {
				/* leave unresolvable parents to the default resolver */
			}
		}
		if (!base) return nextResolve(specifier, context);
		for (const candidate of [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts')]) {
			if (isFile(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
		}
		return nextResolve(specifier, context);
	}
});

// Point the data layer at a throwaway database before importing anything that
// opens it; the repo's data/addarr.db must never be touched by a test run.
const dir = mkdtempSync(join(tmpdir(), 'addarr-routes-test-'));
process.env.ADDARR_DB = join(dir, 'addarr.db');

const { db } = await import('../lib/server/db.ts');
const { load: loginLoad } = await import('./login/+page.server.ts');
const search = await import('./api/search/+server.ts');
const status = await import('./api/status/[kind]/[id]/+server.ts');
const batch = await import('./api/status/batch/+server.ts');
const setup = await import('./api/auth/setup/+server.ts');
const services = await import('./api/services/+server.ts');
const lan = await import('./api/settings/lan/+server.ts');
const login = await import('./api/auth/login/+server.ts');
const { hashPin } = await import('../lib/server/auth.ts');
const { ensureSetupToken, forgetSetupToken } = await import('../lib/server/setup-token.ts');
const add = await import('./api/add/+server.ts');

after(() => {
	try {
		db.close();
	} catch {
		/* best-effort */
	}
	rmSync(dir, { recursive: true, force: true });
});

type JsonBody = Record<string, unknown>;

/** Call a SvelteKit handler with a minimal, typed-enough fake event. */
async function callHandler(
	handler: (event: never) => unknown,
	event: Record<string, unknown>
): Promise<{ status: number; body: JsonBody }> {
	const response = await (handler as unknown as (event: unknown) => Promise<Response>)(event);
	return { status: response.status, body: (await response.json()) as JsonBody };
}

function searchEvent(kind: string, q = 'dune'): Record<string, unknown> {
	const url = new URL(`http://localhost/api/search?service=${kind}&q=${q}`);
	return { url, request: new Request(url) };
}

test('AUD-02: the login page reports the real first-run state so /setup is reachable', async () => {
	// Pre-fix this load returned a hard-coded { hasAdmin: true }: a fresh install
	// showed a sign-in form for an account that cannot exist and hid the only
	// visible link to first-time setup.
	const before = (await loginLoad({} as never)) as { hasAdmin: boolean };
	assert.equal(before.hasAdmin, false, 'no admin exists yet');

	db.prepare(`INSERT INTO users (id, username, pin_hash, role) VALUES (90, 'probe-admin', 'x', 'admin')`).run();
	const afterSetup = (await loginLoad({} as never)) as { hasAdmin: boolean };
	assert.equal(afterSetup.hasAdmin, true, 'after first-run setup the sign-in form is correct');
	db.prepare(`DELETE FROM users WHERE id = 90`).run();
});

test('AUD-03: search of a not-connected service is a normal state, not a 400 failure', async () => {
	const res = await callHandler(search.GET, searchEvent('series'));
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.results, []);
	assert.equal(res.body.unconfigured, true);
});

test('AUD-04: status polling rejects non-positive ids instead of inventing "waiting"', async () => {
	for (const id of ['0', '-1', 'abc', '1.5']) {
		const url = new URL(`http://localhost/api/status/movie/${id}`);
		const res = await callHandler(status.GET, {
			params: { kind: 'movie', id },
			url,
			request: new Request(url)
		});
		assert.equal(res.status, 400, `id ${id} must be rejected`);
		assert.match(String(res.body.error), /invalid id/);
	}
});

type FakeRadarrOptions = { lookupStatus?: number; addStatus?: number };

/** Minimal fake Radarr whose lookup/add answers are configurable per test. */
function fakeRadarr(options: FakeRadarrOptions = {}): Promise<{ server: Server; baseUrl: string }> {
	const { lookupStatus = 200, addStatus = 200 } = options;
	const server = createServer((req, res) => {
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		if (req.method === 'GET' && req.url === '/api/v3/movie') return send(200, []);
		if (req.method === 'GET' && req.url?.startsWith('/api/v3/movie/lookup/tmdb')) {
			return lookupStatus === 200
				? send(200, { tmdbId: 123, title: 'Rejected Movie', year: 2024 })
				: send(lookupStatus, { message: `lookup failed: ${lookupStatus}` });
		}
		if (req.method === 'POST' && req.url === '/api/v3/movie') {
			return addStatus === 200
				? send(201, { id: 1, tmdbId: 123, title: 'Rejected Movie' })
				: send(addStatus, { message: `add failed: ${addStatus}` });
		}
		return send(404, {});
	});
	return new Promise((resolveServer) => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			resolveServer({ server, baseUrl: `http://127.0.0.1:${port}` });
		});
	});
}

function seedRadarr(baseUrl: string): void {
	db.prepare(
		`INSERT INTO services (type, name, base_url, api_key, app_version) VALUES ('radarr', 'Radarr', ?, 'k', '5.0.0')`
	).run(baseUrl);
	const serviceId = Number(
		(db.prepare(`SELECT id FROM services WHERE type = 'radarr'`).get() as { id: number }).id
	);
	db.prepare(
		`INSERT INTO presets (service_id, name, is_default, quality_profile_id, root_folder_path)
		 VALUES (?, 'Default', 1, 1, '/movies')`
	).run(serviceId);
}

function clearRadarr(): void {
	db.prepare(`DELETE FROM presets`).run();
	db.prepare(`DELETE FROM services`).run();
}

async function addRequest(): Promise<{ status: number; body: JsonBody }> {
	const url = new URL('http://localhost/api/add');
	return callHandler(add.POST, {
		request: new Request(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ service: 'movie', id: 123 })
		}),
		locals: { user: null }
	});
}

/** Run one add against a fake Radarr with the given arr answers. */
async function addAgainst(fake: FakeRadarrOptions): Promise<{ status: number; body: JsonBody }> {
	const { server, baseUrl } = await fakeRadarr(fake);
	seedRadarr(baseUrl);
	try {
		return await addRequest();
	} finally {
		clearRadarr();
		await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
	}
}

test('AUD-05: an upstream add rejection is not reported as a library outage', async () => {
	const res = await addAgainst({ addStatus: 400 });

	assert.equal(res.status, 400, 'an arr 400 means the add was rejected, not that the library is down');
	assert.match(String(res.body.error), /rejected|admin/i);
	assert.doesNotMatch(String(res.body.error), /not responding/);
});

test('AUD-05-R: a lookup 404 is a missing title, not an admin preset problem', async () => {
	const res = await addAgainst({ lookupStatus: 404 });

	assert.equal(res.status, 404);
	assert.match(String(res.body.error), /not available/i);
	assert.doesNotMatch(String(res.body.error), /admin|not responding/i);
});

test('AUD-05-R: an arr 429 is transient busy, not an admin preset problem', async () => {
	const res = await addAgainst({ lookupStatus: 429 });

	assert.equal(res.status, 429);
	assert.match(String(res.body.error), /busy|try again/i);
	assert.doesNotMatch(String(res.body.error), /admin|not responding/i);
});

/**
 * A fake arr that answers every endpoint the member poll touches and records
 * each request, so a test can count what one browser request costs upstream.
 */
function countingArr(options: {
	movies?: Record<string, unknown>[];
	series?: Record<string, unknown>[];
	queue?: Record<string, unknown>[];
	queueStatus?: number;
}): Promise<{ server: Server; baseUrl: string; calls: string[] }> {
	const calls: string[] = [];
	const server = createServer((req, res) => {
		calls.push(req.url ?? '');
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		const byId = (rows: Record<string, unknown>[]) => {
			const id = (req.url ?? '').split('/').pop();
			return rows.find((row) => String(row.id) === id);
		};
		if (req.url?.startsWith('/api/v3/queue')) {
			if (options.queueStatus && options.queueStatus !== 200) {
				return send(options.queueStatus, { message: 'queue exploded' });
			}
			const records = options.queue ?? [];
			return send(200, { page: 1, pageSize: 200, totalRecords: records.length, records });
		}
		if (req.method === 'GET' && req.url === '/api/v3/movie') return send(200, options.movies ?? []);
		if (req.method === 'GET' && req.url === '/api/v3/series') return send(200, options.series ?? []);
		if (req.method === 'GET' && /^\/api\/v3\/movie\/\d+$/.test(req.url ?? '')) {
			const movie = byId(options.movies ?? []);
			return movie ? send(200, movie) : send(404, { message: 'NotFound' });
		}
		if (req.method === 'GET' && /^\/api\/v3\/series\/\d+$/.test(req.url ?? '')) {
			const series = byId(options.series ?? []);
			return series ? send(200, series) : send(404, { message: 'NotFound' });
		}
		return send(404, {});
	});
	return new Promise((resolveServer) => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			resolveServer({ server, baseUrl: `http://127.0.0.1:${port}`, calls });
		});
	});
}

function seedService(type: 'radarr' | 'sonarr', baseUrl: string): void {
	db.prepare(
		`INSERT INTO services (type, name, base_url, api_key, app_version) VALUES (?, ?, ?, 'k', '5.0.0')`
	).run(type, type === 'radarr' ? 'Radarr' : 'Sonarr', baseUrl);
}

function clearServices(): void {
	db.prepare(`DELETE FROM presets`).run();
	db.prepare(`DELETE FROM services`).run();
}

function batchEvent(qs: string): Record<string, unknown> {
	const url = new URL(`http://localhost/api/status/batch?${qs}`);
	return { url, request: new Request(url) };
}

async function withCountingArr(
	options: Parameters<typeof countingArr>[0],
	types: ('radarr' | 'sonarr')[],
	body: (arr: { calls: string[] }) => Promise<void>
): Promise<void> {
	// A single fake serves both services (different rows point at the same URL).
	const fake = await countingArr(options);
	for (const type of types) seedService(type, fake.baseUrl);
	try {
		await body(fake);
	} finally {
		clearServices();
		fake.server.closeAllConnections();
		await new Promise<void>((resolveClose) => fake.server.close(() => resolveClose()));
	}
}

test('AS-01: 100 unknown movie ids cost the arr nothing, not 100 lookups', async () => {
	// Before: every id missing from the library map ran its own sequential
	// `GET /movie/{id}`, so one anonymous 1 KB poll became 102 upstream requests
	// (and five concurrent polls 510). Unknown ids only ever appear on the attack
	// path or after an admin deleted the item, so they answer "waiting" locally.
	await withCountingArr({ movies: [] }, ['radarr'], async (arr) => {
		const ids = Array.from({ length: 100 }, (_, i) => 1000 + i);
		const res = await callHandler(batch.GET, batchEvent(`movies=${ids.join(',')}`));

		assert.equal(res.status, 200);
		const perItem = arr.calls.filter((url) => /^\/api\/v3\/movie\/\d+/.test(url));
		assert.deepEqual(perItem, [], 'no per-id upstream lookups are allowed');
		assert.ok(arr.calls.length <= 2, `one poll must cost at most 2 upstream calls, made ${arr.calls.length}`);
		assert.deepEqual(res.body.movies, Object.fromEntries(ids.map((id) => [id, { state: 'waiting' }])));
	});
});

const { handle } = await import('../hooks.server.ts');

/** Run the real SvelteKit hook for one request; `resolved` tells if the route ran. */
async function callHook(
	path: string,
	headers: Record<string, string> = {}
): Promise<{ status: number; body: JsonBody; resolved: boolean }> {
	const url = new URL(`http://localhost${path}`);
	let resolved = false;
	const event = {
		url,
		// A real browser always sends Host; default it to the URL's host so each
		// test only has to override what it is actually testing.
		request: new Request(url, { headers: { host: url.host, ...headers } }),
		cookies: { get: () => undefined, set: () => {}, delete: () => {} },
		locals: {} as Record<string, unknown>,
		getClientAddress: () => '127.0.0.1'
	};
	const response = await (handle as unknown as (input: unknown) => Promise<Response>)({
		event,
		resolve: async () => {
			resolved = true;
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}
	});
	const body = (await response.json().catch(() => ({}))) as JsonBody;
	return { status: response.status, body, resolved };
}

test('AS-02: a cross-site request never reaches the member API', async () => {
	// Before: GET /api/search with Origin: http://evil.example (or an <img> tag,
	// which sends Sec-Fetch-Site: cross-site) ran the full arr lookup and
	// answered 200. Any web page could put the house's arrs to work.
	const hostile: Record<string, string>[] = [
		{ 'sec-fetch-site': 'cross-site' },
		{ origin: 'http://evil.example' },
		{ referer: 'http://evil.example/page.html' }
	];
	for (const headers of hostile) {
		const res = await callHook('/api/search?service=movie&q=dune', headers);
		assert.equal(res.status, 403, `${JSON.stringify(headers)} must be refused`);
		assert.equal(res.resolved, false, 'the route handler must not run');
		assert.match(String(res.body.error), /cross-site/i);
	}
});

test('AS-02: the app and its own pages still reach the member API', async () => {
	const friendly: Record<string, string>[] = [
		{ 'sec-fetch-site': 'same-origin' },
		{ 'sec-fetch-site': 'none' },
		{ origin: 'http://localhost' },
		{}
	];
	for (const headers of friendly) {
		const res = await callHook('/api/search?service=movie&q=dune', headers);
		assert.notEqual(res.status, 403, `${JSON.stringify(headers)} must not be refused`);
		assert.equal(res.resolved, true);
	}
});

test('AD-03: the add dedupe reads the lookup resource, not the whole library', async () => {
	// The lookup resource Radarr returns for a title that is already added
	// carries its library id, so `GET /movie` (the whole library) is redundant.
	const calls: string[] = [];
	const url = new URL('http://localhost/api/add');
	const server = createServer((req, res) => {
		calls.push(req.url ?? '');
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		if (req.url?.startsWith('/api/v3/movie/lookup/tmdb')) {
			return send(200, { id: 77, tmdbId: 123, title: 'Already Here', year: 2020, hasFile: true });
		}
		return send(404, {});
	});
	const baseUrl = await new Promise<string>((resolveServer) => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			resolveServer(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
		});
	});
	seedRadarr(baseUrl);
	try {
		const res = await addRequest();
		assert.equal(res.status, 409);
		assert.equal(res.body.inLibrary, true);
		assert.deepEqual(
			calls.filter((c) => c === '/api/v3/movie'),
			[],
			'the whole library must not be fetched to answer a dedupe check'
		);
	} finally {
		clearRadarr();
		server.closeAllConnections();
		await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
	}
});

function statusEvent(kind: string, id: string): Record<string, unknown> {
	const url = new URL(`http://localhost/api/status/${kind}/${id}`);
	return { params: { kind, id }, url, request: new Request(url) };
}

test('AD-04: one service failing does not discard the other service states', async () => {
	// Before: /api/status/batch was all-or-nothing, so a Radarr queue hiccup
	// answered 502 and the page replaced every per-service poll with one
	// full-queue request per card (32 upstream calls per tick at the audit).
	const radarrFake = await countingArr({
		movies: [{ id: 1, tmdbId: 1, title: 'Dune', monitored: true, isAvailable: true, hasFile: true }]
	});
	const sonarrFake = await countingArr({ series: [{ id: 5, tvdbId: 5, title: 'Show' }], queueStatus: 500 });
	seedService('radarr', radarrFake.baseUrl);
	seedService('sonarr', sonarrFake.baseUrl);
	try {
		const res = await callHandler(batch.GET, batchEvent('movies=1&series=5'));

		assert.equal(res.status, 200, 'a single service outage is not a failed poll');
		assert.deepEqual(res.body.movies, { 1: { state: 'available' } });
		assert.deepEqual(res.body.series, {});
		assert.deepEqual(res.body.errors, ['sonarr']);
	} finally {
		clearServices();
		for (const fake of [radarrFake, sonarrFake]) {
			fake.server.closeAllConnections();
			await new Promise<void>((close) => fake.server.close(() => close()));
		}
	}
});

test('AD-04: a single-item status poll asks the queue only for that item', async () => {
	// Before: /api/status/movie/5 read every queue page (6 requests on a
	// 1,200-row queue) while the page fanned out one such call per card.
	const fake = await countingArr({
		movies: [{ id: 5, tmdbId: 5, title: 'Heat', monitored: true, isAvailable: true, hasFile: false }],
		queue: [{ id: 900, movieId: 5, status: 'downloading', size: 1000, sizeleft: 250 }]
	});
	seedService('radarr', fake.baseUrl);
	try {
		const res = await callHandler(status.GET, statusEvent('movie', '5'));

		assert.equal(res.status, 200);
		assert.equal(res.body.state, 'downloading');
		assert.equal(res.body.progress, 75);
		const queueCalls = fake.calls.filter((url) => url.startsWith('/api/v3/queue'));
		assert.equal(queueCalls.length, 1, 'one queue request, not one per page');
		assert.match(decodeURIComponent(queueCalls[0]!), /movieIds=5/, 'filtered to the polled item');
	} finally {
		clearServices();
		fake.server.closeAllConnections();
		await new Promise<void>((close) => fake.server.close(() => close()));
	}
});

test('AS-03: a DNS-rebinding Host is refused for pages and for the API', async () => {
	// Before: `Host: rebind.attacker.example:4545` answered 200 on /api/search
	// (and served the page), which made the attacker's origin same-origin with
	// Addarr — no preflight, JSON POSTs allowed, Origin matching event.url.
	for (const path of ['/api/search?service=movie&q=dune', '/', '/downloads']) {
		const res = await callHook(path, { host: 'rebind.attacker.example:4545' });
		assert.equal(res.status, 403, `${path} must be refused for a foreign Host`);
		assert.equal(res.resolved, false);
	}
	const api = await callHook('/api/search?service=movie&q=dune', { host: 'rebind.attacker.example:4545' });
	assert.match(String(api.body.error), /Host not allowed/);
	assert.match(String(api.body.error), /ADDARR_ALLOWED_HOSTS/);
});

test('AS-03: loopback, the mDNS name and the machine IP still work', async () => {
	const { hostname, networkInterfaces } = await import('node:os');
	const lanAddress = Object.values(networkInterfaces())
		.flat()
		.find((entry) => entry && !entry.internal && entry.family === 'IPv4')?.address;
	const hosts = ['localhost', '127.0.0.1', `${hostname()}.local`];
	if (lanAddress) hosts.push(lanAddress);
	for (const host of hosts) {
		const res = await callHook('/api/search?service=movie&q=dune', { host: `${host}:4545` });
		assert.notEqual(res.status, 403, `${host} must be allowed`);
		assert.equal(res.resolved, true);
	}
});

/** Time a call, best of `runs`, so a timing assertion is not a one-off fluke. */
async function minDuration<T>(runs: number, call: () => Promise<T>): Promise<{ result: T; ms: number }> {
	let best = Number.POSITIVE_INFINITY;
	let result: T | undefined;
	for (let i = 0; i < runs; i++) {
		const started = performance.now();
		result = await call();
		best = Math.min(best, performance.now() - started);
	}
	return { result: result as T, ms: best };
}

function setupEvent(body: unknown, ip = '127.0.0.1'): Record<string, unknown> {
	const url = new URL('http://localhost/api/auth/setup');
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		cookies: { get: () => undefined, set: () => {}, delete: () => {} },
		getClientAddress: () => ip
	};
}

function loginEvent(body: unknown, ip: string): Record<string, unknown> {
	const url = new URL('http://localhost/api/auth/login');
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		cookies: { get: () => undefined, set: () => {}, delete: () => {} },
		getClientAddress: () => ip
	};
}

test('AS-04: post-setup setup attempts are refused without hashing a PIN', async () => {
	// A hash of the same PIN costs 17–28 ms on the audit host; the refusal must
	// not pay it. Measured against one real hash on this host, not a fixed
	// millisecond budget, so the assertion survives slow machines.
	db.prepare(`INSERT INTO users (id, username, pin_hash, role) VALUES (91, 'existing-admin', 'x', 'admin')`).run();
	try {
		const { result, ms: hashMs } = await minDuration(3, async () => hashPin('1234'));
		assert.ok(result.length > 0);
		const { result: response, ms: setupMs } = await minDuration(3, async () => {
			return (await setup.POST as unknown as (event: unknown) => Promise<Response>)(setupEvent({ username: 'zzz', pin: '4271' }));
		});

		assert.equal(response.status, 403);
		assert.ok(
			setupMs < hashMs / 2,
			`setup must short-circuit before argon2 (setup ${setupMs.toFixed(1)}ms vs one hash ${hashMs.toFixed(1)}ms)`
		);
		assert.equal(
			(db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n,
			1,
			'a second admin must not be created'
		);
	} finally {
		db.prepare(`DELETE FROM users WHERE id = 91`).run();
	}
});

test('AS-04: username churn hits the same throttle as wrong-PIN guessing', async () => {
	// Before: the key was `username@ip`, so distinct valid-format names never
	// tripped the backoff and each request bought a full argon2id verify against
	// DUMMY_HASH. Now the per-IP key shares the budget.
	const ip = '203.0.113.7';
	for (let i = 0; i < 10; i++) {
		const res = await callHandler(login.POST, loginEvent({ username: `nobody${i}`, pin: '1234' }, ip));
		assert.equal(res.status, 401, `attempt ${i + 1} is still answered`);
	}
	const blocked = await callHandler(login.POST, loginEvent({ username: 'nobody999', pin: '1234' }, ip));
	assert.equal(blocked.status, 429);
	assert.match(String(blocked.body.error), /too many failed attempts/i);

	const other = await callHandler(login.POST, loginEvent({ username: 'nobody999', pin: '1234' }, '203.0.113.8'));
	assert.equal(other.status, 401, 'another client is not punished for this one');
});

test('AS-05: a first run cannot be claimed from the network without the token', async () => {
	// Before: POST /api/auth/setup from any LAN client (or a rebinding page) on a
	// fresh install returned 200 + an admin session. The owner then found setup
	// "already completed" and had to delete data/addarr.db.
	db.prepare(`DELETE FROM users`).run();
	forgetSetupToken();
	const token = ensureSetupToken();
	assert.ok(token, 'first run mints a token');
	const post = setup.POST as unknown as (event: unknown) => Promise<Response>;
	try {
		const noToken = await post(setupEvent({ username: 'neighbour', pin: '9999' }, '192.168.1.50'));
		assert.equal(noToken.status, 403);
		assert.match(String((await noToken.json()).error), /setup token/i);
		assert.equal(
			(db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n,
			0,
			'no admin account was created'
		);

		const wrongToken = await post(
			setupEvent({ username: 'neighbour', pin: '9999', token: 'ZZZZ-ZZZZ-ZZZZ' }, '192.168.1.50')
		);
		assert.equal(wrongToken.status, 403, 'a wrong token is not a retry loop');

		const withToken = await post(setupEvent({ username: 'owner', pin: '1234', token }, '192.168.1.50'));
		assert.equal(withToken.status, 200);
		assert.equal((await withToken.json()).role, 'admin');
	} finally {
		db.prepare(`DELETE FROM users`).run();
		forgetSetupToken();
	}
});

test('AS-05: setup from this machine stays frictionless', async () => {
	db.prepare(`DELETE FROM users`).run();
	forgetSetupToken();
	ensureSetupToken();
	const post = setup.POST as unknown as (event: unknown) => Promise<Response>;
	try {
		const res = await post(setupEvent({ username: 'owner', pin: '1234' }, '127.0.0.1'));
		assert.equal(res.status, 200, 'no token is asked for on the server itself');
		assert.equal((await res.json()).role, 'admin');

		// And the same request from the LAN afterwards is refused as completed.
		const again = await post(setupEvent({ username: 'intruder', pin: '1234' }, '192.168.1.50'));
		assert.equal(again.status, 403);
	} finally {
		db.prepare(`DELETE FROM users`).run();
		forgetSetupToken();
	}
});

/** AD-05: `JSON.parse('null')` succeeds, so a null body slipped past every
 * `try { await request.json() } catch` and became a 500 (a thrown TypeError). */
test('AD-05: a JSON null body is a 400 on every route that reads one', async () => {
	const post = (module: { POST: unknown }, event: Record<string, unknown>) =>
		callHandler(module.POST as never, event);
	const bodyOf = (value: string): Record<string, unknown> => {
		const url = new URL('http://localhost/api/x');
		return {
			url,
			request: new Request(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: value
			}),
			locals: { user: { id: 1, username: 'admin', role: 'admin' } },
			cookies: { get: () => undefined, set: () => {}, delete: () => {} },
			getClientAddress: () => '127.0.0.1'
		};
	};

	const cases: { name: string; module: { POST: unknown } }[] = [
		{ name: 'add', module: add },
		{ name: 'services', module: services },
		{ name: 'settings/lan', module: lan },
		{ name: 'auth/login', module: login },
		{ name: 'auth/setup', module: setup }
	];
	for (const { name, module } of cases) {
		for (const literal of ['null', '[]', '5', '"x"']) {
			const res = await post(module, bodyOf(literal));
			assert.equal(res.status, 400, `${name} must reject a ${literal} body with 400, got ${res.status}`);
			assert.match(String(res.body.error), /object|invalid json/i, name);
		}
		const invalid = await post(module, bodyOf('{'));
		assert.equal(invalid.status, 400, `${name} keeps its invalid-JSON 400`);
		assert.match(String(invalid.body.error), /Invalid JSON body/, name);
	}
});
