/**
 * Shared request-body reading for the JSON API routes.
 *
 * `JSON.parse('null')` succeeds, so `try { body = await request.json() } catch`
 * does not catch it: five routes then read a property of `null` outside their
 * own error handling and SvelteKit turned it into a 500 with a stack trace.
 * `null` is a client error, not a server one, and the five copies of that
 * mistake were never going to stay at five (AD-05).
 */

export type JsonBodyResult<T extends object> =
	| { ok: true; body: Partial<T> }
	| { ok: false; status: 400; error: string };

export async function readJsonObject<T extends object = Record<string, unknown>>(
	request: Request
): Promise<JsonBodyResult<T>> {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return { ok: false, status: 400, error: 'Invalid JSON body' };
	}
	// Arrays and scalars pass `typeof === 'object'` or are not objects at all;
	// every route in this app takes a JSON object.
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { ok: false, status: 400, error: 'JSON object body required' };
	}
	return { ok: true, body: parsed as Partial<T> };
}
