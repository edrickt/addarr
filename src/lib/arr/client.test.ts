import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrClient } from './client.ts';
import { ArrError } from './types.ts';
import { createServer } from 'node:http';

function start(handler: (req: { url?: string }, res: { writeHead: Function; end: Function }) => void) {
	const server = createServer(handler as never);
	return new Promise<{ server: ReturnType<typeof createServer>; port: number }>((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
		});
	});
}

test('F-FOUND-02: non-JSON 200 throws ArrError 502, not SyntaxError', async () => {
	const { server, port } = await start((_req, res) => {
		(res as { writeHead: Function }).writeHead(200, { 'Content-Type': 'text/html' });
		(res as { end: Function }).end('<html>proxy login</html>');
	});
	try {
		const client = new ArrClient(`http://127.0.0.1:${port}`, 'k');
		await assert.rejects(() => client.raw('GET', '/x'), (e: unknown) => e instanceof ArrError && e.status === 502);
	} finally {
		server.close();
	}
});

test('F-FOUND-02: empty 200 returns undefined', async () => {
	const { server, port } = await start((_req, res) => {
		(res as { writeHead: Function }).writeHead(200, { 'Content-Type': 'application/json' });
		(res as { end: Function }).end('');
	});
	try {
		const client = new ArrClient(`http://127.0.0.1:${port}`, 'k');
		assert.equal(await client.raw('GET', '/x'), undefined);
	} finally {
		server.close();
	}
});

test('F-FOUND-06: ArrClient does not leak apiKey via JSON', () => {
	const client = new ArrClient('http://x', 'super-secret');
	const s = JSON.stringify(client);
	assert.ok(!s.includes('super-secret'));
	assert.ok(!Object.keys(client).includes('#apiKey'));
});
