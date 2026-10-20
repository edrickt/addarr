import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMovieFile, normalizeSeriesFiles } from './files.ts';

test('normalizes a movie file without leaking paths or release names', () => {
	const files = normalizeMovieFile({
		id: 1,
		hasFile: true,
		movieFile: {
			id: 10,
			size: 8_000_000_000,
			quality: { quality: { name: 'Bluray-1080p' } },
			mediaInfo: { resolution: '1080p' },
			path: '/secret/movies/Dune.2021.1080p.mkv',
			relativePath: 'Dune.2021.1080p.mkv',
			sceneName: 'Dune.2021.1080p.BluRay-GROUP'
		}
	});

	assert.equal(files.kind, 'movie');
	assert.equal(files.fileCount, 1);
	assert.equal(files.totalSize, 8_000_000_000);
	assert.deepEqual(files.movie, {
		quality: 'Bluray-1080p',
		resolution: '1080p',
		size: 8_000_000_000
	});
	assert.equal(JSON.stringify(files).includes('/secret'), false);
	assert.equal(JSON.stringify(files).includes('sceneName'), false);
	assert.equal(JSON.stringify(files).includes('GROUP'), false);
});

test('returns an empty movie result when no file is on disk', () => {
	const files = normalizeMovieFile({ id: 1, hasFile: false, movieFile: null });

	assert.equal(files.kind, 'movie');
	assert.equal(files.movie, null);
	assert.equal(files.fileCount, 0);
	assert.equal(files.totalSize, null);
});

test('groups downloaded episodes by season and dedupes shared file sizes', () => {
	const files = normalizeSeriesFiles([
		{
			seasonNumber: 2,
			episodeNumber: 2,
			title: 'The End',
			hasFile: true,
			episodeFileId: 10,
			episodeFile: {
				id: 10,
				size: 200,
				quality: { quality: { name: 'WEB-1080p' } },
				mediaInfo: { resolution: '1080p' },
				path: '/secret/tv/Severance.S02E01-E02.mkv'
			}
		},
		{
			seasonNumber: 2,
			episodeNumber: 1,
			title: 'The Start',
			hasFile: true,
			episodeFileId: 10,
			episodeFile: {
				id: 10,
				size: 200,
				quality: { quality: { name: 'WEB-1080p' } },
				mediaInfo: { resolution: '1080p' }
			}
		},
		{
			seasonNumber: 1,
			episodeNumber: 1,
			title: 'Pilot',
			hasFile: true,
			episodeFileId: 11,
			episodeFile: {
				id: 11,
				size: 300,
				quality: { quality: { name: 'Bluray-1080p' } }
			}
		},
		{
			seasonNumber: 0,
			episodeNumber: 1,
			title: 'Special',
			hasFile: true,
			episodeFileId: 12,
			episodeFile: { id: 12, size: 100, quality: { name: 'HDTV-720p' } }
		},
		{
			seasonNumber: 1,
			episodeNumber: 2,
			title: 'Not downloaded',
			hasFile: false,
			episodeFileId: 0,
			episodeFile: null
		}
	]);

	assert.equal(files.kind, 'series');
	assert.equal(files.episodeCount, 4);
	assert.equal(files.fileCount, 3);
	assert.equal(files.totalSize, 600);
	assert.deepEqual(
		files.seasons.map((season) => season.seasonNumber),
		[0, 1, 2]
	);
	assert.deepEqual(
		files.seasons[2]?.episodes.map((episode) => episode.episodeNumber),
		[1, 2]
	);
	assert.equal(files.seasons[2]?.totalSize, 200);
	assert.equal(files.seasons[2]?.fileCount, 1);
	assert.equal(files.seasons[1]?.episodes[0]?.quality, 'Bluray-1080p');
	assert.equal(JSON.stringify(files).includes('/secret'), false);
	assert.equal(JSON.stringify(files).includes('severance'), false);
});

test('reports an unknown season total when any file size is missing', () => {
	const files = normalizeSeriesFiles([
		{
			seasonNumber: 1,
			episodeNumber: 1,
			title: 'Known size',
			hasFile: true,
			episodeFileId: 1,
			episodeFile: { id: 1, size: 100 }
		},
		{
			seasonNumber: 1,
			episodeNumber: 2,
			title: 'Unknown size',
			hasFile: true,
			episodeFileId: 2,
			episodeFile: { id: 2 }
		}
	]);

	assert.equal(files.seasons[0]?.fileCount, 2);
	assert.equal(files.seasons[0]?.totalSize, null);
	assert.equal(files.totalSize, null);
});

test('does not collapse separate episodes when file ids are missing', () => {
	const files = normalizeSeriesFiles([
		{
			seasonNumber: 1,
			episodeNumber: 1,
			title: 'First',
			hasFile: true,
			episodeFileId: 0,
			episodeFile: null
		},
		{
			seasonNumber: 1,
			episodeNumber: 2,
			title: 'Second',
			hasFile: true,
			episodeFileId: 0,
			episodeFile: null
		}
	]);

	assert.equal(files.episodeCount, 2);
	assert.equal(files.fileCount, 2);
	assert.equal(files.totalSize, null);
});

test('keeps a downloaded episode with missing file metadata and ignores missing episode numbers', () => {
	const files = normalizeSeriesFiles([
		{
			seasonNumber: 1,
			episodeNumber: 1,
			title: 'Unknown quality',
			hasFile: true,
			episodeFileId: 0,
			episodeFile: null
		},
		{ seasonNumber: 1, title: 'No episode number', hasFile: true }
	]);

	assert.equal(files.episodeCount, 1);
	assert.equal(files.fileCount, 1);
	assert.equal(files.totalSize, null);
	assert.deepEqual(files.seasons[0]?.episodes[0], {
		seasonNumber: 1,
		episodeNumber: 1,
		title: 'Unknown quality',
		quality: null,
		resolution: null,
		size: null
	});
});
