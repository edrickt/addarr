import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

/** GET /api/activity — recent activity log entries (admin only). */
export const GET: RequestHandler = async ({ url }) => {
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const pageSize = 50;
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
