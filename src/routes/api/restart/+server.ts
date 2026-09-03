import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logActivity } from '$lib/server/auth';

/** POST /api/restart — admin-only graceful restart via the launcher. */
export const POST: RequestHandler = async ({ locals }) => {
	const restart = (globalThis as { __addarr?: { restart?: () => Promise<void> } }).__addarr
		?.restart;
	if (!restart) {
		return json(
			{
				error:
					'Restart requires the Addarr launcher. If you started with `node build` directly, restart manually.'
			},
			{ status: 501 }
		);
	}

	logActivity({ userId: locals.user!.id, serviceId: null, action: 'server.restart' });

	// Let the response flush before the process hands over.
	setTimeout(() => restart().catch(() => process.exit(0)), 150);
	return json({ ok: true, message: 'Restarting…' });
};
