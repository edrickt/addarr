import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { ArrError } from '$lib/arr/types';
import { getServiceByType } from '$lib/server/db';
import { logActivity } from '$lib/server/auth';

/**
 * Curated admin operations console API (§6.2). Every verb is hand-built and
 * destructive ops require typed confirmation. No free-form command input.
 */

type Service = 'radarr' | 'sonarr';

function getClientFor(url: URL): { client: RadarrClient | SonarrClient; service: Service; serviceId: number } | { error: string; status: number } {
	const service = url.searchParams.get('service') as Service | null;
	if (service !== 'radarr' && service !== 'sonarr') {
		return { error: 'service must be "radarr" or "sonarr"', status: 400 };
	}
	const svc = getServiceByType(service);
	if (!svc) return { error: `${service} is not connected`, status: 503 };
	return { client: getClient(service), service, serviceId: svc.id };
}

function num(url: URL, key: string): number | undefined {
	const v = Number(url.searchParams.get(key));
	return Number.isInteger(v) && v > 0 ? v : undefined;
}

function fail(err: unknown) {
	if (err instanceof ArrError) {
		return json({ error: err.message }, { status: err.status === 502 ? 502 : 400 });
	}
	return json({ error: err instanceof Error ? err.message : 'Console operation failed' }, { status: 500 });
}

/* ------------------------------- LIBRARY ------------------------------- */

export const GET: RequestHandler = async ({ url, params }) => {
	const got = getClientFor(url);
	if ('error' in got) return json({ error: got.error }, { status: got.status });
	const { client, service } = got;
	const path = params.path ?? '';

	try {
		switch (path) {
			case 'summary': {
				const [items, queueItems, blocklistItems] = await Promise.all([
					client instanceof RadarrClient ? client.allMovies() : client.allSeries(),
					client.queue(),
					client.blocklist()
				]);
				return json({
					library: items.length,
					monitored: items.filter((x) => (x as { monitored?: boolean }).monitored === true).length,
					queue: queueItems.length,
					blocked: blocklistItems.length
				});
			}

			case 'library': {
				if (client instanceof RadarrClient) {
					const [movies, profiles, rootFolders, tags] = await Promise.all([
						client.allMovies(),
						client.qualityProfiles(),
						client.rootFolders(),
						client.tags()
					]);
					return json({
						items: movies.map((m) => ({
							id: m.id,
							title: m.title,
							year: m.year ?? null,
							monitored: m.monitored === true,
							qualityProfileId: m.qualityProfileId,
							rootFolderPath: m.rootFolderPath ?? '',
							tags: m.tags ?? [],
							detail: m.hasFile === true ? 'downloaded' : m.isAvailable ? 'released' : 'missing'
						})),
						profiles,
						rootFolders,
						tags
					});
				}
				const [series, profiles, rootFolders, tags] = await Promise.all([
					client.allSeries(),
					client.qualityProfiles(),
					client.rootFolders(),
					client.tags()
				]);
				return json({
					items: series.map((s) => ({
						id: s.id,
						title: s.title,
						year: s.year ?? null,
						monitored: s.monitored === true,
						qualityProfileId: s.qualityProfileId,
						rootFolderPath: s.rootFolderPath ?? '',
						tags: s.tags ?? [],
						seriesType: s.seriesType,
						seasons: s.seasons ?? [],
						detail: statsText(s.statistics)
					})),
					profiles,
					rootFolders,
					tags
				});
			}

			case 'queue':
				return json({ items: await client.queue() });

			case 'history': {
				const page = num(url, 'page') ?? 1;
				return json({ items: await client.history(page, 25) });
			}

			case 'exclusions':
				return json({ items: await client.importExclusions() });

			case 'blocklist': {
				const page = num(url, 'page') ?? 1;
				return json({ items: await client.blocklist(page) });
			}

			case 'calendar': {
				const days = Math.min(Math.max(num(url, 'days') ?? 14, 1), 60);
				const start = new Date();
				const end = new Date(Date.now() + days * 86400_000);
				const fmt = (d: Date) => d.toISOString().slice(0, 10);
				const items = await client.calendar(fmt(start), fmt(end));
				return json({
					items: items.map((item) =>
						service === 'radarr'
							? {
									title: item.title,
									when: item.digitalRelease ?? item.physicalRelease ?? item.inCinemas ?? null,
									what: 'release'
								}
							: {
									title: item.seriesTitle ?? item.title,
									episode: `${item.seasonNumber}x${String(item.episodeNumber).padStart(2, '0')} ${item.title ?? ''}`.trim(),
									when: item.airDateUtc ?? null,
									what: 'airs'
								}
					)
				});
			}

			case 'episodes': {
				if (!(client instanceof SonarrClient)) {
					return json({ error: 'episodes are a Sonarr concept' }, { status: 400 });
				}
				const seriesId = num(url, 'seriesId');
				if (!seriesId) return json({ error: 'seriesId is required' }, { status: 400 });
				return json({ items: await client.episodes(seriesId) });
			}

			default:
				return json({ error: `Unknown console resource "${path}"` }, { status: 404 });
		}
	} catch (err) {
		return fail(err);
	}
};

