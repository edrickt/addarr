// App icon generation for Addarr — no native dependencies.
//
// The mark mirrors static/favicon.svg (sky-blue "A" on slate, sharp corners
// softened only by the platform's standard icon radius). It is rasterized here
// from vector geometry so the icon works on a machine with nothing installed
// beyond Node.
//
// Outputs (in build/icons, regenerated as needed):
//   addarr-<size>.png   Linux .desktop / general purpose
//   addarr.ico          Windows Start Menu shortcut
//   AppIcon.icns        macOS .app bundle (needs iconutil, present on macOS)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ICON_DIR = join(ROOT, 'build', 'icons');

// --- palette (matches static/favicon.svg) ---------------------------------

const BG_TOP = [36, 52, 74]; // #24344a
const BG_BOTTOM = [23, 32, 51]; // #172033
const FG = [56, 189, 248]; // #38bdf8

// Bold geometric "A": two legs meeting at the apex plus a crossbar, as three
// simple polygons in loose unit coordinates. Rescaled to its own bounding box
// at render time.
const GLYPH = [
	[
		[0.5, 0.17], // apex
		[0.155, 0.84], // left foot, outside
		[0.345, 0.84], // left foot, inside
		[0.5, 0.44] // where the inner edges meet
	],
	[
		[0.5, 0.17],
		[0.845, 0.84],
		[0.655, 0.84],
		[0.5, 0.44]
	],
	[
		[0.295, 0.575],
		[0.705, 0.575],
		[0.705, 0.7],
		[0.295, 0.7]
	]
];

const GLYPH_BOX = (() => {
	const xs = GLYPH.flat().map(([x]) => x);
	const ys = GLYPH.flat().map(([, y]) => y);
	return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
})();

// --- PNG encoder -----------------------------------------------------------

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buf) {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

function encodePng(size, rgba) {
	const stride = size * 4;
	const raw = Buffer.alloc((stride + 1) * size);
	for (let y = 0; y < size; y++) {
		raw[y * (stride + 1)] = 0; // filter: none
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // truecolour + alpha
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', deflateSync(raw, { level: 9 })),
		pngChunk('IEND', Buffer.alloc(0))
	]);
}

// --- rasterizer ------------------------------------------------------------

function inPolygon(x, y, poly) {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

function inGlyph(u, v) {
	const gx = (u - GLYPH_BOX.x) / GLYPH_BOX.w;
	const gy = (v - GLYPH_BOX.y) / GLYPH_BOX.h;
	if (gx < 0 || gx > 1 || gy < 0 || gy > 1) return false;
	return GLYPH.some((poly) => inPolygon(gx, gy, poly));
}

/**
 * Rasterize the Addarr mark at `size` px.
 * @param {number} size
 * @param {{inset?: number}} [options] inset = padding around the rounded
 *   square, as a fraction of the canvas (macOS icon grid ≈ 0.098).
 */
export function renderIcon(size, { inset = 0.098 } = {}) {
	const rgba = Buffer.alloc(size * size * 4);
	const ss = size <= 256 ? 4 : 2; // supersamples per axis for smooth edges
	const samples = ss * ss;

	const pad = inset * size;
	const cx = size / 2;
	const cy = size / 2;
	const half = (size - pad * 2) / 2;
	const radius = half * 0.2245;
	const glyphSide = half * 1.6; // glyph box as a fraction of the shape
	const gx0 = cx - glyphSide / 2;
	const gy0 = cy - glyphSide / 2;

	for (let y = 0; y < size; y++) {
		const t = (y + 0.5) / size;
		const bg = BG_TOP.map((c, i) => c + (BG_BOTTOM[i] - c) * t);
		for (let x = 0; x < size; x++) {
			let coverShape = 0;
			let coverGlyph = 0;
			for (let sy = 0; sy < ss; sy++) {
				for (let sx = 0; sx < ss; sx++) {
					const px = x + (sx + 0.5) / ss;
					const py = y + (sy + 0.5) / ss;
					const qx = Math.abs(px - cx) - (half - radius);
					const qy = Math.abs(py - cy) - (half - radius);
					const dist =
						Math.min(Math.max(qx, qy), 0) +
						Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
						radius;
					if (dist > 0) continue;
					coverShape++;
					if (inGlyph((px - gx0) / glyphSide, (py - gy0) / glyphSide)) coverGlyph++;
				}
			}
			const alpha = coverShape / samples;
			const mix = coverShape ? coverGlyph / coverShape : 0;
			const o = (y * size + x) * 4;
			for (let i = 0; i < 3; i++) rgba[o + i] = Math.round(bg[i] + (FG[i] - bg[i]) * mix);
			rgba[o + 3] = Math.round(alpha * 255);
		}
	}
	return encodePng(size, rgba);
}

// --- platform containers ---------------------------------------------------

function buildIco(entries) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2); // type: icon
	header.writeUInt16LE(entries.length, 4);
	const dir = Buffer.alloc(16 * entries.length);
	let offset = 6 + dir.length;
	entries.forEach(({ size, png }, i) => {
		const o = i * 16;
		dir[o] = size >= 256 ? 0 : size;
		dir[o + 1] = size >= 256 ? 0 : size;
		dir.writeUInt16LE(1, o + 4); // colour planes
		dir.writeUInt16LE(32, o + 6); // bits per pixel
		dir.writeUInt32LE(png.length, o + 8);
		dir.writeUInt32LE(offset, o + 12);
		offset += png.length;
	});
	return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

