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

/** Minimal fake Radarr that rejects every add, like a broken preset would. */
function rejectingRadarr(): Promise<{ server: Server; baseUrl: string }> {
	const server = createServer((req, res) => {
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		if (req.method === 'GET' && req.url === '/api/v3/movie') return send(200, []);
		if (req.method === 'GET' && req.url?.startsWith('/api/v3/movie/lookup/tmdb')) {
			return send(200, { tmdbId: 123, title: 'Rejected Movie', year: 2024 });
		}
		if (req.method === 'POST' && req.url === '/api/v3/movie') {
			return send(400, { message: 'Invalid quality profile' });
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

test('AUD-05: an upstream add rejection is not reported as a library outage', async () => {
	const { server, baseUrl } = await rejectingRadarr();
	try {
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

		const url = new URL('http://localhost/api/add');
		const res = await callHandler(add.POST, {
			request: new Request(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ service: 'movie', id: 123 })
			}),
			locals: { user: null }
		});

		assert.equal(res.status, 400, 'an arr 400 means the add was rejected, not that the library is down');
		assert.match(String(res.body.error), /rejected|admin/i);
		assert.doesNotMatch(String(res.body.error), /not responding/);
	} finally {
		db.prepare(`DELETE FROM presets`).run();
		db.prepare(`DELETE FROM services`).run();
		await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
	}
});
