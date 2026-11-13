import type { PosterCard } from './types.ts';

/**
 * Merge the member search responses into one poster grid.
 *
 * The member page queries one *arr per media kind. A household may connect only
 * one of Radarr/Sonarr, so "this service is not connected" is a normal state,
 * not a search failure: `/api/search` answers with `unconfigured: true` and the
 * merge skips that kind instead of turning it into an error banner. Pure so the
 * merge (and its error/partial-error precedence) is unit-testable without a
 * browser.
 */

export type SearchKind = 'movie' | 'series';

export type SearchPayload = {
	results?: PosterCard[];
	error?: string;
	/** The requested service is not configured at all (a normal first-run state). */
	unconfigured?: boolean;
};

export type MergedSearchResult = {
	cards: (PosterCard & { kind: SearchKind })[];
	error: string | null;
	partialError: string | null;
};

export const LIBRARY_NOT_CONNECTED =
	'The library is not connected yet — ask an admin to finish Settings.';

export function mergeSearchResponses(
	kinds: SearchKind[],
	settled: PromiseSettledResult<SearchPayload>[]
): MergedSearchResult {
	const cards: (PosterCard & { kind: SearchKind })[] = [];
	const failedKinds: SearchKind[] = [];
	let unconfigured = 0;
	let firstError: string | null = null;

	settled.forEach((s, i) => {
		const kind = kinds[i];
		if (!kind) return;
		const value = s.status === 'fulfilled' ? s.value : null;
		// A library that was never connected is not "unreachable" — skip it. Check
		// the flag before `results` because the route sends `{ results: [] }` too.
		if (value?.unconfigured) {
			unconfigured++;
			return;
		}
		if (value && Array.isArray(value.results)) {
			cards.push(...value.results.map((card) => ({ ...card, kind })));
			return;
		}
		failedKinds.push(kind);
		if (!firstError) {
			firstError = value?.error ?? 'Search failed — try again';
		}
	});

	if (cards.length === 0) {
		if (failedKinds.length > 0) return { cards, error: firstError, partialError: null };
		// Only when NO requested kind is connected. A connected library that
		// simply has no match returns "Nothing found", not a setup error.
		if (unconfigured === kinds.length) {
			return { cards, error: LIBRARY_NOT_CONNECTED, partialError: null };
		}
		return { cards, error: null, partialError: null }; // connected, nothing found
	}

	if (failedKinds.length > 0) {
		const kind = failedKinds[0]!;
		return {
			cards,
			error: null,
			partialError:
				kind === 'movie'
					? "Couldn't reach the movie library — showing series instead."
					: "Couldn't reach the series library — showing movies instead."
		};
	}

	return { cards, error: null, partialError: null };
}
