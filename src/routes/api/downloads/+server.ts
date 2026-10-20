import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { getServiceByType } from '$lib/server/db';
import {
	buildDownloadItems,
	queueNeedsLibrary,
	sortDownloadItems,
	type DownloadItem
} from '$lib/arr/downloads';

type Service = 'radarr' | 'sonarr';

async function readService(service: Service): Promise<DownloadItem[]> {
	const client = getClient(service);
	if (client instanceof RadarrClient) {
		// includeMovie gives us title/artwork in the queue payload, so the
		// common path never fetches the full library on every poll.
		const queue = await client.queue({ includeMovie: true });
		if (queue.length === 0) return [];
		const library = queueNeedsLibrary('movie', queue)
			? await client.allMovies().catch(() => [])
			: [];
		return buildDownloadItems('movie', library, queue);
	}
	if (client instanceof SonarrClient) {
		const queue = await client.queue({ includeSeries: true });
		if (queue.length === 0) return [];
		const library = queueNeedsLibrary('series', queue)
			? await client.allSeries().catch(() => [])
			: [];
		return buildDownloadItems('series', library, queue);
	}
	return [];
}

/**
 * GET /api/downloads — member-safe active queue for the Downloads tab.
 * Reads both connected *arr queues in parallel and returns only normalized
 * title-level fields: never raw queue rows, release names, clients, or errors.
 */
export const GET: RequestHandler = async () => {
	const services = (['radarr', 'sonarr'] as const).filter((service) => getServiceByType(service));
	const results = await Promise.allSettled(services.map((service) => readService(service)));

	const items: DownloadItem[] = [];
	const errors: { service: Service; message: string }[] = [];

	results.forEach((result, index) => {
		const service = services[index]!;
		if (result.status === 'fulfilled') {
			items.push(...result.value);
		} else {
			errors.push({
				service,
				message:
					service === 'radarr'
						? "Couldn't load movie downloads"
						: "Couldn't load series downloads"
			});
		}
	});

	return json(
		{ items: sortDownloadItems(items), errors },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
