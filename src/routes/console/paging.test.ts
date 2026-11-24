import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';

/**
 * AD-01: the console's reload effect reads the History/Blocklist page counters
 * (via `load()`) while also resetting them to 1. In Svelte 5 those reads are
 * dependencies of the effect, so "Next" did `histPage++` + `load()`, the effect
 * then re-ran because `histPage` changed, reset it to 1 and superseded the page-2
 * response with page 1 — History and Blocklist were stuck on page 1 forever.
 *
 * The suite has no DOM mount harness, so this asserts the invariant that makes
 * the bug impossible on the compiled page: the effect must request page 1
 * explicitly, and `load()` must take the page as an argument instead of reading
 * the counters the effect writes. (Probes p7/p8 in the audit reproduced the
 * runtime behaviour; this pins the shape that prevents it.)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, '+page.svelte'), 'utf8');
const CODE = compile(SOURCE, { generate: 'client', filename: 'console/+page.svelte' }).js.code;

/** The compiled body of `Name(...) { … }`, found by its async/function prefix. */
function functionBody(name: string): string {
	const start = CODE.indexOf(`async function ${name}(`);
	const plain = CODE.indexOf(`function ${name}(`);
	const from = start === -1 ? plain : start;
	assert.notEqual(from, -1, `expected a compiled ${name}() in the page`);
	const open = CODE.indexOf('{', from);
	let depth = 0;
	for (let i = open; i < CODE.length; i++) {
		if (CODE[i] === '{') depth++;
		else if (CODE[i] === '}') {
			depth--;
			if (depth === 0) return CODE.slice(open + 1, i);
		}
	}
	throw new Error(`unbalanced braces after ${name}()`);
}

/** Every `$.user_effect(() => { … })` body in the compiled page. */
function effectBodies(): string[] {
	const bodies: string[] = [];
	let at = CODE.indexOf('$.user_effect(');
	while (at !== -1) {
		const open = CODE.indexOf('{', at);
		let depth = 0;
		for (let i = open; i < CODE.length; i++) {
			if (CODE[i] === '{') depth++;
			else if (CODE[i] === '}') {
				depth--;
				if (depth === 0) {
					bodies.push(CODE.slice(open + 1, i));
					break;
				}
			}
		}
		at = CODE.indexOf('$.user_effect(', at + 1);
	}
	return bodies;
}

test('AD-01: the reload effect asks for page 1 instead of reading the page counters', () => {
	const reload = effectBodies().find((body) => body.includes('loadSummary'));
	assert.ok(reload, 'the tab/service reload effect must still exist');
	assert.match(reload, /\bload\(1\)/, 'the effect must load page 1 explicitly');

	// The defect: `load()` read histPage/blockPage synchronously, which made the
	// effect depend on the very counters it resets.
	const load = functionBody('load');
	assert.doesNotMatch(
		load,
		/\$\.get\((histPage|blockPage|libPage)\)/,
		'load() must receive the page as an argument, not read the pager state'
	);
});

test('AD-01: History and Blocklist still reload the page they advanced to', () => {
	// The pager handlers are the only readers of the counters, so a page change
	// loads that page and nothing resets it afterwards. Svelte compiles the
	// click handlers to `$.update(histPage)` / `$.update(histPage, -1)` followed
	// by `load($.get(histPage))`.
	for (const counter of ['histPage', 'blockPage']) {
		assert.match(CODE, new RegExp(`\\$\\.update\\(${counter}\\)`), `${counter} must still advance`);
		assert.match(
			CODE,
			new RegExp(`\\$\\.update\\(${counter}, -1\\)`),
			`${counter} must still go back`
		);
		const loads = CODE.match(new RegExp(`load\\(\\$\\.get\\(${counter}\\)\\)`, 'g')) ?? [];
		assert.equal(loads.length, 2, `${counter} Previous and Next must load the page they moved to`);
	}
});
