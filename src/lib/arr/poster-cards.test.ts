import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RadarrClient, type RadarrMovie } from './radarr.ts';
import { SonarrClient } from './sonarr.ts';
import type { SonarrSeries } from './add-resource.ts';

type QueueRow = Record<string, unknown>;

function radarr(movies: RadarrMovie[], queue: QueueRow[] = []): RadarrClient {
	const client = new RadarrClient('http://arr.test', 'key');
	client.allMovies = (async () => movies) as typeof client.allMovies;
	client.queue = (async () => queue) as typeof client.queue;
	return client;
}

function sonarr(series: SonarrSeries[], queue: QueueRow[] = []): SonarrClient {
	const client = new SonarrClient('http://arr.test', 'key');
	client.allSeries = (async () => series) as typeof client.allSeries;
	client.queue = (async () => queue) as typeof client.queue;
	return client;
}

const unmonitoredMovie: RadarrMovie = {
	id: 2,
	title: 'Unwanted',
	year: 2020,
	tmdbId: 111,
	monitored: false,
	isAvailable: true,
	hasFile: false
};

const monitoredMovie: RadarrMovie = {
	id: 1,
	title: 'Dune',
	year: 2021,
	tmdbId: 438631,
	monitored: true,
	isAvailable: true,
	hasFile: false
};

const unmonitoredSeries: SonarrSeries = {
	id: 5,
	title: 'Abandoned Show',
	tvdbId: 42,
	monitored: false,
	statistics: { episodeFileCount: 0, episodeCount: 10, totalEpisodeCount: 20 }
};

test('AUD-05: unmonitored movie in the library shows no acquisition state', async () => {
	const cards = await radarr([unmonitoredMovie]).toPosterCards([
		{ title: 'Unwanted', tmdbId: 111, monitored: false, isAvailable: true }
	]);

	assert.equal(cards.length, 1);
	assert.equal(cards[0]?.inLibrary, true);
	assert.equal(cards[0]?.status, undefined, 'an unmonitored title must not read as "missing"');
	assert.equal(cards[0]?.id, 2);
});

test('AUD-05: monitored movie with no file still reports missing', async () => {
	const cards = await radarr([monitoredMovie]).toPosterCards([
		{ title: 'Dune', tmdbId: 438631, monitored: true, isAvailable: true }
	]);

	assert.equal(cards[0]?.status?.state, 'missing');
});

test('AUD-05: an unmonitored title that is actively downloading still shows progress', async () => {
	const cards = await radarr([unmonitoredMovie], [
		{ movieId: 2, status: 'downloading', size: 1000, sizeleft: 400 }
	]).toPosterCards([{ title: 'Unwanted', tmdbId: 111, monitored: false, isAvailable: true }]);

	assert.equal(cards[0]?.status?.state, 'downloading');
	assert.equal(cards[0]?.status?.progress, 60);
});

test('AUD-05: unmonitored series in the library shows no acquisition state', async () => {
	const cards = await sonarr([unmonitoredSeries]).toPosterCards([
		{ title: 'Abandoned Show', tvdbId: 42, monitored: false }
	]);

	assert.equal(cards[0]?.inLibrary, true);
	assert.equal(cards[0]?.status, undefined, 'an unmonitored series must not read as "missing"');
});

test('AUD-05 follow-up: unmonitored title already on disk keeps its truthful available state', async () => {
	const cards = await radarr([
		{ id: 3, title: 'Kept', tmdbId: 222, monitored: false, isAvailable: true, hasFile: true }
	]).toPosterCards([{ title: 'Kept', tmdbId: 222, monitored: false }]);

	assert.equal(cards[0]?.status?.state, 'available', 'available must survive for unmonitored titles');
	assert.equal(cards[0]?.inLibrary, true);
});

test('AUD-05 follow-up: unmonitored caught-up series keeps available; partial is suppressed', async () => {
	const cards = await sonarr([
		{
			id: 8,
			title: 'Finished',
			tvdbId: 45,
			monitored: false,
			statistics: { episodeFileCount: 10, episodeCount: 10, totalEpisodeCount: 10 }
		},
		{
			id: 9,
			title: 'Half',
			tvdbId: 46,
			monitored: false,
			statistics: { episodeFileCount: 4, episodeCount: 10, totalEpisodeCount: 20 }
		}
	]).toPosterCards([
		{ title: 'Finished', tvdbId: 45, monitored: false },
		{ title: 'Half', tvdbId: 46, monitored: false }
	]);

	assert.equal(cards[0]?.status?.state, 'available');
	assert.equal(cards[1]?.status, undefined, 'partial still implies pursuit and must be hidden');
});

test('AUD-05 follow-up: unmonitored unreleased movie shows no acquisition state', async () => {
	const cards = await radarr([
		{ id: 4, title: 'Future', tmdbId: 333, monitored: false, isAvailable: false, hasFile: false }
	]).toPosterCards([{ title: 'Future', tmdbId: 333, monitored: false }]);

	assert.equal(cards[0]?.status, undefined);
});

