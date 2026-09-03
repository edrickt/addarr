// Dev-only mock Radarr (/api/v3 :8787) and Sonarr (/api/v3 :8788) for manual
// testing. Not shipped. Control endpoints under /__mock/* (no auth, local
// dev only) seed movies/series/queue:
//   POST /__mock/radarr/movie     body: full movie record (id honored)
//   POST /__mock/radarr/queue     body: array of queue records
//   POST /__mock/sonarr/series    body: full series record (id honored)
//   POST /__mock/sonarr/queue     body: array of queue records
import http from 'node:http';
const j = (r, c, b) => { r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(b)); };

const state = {
	movies: [],
	series: [],
	radarrQueue: [],
	sonarrQueue: []
};

const profiles = [{ id: 1, name: 'HD' }], folders = [{ id: 1, path: '/data/movies' }];
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : null)); });

http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x'); const p = url.pathname.replace(/\/$/, '');

	if (p.startsWith('/__mock/')) {
		const body = await readBody(req);
		if (p === '/__mock/radarr/movie') {
			state.movies = state.movies.filter((m) => m.id !== body.id);
			state.movies.push(body);
			return j(res, 200, body);
		}
		if (p === '/__mock/radarr/queue') { state.radarrQueue = body; return j(res, 200, { ok: true }); }
		if (p === '/__mock/sonarr/series') {
			state.series = state.series.filter((s) => s.id !== body.id);
			state.series.push(body);
			return j(res, 200, body);
		}
		if (p === '/__mock/sonarr/queue') { state.sonarrQueue = body; return j(res, 200, { ok: true }); }
		return j(res, 404, {});
	}

	if (req.headers['x-api-key'] !== 'SECRET') return j(res, 401, {});

	// Radarr (/api/v3)
	if (p === '/api/v3/system/status') return j(res, 200, { appName: 'Radarr', version: '5.0.0' });
	if (p === '/api/v3/qualityprofile') return j(res, 200, profiles);
	if (p === '/api/v3/rootfolder') return j(res, 200, folders);
	if (p === '/api/v3/tag') return j(res, 200, []);
	if (p === '/api/v3/movie' && req.method === 'GET') return j(res, 200, state.movies);
	if (/^\/api\/v3\/movie\/\d+$/.test(p)) {
		const m = state.movies.find((m) => m.id === Number(p.split('/').pop()));
		return m ? j(res, 200, m) : j(res, 404, {});
	}
	if (p === '/api/v3/movie/lookup/tmdb') return j(res, 200, { tmdbId: Number(url.searchParams.get('tmdbId')), title: 'Mock Movie', year: 2024, images: [] });
	if (p === '/api/v3/queue') return j(res, 200, { records: state.radarrQueue });
	if (p === '/api/v3/movie' && req.method === 'POST') {
		const m = await readBody(req);
		m.id = 500 + state.movies.length;
		state.movies.push(m);
		return j(res, 201, m);
	}

	// Sonarr (/api/v3) — same paths, disambiguated by the port each server listens on
	if (p === '/api/v3/system/status') return j(res, 200, { appName: 'Sonarr', version: '4.0.0' });
	if (p === '/api/v3/series' && req.method === 'GET') return j(res, 200, state.series);
	if (/^\/api\/v3\/series\/\d+$/.test(p)) {
		const s = state.series.find((s) => s.id === Number(p.split('/').pop()));
		return s ? j(res, 200, s) : j(res, 404, {});
	}
	if (p === '/api/v3/series/lookup') return j(res, 200, [{ tvdbId: Number(url.searchParams.get('term')), title: 'Mock Series', year: 2024, images: [], seasons: [] }]);
	if (p === '/api/v3/queue') return j(res, 200, { records: state.sonarrQueue });

	j(res, 404, {});
}).on('request', () => {}).listen(8787, () => {
	// Second server shares the handler but the /api/v3/* Radarr paths above
	// would collide with Sonarr's; keep them distinct below.
});

// Sonarr server: separate handler so /api/v3 paths don't collide with Radarr's.
http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x'); const p = url.pathname.replace(/\/$/, '');
	if (p.startsWith('/__mock/')) {
		const body = await readBody(req);
		if (p === '/__mock/sonarr/series') {
			state.series = state.series.filter((s) => s.id !== body.id);
			state.series.push(body);
			return j(res, 200, body);
		}
		if (p === '/__mock/sonarr/queue') { state.sonarrQueue = body; return j(res, 200, { ok: true }); }
		return j(res, 404, {});
	}
	if (req.headers['x-api-key'] !== 'SECRET') return j(res, 401, {});
	if (p === '/api/v3/system/status') return j(res, 200, { appName: 'Sonarr', version: '4.0.0' });
	if (p === '/api/v3/qualityprofile') return j(res, 200, profiles);
	if (p === '/api/v3/rootfolder') return j(res, 200, folders);
	if (p === '/api/v3/tag') return j(res, 200, []);
	if (p === '/api/v3/series' && req.method === 'GET') return j(res, 200, state.series);
	if (/^\/api\/v3\/series\/\d+$/.test(p)) {
		const s = state.series.find((s) => s.id === Number(p.split('/').pop()));
		return s ? j(res, 200, s) : j(res, 404, {});
	}
	if (p === '/api/v3/series/lookup') return j(res, 200, [{ tvdbId: Number(url.searchParams.get('term')), title: 'Mock Series', year: 2024, images: [], seasons: [] }]);
	if (p === '/api/v3/queue') return j(res, 200, { records: state.sonarrQueue });
	j(res, 404, {});
}).listen(8788, () => console.log('mock radarr :8787 · sonarr :8788 ready'));