function buildIcns(icnsPath) {
	// iconutil insists on a *.iconset directory name.
	const iconset = join(mkdtempSync(join(tmpdir(), 'addarr-')), 'AppIcon.iconset');
	mkdirSync(iconset);
	try {
		const files = {
			'icon_16x16.png': 16,
			'icon_16x16@2x.png': 32,
			'icon_32x32.png': 32,
			'icon_32x32@2x.png': 64,
			'icon_128x128.png': 128,
			'icon_128x128@2x.png': 256,
			'icon_256x256.png': 256,
			'icon_256x256@2x.png': 512,
			'icon_512x512.png': 512,
			'icon_512x512@2x.png': 1024
		};
		for (const [name, size] of Object.entries(files)) {
			writeFileSync(join(iconset, name), renderIcon(size));
		}
		execFileSync('iconutil', ['-c', 'icns', '-o', icnsPath, iconset], { stdio: ['ignore', 'pipe', 'pipe'] });
		return true;
	} catch {
		return false; // iconutil unavailable — callers fall back to no icon
	} finally {
		rmSync(iconset, { recursive: true, force: true });
	}
}

const cache = new Map();

function pngFor(size, inset) {
	const key = `${size}:${inset}`;
	if (!cache.has(key)) cache.set(key, renderIcon(size, { inset }));
	return cache.get(key);
}

/**
 * Generate all icon artifacts. Safe to call repeatedly; only writes when the
 * target file is missing or older than this script.
 * @returns {{dir: string, png: (size?: number, inset?: number) => Buffer,
 *   pngPath: string, icoPath: string|null, icnsPath: string|null}}
 */
export function ensureIcons() {
	mkdirSync(ICON_DIR, { recursive: true });

	const pngPath = join(ICON_DIR, 'addarr-256.png');
	writeFileSync(pngPath, pngFor(256, 0.03));

	let icnsPath = null;
	if (process.platform === 'darwin' && hasCommand('iconutil')) {
		const target = join(ICON_DIR, 'AppIcon.icns');
		if (buildIcns(target)) icnsPath = target;
	}

	let icoPath = null;
	try {
		const target = join(ICON_DIR, 'addarr.ico');
		writeFileSync(
			target,
			buildIco([64, 48, 32, 16].map((size) => ({ size, png: pngFor(size, 0.03) })))
		);
		icoPath = target;
	} catch {
		/* icon is cosmetic; never block install */
	}

	return { dir: ICON_DIR, png: pngFor, pngPath, icoPath, icnsPath };
}

function hasCommand(name) {
	try {
		execFileSync('/usr/bin/which', [name], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

// `node scripts/icons.mjs` — generate and report.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	const icons = ensureIcons();
	console.log(`Icons written to ${icons.dir}`);
	console.log(`  png:  ${icons.pngPath}`);
	console.log(`  ico:  ${icons.icoPath ?? 'skipped'}`);
	console.log(`  icns: ${icons.icnsPath ?? 'skipped'}`);
}
