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
