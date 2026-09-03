import { ArrError, type ArrSystemStatus } from './types.js';

const TIMEOUT_MS = 15_000;

/**
 * Minimal Radarr/Sonarr API v3 client. Holds the API key server-side;
 * never serialize an instance of this class (or any request result of
 * raw() without review) to the browser.
 */
export class ArrClient {
	constructor(
		public readonly baseUrl: string,
		private readonly apiKey: string
	) {}

	async raw<T = unknown>(
		method: 'GET' | 'POST' | 'PUT' | 'DELETE',
		path: string,
		body?: unknown
	): Promise<T> {
		let res: Response;
		try {
			res = await fetch(`${this.baseUrl}/api/v3${path}`, {
				method,
				headers: {
					'X-Api-Key': this.apiKey,
					...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (err) {
			const cause = err instanceof Error ? err.message : String(err);
			throw new ArrError(`Cannot reach ${this.baseUrl} (${cause})`, 502);
		}

		if (!res.ok) {
			let detail: unknown = await res.text().catch(() => undefined);
			try {
				detail = JSON.parse(detail as string);
			} catch {
				/* keep raw text */
			}
			throw new ArrError(
				`${method} ${path} failed: ${res.status} ${res.statusText}`,
				res.status,
				detail
			);
		}

		if (res.status === 204) return undefined as T;
		return (await res.json()) as T;
	}

	async systemStatus(): Promise<ArrSystemStatus> {
		const s = await this.raw<Record<string, unknown>>('GET', '/system/status');
		return {
			appName: String(s.appName ?? 'unknown'),
			version: String(s.version ?? '0.0.0'),
			apiVersion: String(s.apiVersion ?? 'v3')
		};
	}
}
