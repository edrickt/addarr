import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

/**
 * Page numbers are bound as `LIMIT ? OFFSET ?`. An offset must be a safe
 * integer, so `?page=1e300` made SQLite throw "datatype mismatch" and SvelteKit
 * answered 500 (AD-10). Clamp to a page whose offset is still bindable: anything
 * past the real data then reads as an empty page, which is what the admin's
 * Next button already stops at.
 */
const PAGE_SIZE = 50;
const MAX_PAGE = 1_000_000;

function pageParam(raw: string | null): number {
	const value = Number(raw ?? '');
	if (Number.isNaN(value)) return 1; // absent or not a number: first page
	if (value < 1) return 1; // 0 / negative: first page
	return Math.min(Math.floor(value), MAX_PAGE); // huge / Infinity: last bindable page
}

/** GET /api/activity — recent activity log entries (admin only). */
export const GET: RequestHandler = async ({ url }) => {
	const page = pageParam(url.searchParams.get('page'));
	const pageSize = PAGE_SIZE;
	const rows = db
		.prepare(
			`SELECT a.id, a.action, a.title, a.arr_item_id, a.created_at,
			        u.username, s.name AS service, s.type AS service_type
			 FROM activity_log a
			 LEFT JOIN users u ON u.id = a.user_id
			 LEFT JOIN services s ON s.id = a.service_id
			 ORDER BY a.id DESC
			 LIMIT ? OFFSET ?`
		)
		.all(pageSize, (page - 1) * pageSize);
	return json({ entries: rows, page, pageSize });
};
