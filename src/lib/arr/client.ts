import { ArrError, type ArrSystemStatus } from './types.ts';

const TIMEOUT_MS = 15_000;

/**
 * Minimal Radarr/Sonarr API v3 client. Holds the API key server-side;
 * never serialize an instance of this class (or any request result of
 * raw() without review) to the browser.
 */
export class ArrClient {
	#apiKey: string;
	readonly baseUrl: string;

	constructor(baseUrl: string, apiKey: string) {
		this.baseUrl = baseUrl;
		this.#apiKey = apiKey;
	}

	toJSON() {
		return { baseUrl: this.baseUrl, apiKey: '[redacted]' };
	}

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
					'X-Api-Key': this.#apiKey,
					Accept: 'application/json',
					...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(TIMEOUT_MS),
				redirect: 'error'
			});
		} catch (err) {
			const cause = err instanceof Error ? err.message : String(err);
			throw new ArrError(`Arr request failed (${cause})`, 502);
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

		if (res.status === 204 || res.status === 205) return undefined as T;
		const text = await res.text();
		if (!text) return undefined as T;
		try {
			return JSON.parse(text) as T;
		} catch {
			const snippet = text.slice(0, 200);
			throw new ArrError(
				`${method} ${path} returned non-JSON (${res.status}, ${res.headers.get('content-type') ?? 'unknown type'}): ${snippet}`,
				502,
				snippet
			);
		}
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
