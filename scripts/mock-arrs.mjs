// Dev-only mock Radarr (/api/v3 :8787) and Sonarr (/api/v3 :8788) for manual
// testing. Not shipped. Control endpoints under /__mock/* (no auth, local
// dev only) seed movies/series/queue:
//   POST /__mock/radarr/movie     body: full movie record (id honored)
//   POST /__mock/radarr/queue     body: array of queue records
//   POST /__mock/sonarr/series    body: full series record (id honored)
//   POST /__mock/sonarr/episodes  body: array of episode records
//   POST /__mock/sonarr/queue     body: array of queue records
import http from 'node:http';
const j = (r, c, b) => { r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(b)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : null)); });

const profiles = [{ id: 1, name: 'HD' }];
const folders = [{ id: 1, path: '/data/movies' }];

// ---------------------------------------------------------------- Radarr
const movies = [];
let radarrQueue = [];
http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname.replace(/\/$/, '');

	if (p.startsWith('/__mock/')) {
		if (req.method !== 'POST') return j(res, 405, { error: 'mock control is POST-only' });
		let body = null;
		try { body = await readBody(req); } catch { return j(res, 400, { error: 'invalid JSON' }); }
		if (body != null && typeof body !== 'object') return j(res, 400, { error: 'object body required' });
		if (p === '/__mock/radarr/movie') {
			const i = movies.findIndex((m) => m.id === body.id);
			if (i >= 0) movies[i] = body;
			else movies.push(body);
			return j(res, 200, body);
		}
		if (p === '/__mock/radarr/queue') { radarrQueue = body; return j(res, 200, { ok: true }); }
		return j(res, 404, {});
	}

	if (req.headers['x-api-key'] !== 'SECRET') return j(res, 401, {});
	if (p === '/api/v3/system/status') return j(res, 200, { appName: 'Radarr', version: '5.0.0' });
	if (p === '/api/v3/qualityprofile') return j(res, 200, profiles);
	if (p === '/api/v3/rootfolder') return j(res, 200, folders);
	if (p === '/api/v3/tag') return j(res, 200, []);
	if (p === '/api/v3/movie' && req.method === 'GET') return j(res, 200, movies);
	if (/^\/api\/v3\/movie\/\d+$/.test(p)) {
		const m = movies.find((m) => m.id === Number(p.split('/').pop()));
		return m ? j(res, 200, m) : j(res, 404, {});
	}
	if (p === '/api/v3/movie/lookup/tmdb') return j(res, 200, { tmdbId: Number(url.searchParams.get('tmdbId')), title: 'Mock Movie', year: 2024, images: [] });
	if (p === '/api/v3/movie/lookup') {
		return j(res, 200, [...movies, { tmdbId: 999, title: 'Not Added', year: 2024, images: [] }]);
	}
	if (p === '/api/v3/queue') return j(res, 200, { records: radarrQueue });
	if (p === '/api/v3/movie' && req.method === 'POST') {
		const m = await readBody(req);
		m.id = 500 + movies.length;
		movies.push(m);
		return j(res, 201, m);
	}
	j(res, 404, {});
}, '127.0.0.1').listen(8787, () => console.log('mock radarr on :8787'));

// ---------------------------------------------------------------- Sonarr
const series = [];
let sonarrEpisodes = [];
let sonarrQueue = [];
http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname.replace(/\/$/, '');

	if (p.startsWith('/__mock/')) {
		if (req.method !== 'POST') return j(res, 405, { error: 'mock control is POST-only' });
		let body = null;
		try { body = await readBody(req); } catch { return j(res, 400, { error: 'invalid JSON' }); }
		if (body != null && typeof body !== 'object') return j(res, 400, { error: 'object body required' });
		if (p === '/__mock/sonarr/series') {
			const i = series.findIndex((s) => s.id === body.id);
			if (i >= 0) series[i] = body;
			else series.push(body);
			return j(res, 200, body);
		}
		if (p === '/__mock/sonarr/episodes') { sonarrEpisodes = body; return j(res, 200, { ok: true }); }
		if (p === '/__mock/sonarr/queue') { sonarrQueue = body; return j(res, 200, { ok: true }); }
		return j(res, 404, {});
	}

	if (req.headers['x-api-key'] !== 'SECRET') return j(res, 401, {});
	if (p === '/api/v3/system/status') return j(res, 200, { appName: 'Sonarr', version: '4.0.0' });
	if (p === '/api/v3/qualityprofile') return j(res, 200, profiles);
	if (p === '/api/v3/rootfolder') return j(res, 200, folders);
	if (p === '/api/v3/tag') return j(res, 200, []);
	if (p === '/api/v3/series' && req.method === 'GET') return j(res, 200, series);
	if (/^\/api\/v3\/series\/\d+$/.test(p)) {
		const s = series.find((s) => s.id === Number(p.split('/').pop()));
		return s ? j(res, 200, s) : j(res, 404, {});
	}
	if (p === '/api/v3/series/lookup') {
		return j(res, 200, [...series, { tvdbId: 999, title: 'Not Added Show', year: 2024, images: [], seasons: [] }]);
	}
	if (p === '/api/v3/episode') {
		const seriesId = Number(url.searchParams.get('seriesId'));
		return j(res, 200, seriesId ? sonarrEpisodes.filter((ep) => ep.seriesId === seriesId) : sonarrEpisodes);
	}
	if (p === '/api/v3/queue') return j(res, 200, { records: sonarrQueue });
	j(res, 404, {});
}, '127.0.0.1').listen(8788, () => console.log('mock sonarr on :8788'));
