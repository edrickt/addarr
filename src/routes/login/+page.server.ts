import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const users = db
		.prepare(`SELECT username FROM users WHERE disabled = 0 AND role = 'admin' ORDER BY username`)
		.all() as { username: string }[];
	return { usernames: users.map((u) => u.username) };
};