test('AUD-05: monitored library items keep their normalized state', async () => {
	const cards = await sonarr([
		{
			id: 6,
			title: 'Caught Up',
			tvdbId: 43,
			monitored: true,
			statistics: { episodeFileCount: 10, episodeCount: 10, totalEpisodeCount: 20 }
		},
		{
			id: 7,
			title: 'Behind',
			tvdbId: 44,
			monitored: true,
			statistics: { episodeFileCount: 0, episodeCount: 10, totalEpisodeCount: 20 }
		}
	]).toPosterCards([
		{ title: 'Caught Up', tvdbId: 43, monitored: true },
		{ title: 'Behind', tvdbId: 44, monitored: true }
	]);

	assert.equal(cards[0]?.status?.state, 'available');
	assert.equal(cards[1]?.status?.state, 'missing');
});

/**
 * AD-03: a search used to read the whole library (GET /movie — several MB on a
 * real instance) plus every queue page, for at most 10 lookup hits. Radarr and
 * Sonarr lookup results already carry the library resource for a title that is
 * already added (id + hasFile/isAvailable/monitored/statistics), so the library
 * read is unnecessary and the queue only needs the hit ids.
 */
function spyRadarr(library: RadarrMovie[] = []): { client: RadarrClient; calls: string[] } {
	const client = new RadarrClient('http://arr.test', 'key');
	const calls: string[] = [];
	client.raw = (async (method: string, path: string) => {
		calls.push(`${method} ${path}`);
		if (path === '/movie') return library;
		if (path.startsWith('/queue')) return { page: 1, pageSize: 200, totalRecords: 0, records: [] };
		throw new Error(`unexpected upstream request: ${path}`);
	}) as typeof client.raw;
	return { client, calls };
}

function spySonarr(): { client: SonarrClient; calls: string[] } {
	const client = new SonarrClient('http://arr.test', 'key');
	const calls: string[] = [];
	client.raw = (async (method: string, path: string) => {
		calls.push(`${method} ${path}`);
		if (path === '/series') return [];
		if (path.startsWith('/queue')) return { page: 1, pageSize: 200, totalRecords: 0, records: [] };
		throw new Error(`unexpected upstream request: ${path}`);
	}) as typeof client.raw;
	return { client, calls };
}

test('AD-03: a lookup hit that is already in the library needs no library read', async () => {
	const { client, calls } = spyRadarr();
	const cards = await client.toPosterCards([
		{ id: 7, title: 'Dune', tmdbId: 438631, monitored: true, isAvailable: true, hasFile: false }
	]);

	assert.equal(cards.length, 1);
	assert.equal(cards[0]?.inLibrary, true);
	assert.equal(cards[0]?.id, 7);
	assert.equal(cards[0]?.status?.state, 'missing');
	assert.deepEqual(
		calls.filter((c) => c === 'GET /movie'),
		[],
		'the whole library must not be fetched'
	);
});

test('AD-03: only the hit ids are asked for in the queue', async () => {
	const { client, calls } = spyRadarr();
	await client.toPosterCards([
		{ id: 7, title: 'Dune', tmdbId: 438631, monitored: true, isAvailable: true, hasFile: false },
		{ id: 9, title: 'Heat', tmdbId: 2, monitored: true, isAvailable: true, hasFile: false },
		{ id: 0, title: 'Not added', tmdbId: 3 }
	]);

	const queueCalls = calls.filter((c) => c.startsWith('GET /queue'));
	assert.equal(queueCalls.length, 1, 'one queue request per search, not one per page');
	assert.match(decodeURIComponent(queueCalls[0]!), /movieIds=7,9/, 'the queue is filtered to the ids on screen');
});

test('AD-03: a series lookup hit uses its library resource too', async () => {
	const { client, calls } = spySonarr();
	const cards = await client.toPosterCards([
		{
			id: 4,
			title: 'Severance',
			tvdbId: 371980,
			monitored: true,
			statistics: { episodeFileCount: 0, episodeCount: 10, totalEpisodeCount: 20 }
		}
	]);

	assert.equal(cards[0]?.inLibrary, true);
	assert.equal(cards[0]?.status?.state, 'missing');
	assert.deepEqual(
		calls.filter((c) => c === 'GET /series'),
		[]
	);
	assert.match(calls.find((c) => c.startsWith('GET /queue')) ?? '', /seriesIds=4/);
});

test('AD-03: an arr that does not report library ids falls back to the library list', async () => {
	// Older/odd lookup payloads have no `id` at all. Rather than guess, fall
	// back to the previous behaviour: read the library once and match by id.
	const { client, calls } = spyRadarr([monitoredMovie]);
	const cards = await client.toPosterCards([{ title: 'Dune', tmdbId: 438631, monitored: true }]);

	assert.equal(cards[0]?.inLibrary, true);
	assert.equal(cards[0]?.id, 1);
	assert.ok(calls.includes('GET /movie'), 'the fallback path still reads the library');
});