/* --------------------------- EDIT / DELETE ----------------------------- */

export const PATCH: RequestHandler = async ({ url, params, request, locals }) => {
	const got = getClientFor(url);
	if ('error' in got) return json({ error: got.error }, { status: got.status });
	const path = params.path ?? '';
	if (path !== 'library') return json({ error: 'Only library supports PATCH' }, { status: 404 });

	const id = num(url, 'id');
	if (!id) return json({ error: 'id is required' }, { status: 400 });

	let body: {
		monitored?: boolean;
		qualityProfileId?: number;
		rootFolderPath?: string;
		tags?: number[];
		seasons?: { seasonNumber: number; monitored: boolean }[];
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	// Runtime schema: the UI constrains inputs, the API is the trust boundary (F-CONSOLE-02).
	if (body.monitored !== undefined && typeof body.monitored !== 'boolean')
		return json({ error: 'monitored must be a boolean' }, { status: 400 });
	if (body.qualityProfileId !== undefined && (!Number.isInteger(body.qualityProfileId) || body.qualityProfileId <= 0))
		return json({ error: 'qualityProfileId must be a positive integer' }, { status: 400 });
	if (body.rootFolderPath !== undefined && (typeof body.rootFolderPath !== 'string' || !body.rootFolderPath.trim()))
		return json({ error: 'rootFolderPath must be a non-empty string' }, { status: 400 });
	if (body.tags !== undefined && (!Array.isArray(body.tags) || !body.tags.every((n: unknown) => Number.isInteger(n) && (n as number) > 0)))
		return json({ error: 'tags must be an array of positive tag ids' }, { status: 400 });
	if (body.seasons !== undefined) {
		if (!Array.isArray(body.seasons)) return json({ error: 'seasons must be an array' }, { status: 400 });
		for (const s of body.seasons) {
			if (typeof s !== 'object' || s === null || !Number.isInteger((s as { seasonNumber?: unknown }).seasonNumber) || typeof (s as { monitored?: unknown }).monitored !== 'boolean')
				return json({ error: 'each season needs { seasonNumber: integer, monitored: boolean }' }, { status: 400 });
		}
	}

	try {
		if (got.client instanceof RadarrClient) {
			const movie = await got.client.movie(id);
			if (body.monitored !== undefined) movie.monitored = body.monitored;
			if (body.qualityProfileId !== undefined) movie.qualityProfileId = body.qualityProfileId;
			if (body.rootFolderPath !== undefined) movie.rootFolderPath = body.rootFolderPath;
			if (body.tags !== undefined) movie.tags = body.tags;
			const updated = await got.client.editMovie(movie);
			logActivity({
				userId: locals.user!.id,
				serviceId: got.serviceId,
				action: 'library.edit.movie',
				arrItemId: id,
				title: movie.title,
				payload: body
			});
			return json({ ok: true, item: updated });
		}

		const series = await got.client.series(id);
		if (body.monitored !== undefined) series.monitored = body.monitored;
		if (body.qualityProfileId !== undefined) series.qualityProfileId = body.qualityProfileId;
		if (body.rootFolderPath !== undefined) series.rootFolderPath = body.rootFolderPath;
		if (body.tags !== undefined) series.tags = body.tags;
		if (body.seasons !== undefined) {
			// Season-level monitoring is set explicitly per season.
			const monitoredSeasons = new Set(
				body.seasons.filter((s) => s.monitored).map((s) => s.seasonNumber)
			);
			series.seasons = (series.seasons ?? []).map((s) => ({
				seasonNumber: s.seasonNumber,
				monitored: monitoredSeasons.has(s.seasonNumber)
			}));
		}
		const updated = await got.client.editSeries(series);
		logActivity({
			userId: locals.user!.id,
			serviceId: got.serviceId,
			action: 'library.edit.series',
			arrItemId: id,
			title: series.title,
			payload: body
		});
		return json({ ok: true, item: updated });
	} catch (err) {
		return fail(err);
	}
};

export const DELETE: RequestHandler = async ({ url, params, locals }) => {
	const got = getClientFor(url);
	if ('error' in got) return json({ error: got.error }, { status: got.status });
	const path = params.path ?? '';
	const id = num(url, 'id');
	if (!id) return json({ error: 'id is required' }, { status: 400 });

	try {
		switch (path) {
			case 'library': {
				// Destructive: requires the item title typed exactly.
				const confirm = url.searchParams.get('confirm') ?? '';
				const deleteFiles = url.searchParams.get('deleteFiles') === '1';
				const addExclusion = url.searchParams.get('addExclusion') === '1';

				if (got.client instanceof RadarrClient) {
					const movie = await got.client.movie(id);
					if (!movie || confirm !== movie.title) {
						return json({ error: 'Typed confirmation does not match the title' }, { status: 400 });
					}
					await got.client.deleteMovie(id, { deleteFiles, addExclusion });
					logActivity({
						userId: locals.user!.id,
						serviceId: got.serviceId,
						action: 'library.delete.movie',
						arrItemId: id,
						title: movie.title,
						payload: { deleteFiles, addExclusion }
					});
					return json({ ok: true });
				}

				const series = await got.client.series(id);
				if (!series || confirm !== series.title) {
					return json({ error: 'Typed confirmation does not match the title' }, { status: 400 });
				}
				await got.client.deleteSeries(id, { deleteFiles, addExclusion });
				logActivity({
					userId: locals.user!.id,
					serviceId: got.serviceId,
					action: 'library.delete.series',
					arrItemId: id,
					title: series.title,
					payload: { deleteFiles, addExclusion }
				});
				return json({ ok: true });
			}

			case 'queue': {
				const confirm = url.searchParams.get('confirm') ?? '';
				if (confirm !== 'yes' && confirm !== 'confirm') {
					return json({ error: 'Queue removal requires confirm=yes' }, { status: 400 });
				}
				const removeFromClient = url.searchParams.get('removeFromClient') === '1';
				await got.client.removeQueueItem(id, removeFromClient);
				logActivity({
					userId: locals.user!.id,
					serviceId: got.serviceId,
					action: 'queue.remove',
					arrItemId: id,
					payload: { removeFromClient }
				});
				return json({ ok: true });
			}

			case 'exclusions': {
				if ((url.searchParams.get('confirm') ?? '') !== 'yes') return json({ error: 'Exclusion removal requires confirm=yes' }, { status: 400 });
				await got.client.removeImportExclusion(id);
				logActivity({ userId: locals.user!.id, serviceId: got.serviceId, action: 'exclusion.remove', arrItemId: id });
				return json({ ok: true });
			}

			case 'blocklist': {
				if ((url.searchParams.get('confirm') ?? '') !== 'yes') return json({ error: 'Blocklist removal requires confirm=yes' }, { status: 400 });
				await got.client.removeBlocklistItem(id);
				logActivity({ userId: locals.user!.id, serviceId: got.serviceId, action: 'blocklist.remove', arrItemId: id });
				return json({ ok: true });
			}

			default:
				return json({ error: `Unknown console resource "${path}"` }, { status: 404 });
		}
	} catch (err) {
		return fail(err);
	}
};

/* ------------------------------ COMMANDS ------------------------------- */

const RADARR_COMMANDS = ['MoviesSearch', 'RefreshMonitoredDownloads'] as const;
const SONARR_COMMANDS = ['SeriesSearch', 'EpisodesSearch', 'RefreshMonitoredDownloads'] as const;

export const POST: RequestHandler = async ({ url, params, request, locals }) => {
	const got = getClientFor(url);
	if ('error' in got) return json({ error: got.error }, { status: got.status });
	if ((params.path ?? '') !== 'command') {
		return json({ error: 'Unknown console resource' }, { status: 404 });
	}

	let body: { name?: string; ids?: number[] };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const name = body.name ?? '';
	if (got.service === 'radarr') {
		if (!(RADARR_COMMANDS as readonly string[]).includes(name)) {
			return json({ error: `Command not allowed: ${name}` }, { status: 400 });
		}
	} else if (!(SONARR_COMMANDS as readonly string[]).includes(name)) {
		return json({ error: `Command not allowed: ${name}` }, { status: 400 });
	}

	try {
		await got.client.command(name as never, body.ids);
		logActivity({
			userId: locals.user!.id,
			serviceId: got.serviceId,
			action: `command.${name}`,
			payload: { ids: body.ids ?? [] }
		});
		return json({ ok: true });
	} catch (err) {
		return fail(err);
	}
};

function statsText(stats?: {
	episodeFileCount?: number;
	totalEpisodeCount?: number;
	sizeOnDisk?: number;
}): string {
	if (!stats) return '';
	const { episodeFileCount = 0, totalEpisodeCount = 0 } = stats;
	return `${episodeFileCount}/${totalEpisodeCount} episodes`;
}
