import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markBackgroundInert, restoreInert } from './modal.ts';

type FakeElement = {
	tagName: string;
	className: string;
	parentElement: FakeElement | null;
	children: FakeElement[];
	inert: boolean;
	hasAttribute(name: string): boolean;
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
	closest(selector: string): FakeElement | null;
};

function el(tagName: string, className = ''): FakeElement {
	const node: FakeElement = {
		tagName,
		className,
		parentElement: null,
		children: [],
		inert: false,
		hasAttribute(name: string) {
			return name === 'inert' ? node.inert : false;
		},
		setAttribute(name: string) {
			if (name === 'inert') node.inert = true;
		},
		removeAttribute(name: string) {
			if (name === 'inert') node.inert = false;
		},
		closest(selector: string) {
			const wanted = selector.startsWith('.') ? selector.slice(1) : selector;
			let current: FakeElement | null = node;
			while (current) {
				if (selector.startsWith('.') ? current.className.split(/\s+/).includes(wanted) : current.tagName === wanted) {
					return current;
				}
				current = current.parentElement;
			}
			return null;
		}
	};
	return node;
}

function append(parent: FakeElement, ...children: FakeElement[]): FakeElement {
	for (const child of children) {
		child.parentElement = parent;
		parent.children.push(child);
	}
	return parent;
}

const asElement = (node: FakeElement) => node as unknown as Element;

test('AUD-02: the dialog itself stays interactive while its surroundings go inert', () => {
	const app = el('DIV');
	const header = el('HEADER');
	const main = el('MAIN');
	const page = el('DIV');
	const overlay = el('DIV');
	const dialog = el('DIV');
	const saveButton = el('BUTTON');
	append(app, header, main);
	append(main, page, overlay);
	append(overlay, dialog);
	append(dialog, saveButton);

	const marked = markBackgroundInert(asElement(dialog), asElement(app));

	// The background branches are inert...
	assert.deepEqual(
		marked.map((node) => (node as unknown as FakeElement).tagName),
		['DIV', 'HEADER']
	);
	assert.equal(page.inert, true, 'page content behind the overlay must be inert');
	assert.equal(header.inert, true, 'top bar must be inert');
	// ...but the dialog's own branch (overlay > dialog > controls) must not be.
	assert.equal(overlay.inert, false, 'the overlay is the dialog branch and must stay interactive');
	assert.equal(dialog.inert, false, 'inert on an ancestor would inactivate the dialog');
	assert.equal(saveButton.inert, false, 'dialog controls must stay usable');
});

test('AUD-02: an already-inert sibling is left alone and not restored later', () => {
	const app = el('DIV');
	const main = el('MAIN');
	const page = el('DIV');
	const overlay = el('DIV');
	const dialog = el('DIV');
	append(app, main);
	append(main, page, overlay);
	append(overlay, dialog);
	page.inert = true; // an outer modal already marked it

	const marked = markBackgroundInert(asElement(dialog), asElement(app));
	assert.equal(marked.length, 0);
	assert.equal(page.inert, true);
});

test('AUD-02: nested dialogs only inactivate the branches outside themselves', () => {
	const app = el('DIV');
	const header = el('HEADER');
	const main = el('MAIN');
	const page = el('DIV');
	const outerOverlay = el('DIV');
	const outerDialog = el('DIV');
	const innerOverlay = el('DIV');
	const innerDialog = el('DIV');
	append(app, header, main);
	append(main, page, outerOverlay, innerOverlay);
	append(outerOverlay, outerDialog);
	append(innerOverlay, innerDialog);

	const marked = markBackgroundInert(asElement(innerDialog), asElement(app));
	assert.equal(page.inert, true);
	assert.equal(outerOverlay.inert, true, 'the dialog underneath is background to the new one (inherits inert)');
	assert.equal(innerDialog.inert, false);
	assert.deepEqual(
		marked.map((node) => (node as unknown as FakeElement).tagName),
		['DIV', 'DIV', 'HEADER']
	);
});

test('AUD-02: a dialog outside the app shell is not marked (no inert root to walk)', () => {
	const detached = el('DIV');
	assert.deepEqual(markBackgroundInert(asElement(detached), null), []);
});

test('AUD-02 follow-up: DownloadSheet shape keeps the click-outside backdrop active', () => {
	// <div class="app"> <main> <page/> <div class="overlay sheet-overlay">
	//   <button class="backdrop"/> <div class="dialog" use:modal>…</div>
	// </div> </main> </div>
	const app = el('DIV', 'app');
	const header = el('HEADER');
	const main = el('MAIN');
	const page = el('DIV');
	const overlay = el('DIV', 'overlay sheet-overlay');
	const backdrop = el('BUTTON', 'backdrop');
	const dialog = el('DIV', 'card dialog');
	const closeButton = el('BUTTON');
	append(app, header, main);
	append(main, page, overlay);
	append(overlay, backdrop, dialog);
	append(dialog, closeButton);

	const marked = markBackgroundInert(asElement(dialog), asElement(app));

	assert.equal(backdrop.inert, false, 'click-outside-to-close must stay clickable');
	assert.equal(dialog.inert, false);
	assert.equal(closeButton.inert, false);
	assert.equal(page.inert, true, 'page background must still be inert');
	assert.equal(header.inert, true);
	assert.deepEqual(
		marked.map((node) => (node as unknown as FakeElement).tagName),
		['DIV', 'HEADER']
	);
});

test('AUD-02 follow-up: destroy restores exactly the elements that were marked', () => {
	const app = el('DIV', 'app');
	const header = el('HEADER');
	const main = el('MAIN');
	const page = el('DIV');
	const overlay = el('DIV', 'overlay');
	const backdrop = el('BUTTON', 'backdrop');
	const dialog = el('DIV', 'dialog');
	append(app, header, main);
	append(main, page, overlay);
	append(overlay, backdrop, dialog);

	const marked = markBackgroundInert(asElement(dialog), asElement(app));
	assert.equal(page.inert, true);
	assert.equal(header.inert, true);

	restoreInert(marked);

	assert.equal(page.inert, false, 'page background restored');
	assert.equal(header.inert, false, 'top bar restored');
	assert.equal(backdrop.inert, false);
	assert.equal(dialog.inert, false);
});
