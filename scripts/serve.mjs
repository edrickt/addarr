// Server launcher for the adapter-node build.
//
// Default: binds to 127.0.0.1 (localhost only).
// LAN mode (`--lan` flag or ADDARR_LAN=1): binds to 0.0.0.0 and broadcasts
// the service over mDNS/Bonjour so other devices on the network can
// discover it (e.g. as "Addarr" in Bonjour/Avahi browsers) and reach it
// at http://<machine-ip>:<port>.
import { createServer } from 'node:http';
import os from 'node:os';
import { handler } from '../build/handler.js';

const lanMode = process.argv.includes('--lan') || process.env.ADDARR_LAN === '1';
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || (lanMode ? '0.0.0.0' : '127.0.0.1');

function lanAddress() {
	for (const ifaces of Object.values(os.networkInterfaces())) {
		for (const iface of ifaces ?? []) {
			if (iface.family === 'IPv4' && !iface.internal) return iface.address;
		}
	}
	return null;
}

const server = createServer(handler);

server.listen(port, host, () => {
	console.log(`Addarr listening on http://localhost:${port}`);
	if (lanMode) {
		const ip = lanAddress();
		if (ip) console.log(`LAN access:  http://${ip}:${port}`);
		else console.log('LAN access enabled, but no LAN IPv4 address found yet.');

		// mDNS/Bonjour broadcast. Imported lazily and best-effort: if the
		// multicast stack is unavailable (some containers/VPNs), the server
		// still runs — discovery just won't work.
		import('bonjour-service')
			.then(({ Bonjour }) => {
				const bonjour = new Bonjour();
				bonjour.publish({ name: 'Addarr', type: 'http', port, host: os.hostname() });
				console.log('Broadcasting on the LAN via mDNS (Bonjour) as "Addarr".');
				const bye = () => bonjour.unpublishAll(() => process.exit(0));
				process.on('SIGINT', bye);
				process.on('SIGTERM', bye);
			})
			.catch((err) => {
				console.warn(`mDNS broadcast unavailable (${err?.message ?? err}) — continuing without discovery.`);
			});
	} else {
		console.log('Localhost only. Start with --lan (or ADDARR_LAN=1) to share on your network.');
	}
});
