import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildDownloadItems,
	queueNeedsLibrary,
	sortDownloadItems,
	type DownloadItem
} from './downloads.ts';
import { aggregateQueue } from './status.ts';

const poster = [{ coverType: 'poster', remoteUrl: 'https://img.example/poster.jpg' }];

test('groups queue rows into one title and sums transfer details', () => {
	const items = buildDownloadItems(
		'series',
		[
			{
				id: 7,
				title: 'Severance',
				year: 2022,
				images: poster,
				statistics: { episodeFileCount: 5, totalEpisodeCount: 10 }
			}
		],
		[
			{
				seriesId: 7,
				title: 'S02E01',
				status: 'downloading',
				size: 1000,
				sizeleft: 400,
				timeleft: '00:10:00'
			},
			{
				seriesId: 7,
				title: 'S02E02',
				status: 'queued',
				size: 500,
				sizeleft: 500,
				timeleft: '00:20:00'
			}
		]
	);

	assert.equal(items.length, 1);
	assert.deepEqual(items[0], {
		kind: 'series',
		id: 7,
		title: 'Severance',
		year: 2022,
		posterUrl: 'https://img.example/poster.jpg',
		state: 'downloading',
		progress: 40,
		timeLeftSeconds: 1200,
		size: 1500,
		sizeLeft: 900,
		episodes: { have: 5, total: 10 }
	});
});

test('aggregateQueue reports lowercase sizeleft bytes for the status sheet', () => {
	const status = aggregateQueue([
		{ status: 'downloading', size: 1000, sizeleft: 400, timeleft: '00:10:00' }
	]);

	assert.equal(status.progress, 60);
	assert.equal(status.size, 1000);
	assert.equal(status.sizeLeft, 400);
});

test('surfaces download-client warnings as attention', () => {
	const items = buildDownloadItems(
		'movie',
		[
			{
				id: 1,
				title: 'Dune',
				year: 2021,
				images: [{ coverType: 'poster', url: '/poster.jpg' }]
			}
		],
		[
			{
				movieId: 1,
				status: 'downloading',
				size: 100,
				sizeleft: 50,
				trackedDownloadStatus: 'warning'
			}
		]
	);

	assert.equal(items.length, 1);
	assert.equal(items[0]?.state, 'attention');
	assert.equal(items[0]?.posterUrl, '/poster.jpg');
	assert.equal(items[0]?.episodes, null);
});

test('falls back to the queue row media when the library item is missing', () => {
	const items = buildDownloadItems(
		'movie',
		[],
		[
			{
				movieId: 9,
				status: 'queued',
				size: 10,
				sizeleft: 10,
				movie: { id: 9, title: 'External Grab', year: 2020, images: poster }
			}
		]
	);

	assert.equal(items.length, 1);
	assert.equal(items[0]?.title, 'External Grab');
	assert.equal(items[0]?.year, 2020);
	assert.equal(items[0]?.posterUrl, 'https://img.example/poster.jpg');
});

test('never uses the raw release title when media metadata is missing', () => {
	const items = buildDownloadItems(
		'movie',
		[],
		[
			{
				movieId: 9,
				status: 'downloading',
				size: 10,
				sizeleft: 5,
				title: 'Dune.2021.1080p.WEB-DL'
			}
		]
	);

	assert.equal(items[0]?.title, 'Unknown title');
	assert.equal(JSON.stringify(items).includes('WEB-DL'), false);
});

test('accepts camelCase sizeLeft as a fallback for older payloads', () => {
	const items = buildDownloadItems(
		'movie',
		[{ id: 1, title: 'Dune' }],
		[{ movieId: 1, status: 'downloading', size: 1000, sizeLeft: 400 }]
	);

	assert.equal(items[0]?.progress, 60);
	assert.equal(items[0]?.sizeLeft, 400);
});

test('queueNeedsLibrary only when nested media is missing', () => {
	assert.equal(
		queueNeedsLibrary('movie', [{ movieId: 1, movie: { id: 1, title: 'Dune' } }]),
		false
	);
	assert.equal(queueNeedsLibrary('movie', [{ movieId: 1, title: 'Dune.2021.1080p' }]), true);
});

test('ignores queue rows without a movie or series id', () => {
	const items = buildDownloadItems(
		'movie',
		[],
		[
			{ title: 'Orphan row', status: 'downloading', size: 10, sizeleft: 5 },
			{ movieId: 0, title: 'Bad id', status: 'downloading', size: 10, sizeleft: 5 }
		]
	);

	assert.deepEqual(items, []);
});

test('sorts active downloads first, then queued, paused, and attention', () => {
	const item = (title: string, state: DownloadItem['state']): DownloadItem => ({
		kind: 'movie',
		id: title.length,
		title,
		year: null,
		posterUrl: null,
		state,
		progress: null,
		timeLeftSeconds: null,
		size: null,
		sizeLeft: null,
		episodes: null
	});

	const sorted = sortDownloadItems([
		item('Paused', 'paused'),
		item('Queued', 'queued'),
		item('Zulu', 'downloading'),
		item('Attention', 'attention'),
		item('Alpha', 'downloading')
	]);

	assert.deepEqual(
		sorted.map((i) => i.title),
		['Alpha', 'Zulu', 'Queued', 'Paused', 'Attention']
	);
});
