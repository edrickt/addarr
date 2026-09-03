// Dev-only mock Radarr (/api/v3) for manual testing. Not shipped.
import http from 'node:http';
const movies = [];
const profiles = [{ id: 1, name: 'HD' }], folders = [{ id: 1, path: '/data/movies' }];
const j = (r, c, b) => { r.writeHead(c, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(b)); };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname.replace(/\/$/, '');
  if (req.headers['x-api-key'] !== 'SECRET') return j(res, 401, {});
  if (p === '/api/v3/system/status') return j(res, 200, { appName: 'Radarr', version: '5.0.0' });
  if (p === '/api/v3/qualityprofile') return j(res, 200, profiles);
  if (p === '/api/v3/rootfolder') return j(res, 200, folders);
  if (p === '/api/v3/tag') return j(res, 200, []);
  if (p === '/api/v3/movie' && req.method === 'GET') return j(res, 200, movies);
  if (p === '/api/v3/movie/lookup/tmdb') return j(res, 200, { tmdbId: Number(url.searchParams.get('tmdbId')), title: 'Mock Movie', year: 2024, images: [] });
  if (p === '/api/v3/queue') return j(res, 200, { records: [] });
  if (p === '/api/v3/movie' && req.method === 'POST') { let b=''; req.on('data', c=>b+=c); req.on('end', ()=>{ const m=JSON.parse(b); m.id=500+movies.length; movies.push(m); j(res,201,m); }); return; }
  j(res, 404, {});
}).listen(8787, () => console.log('mock on :8787'));
