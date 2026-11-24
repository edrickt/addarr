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
	queueStatus?: number;
}): Promise<{ server: Server; baseUrl: string; calls: string[] }> {
	const calls: string[] = [];
	const server = createServer((req, res) => {
		calls.push(req.url ?? '');
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		if (req.url?.startsWith('/api/v3/queue')) {
			if (options.queueStatus && options.queueStatus !== 200) {
				return send(options.queueStatus, { message: 'queue exploded' });
			}
			return send(200, { page: 1, pageSize: 200, totalRecords: 0, records: [] });
		}
		if (req.method === 'GET' && req.url === '/api/v3/movie') return send(200, options.movies ?? []);
		if (req.method === 'GET' && req.url === '/api/v3/series') return send(200, options.series ?? []);
		if (req.method === 'GET' && /^\/api\/v3\/movie\/\d+$/.test(req.url ?? '')) {
			return send(404, { message: 'NotFound' });
		}
		if (req.method === 'GET' && /^\/api\/v3\/series\/\d+$/.test(req.url ?? '')) {
			return send(404, { message: 'NotFound' });
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
		request: new Request(url, { headers }),
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
		await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
	}
});
