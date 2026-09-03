import { getServiceByType } from '$lib/server/db';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import type { ArrServiceType } from '$lib/arr/types';

export type AnyArrClient = RadarrClient | SonarrClient;

export function getClient(type: ArrServiceType): AnyArrClient {
	const svc = getServiceByType(type);
	if (!svc) {
		throw new Error(`No ${type} service configured. Add it in Settings first.`);
	}
	return type === 'radarr'
		? new RadarrClient(svc.base_url, svc.api_key)
		: new SonarrClient(svc.base_url, svc.api_key);
}
