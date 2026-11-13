import type { PageServerLoad } from './$types';
import { hasAnyUser } from '$lib/server/auth';

/**
 * First-run state for the sign-in page. Without this the page cannot tell "no
 * admin exists yet" (link to /setup) from "sign in" — a fresh install used to
 * render a sign-in form for an account that could not exist, hiding the only
 * visible path to first-time setup.
 */
export const load: PageServerLoad = () => {
	return { hasAdmin: hasAnyUser() };
};
