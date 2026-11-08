// Modal dialog behavior: initial focus, Tab trapping, body scroll lock, and
// focus return to the triggering element on close. Apply with `use:modal` on
// the dialog card.
let scrollLocks = 0;
let previousBodyOverflow = '';

function lockBodyScroll() {
	if (scrollLocks++ === 0) {
		previousBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
	}
}

function unlockBodyScroll() {
	if (--scrollLocks === 0) {
		document.body.style.overflow = previousBodyOverflow;
	}
}

/**
 * Mark the dialog's surroundings inert without inactivating the dialog itself.
 *
 * `inert` is inherited: setting it on `.app` (an ancestor of every dialog)
 * also makes the dialog and its controls inert, so no button or input can be
 * focused or clicked (AUD-02). Instead, walk up from the dialog's overlay to
 * `root` and mark each ancestor's *siblings* inert — every branch of the tree
 * except the overlay the dialog lives in. Starting at the overlay keeps its
 * other children active: the DownloadSheet's full-screen `.backdrop` close
 * button is a sibling of the dialog card, not page background (AUD-02
 * follow-up).
 *
 * Returns the elements that were marked so they can be restored on destroy;
 * elements already inert (e.g. an outer modal's background) are left untouched
 * and not returned.
 */
export function markBackgroundInert(node: Element, root: Element | null): Element[] {
	const marked: Element[] = [];
	// The overlay is the dialog's own layer: its siblings (e.g. the backdrop) are
	// part of the modal, not the background.
	let current: Element | null = node.closest('.overlay') ?? node;
	while (current && current !== root) {
		const parent: Element | null = current.parentElement;
		if (!parent) break;
		for (const sibling of Array.from(parent.children)) {
			if (sibling === current) continue;
			if (sibling.tagName === 'SCRIPT' || sibling.tagName === 'STYLE') continue;
			if (sibling.hasAttribute('inert')) continue;
			sibling.setAttribute('inert', '');
			marked.push(sibling);
		}
		current = parent;
	}
	return marked;
}

/** Undo markBackgroundInert: restore only the elements this modal marked. */
export function restoreInert(marked: Element[]): void {
	for (const el of marked) el.removeAttribute('inert');
}

export function modal(node: HTMLElement) {
	const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	lockBodyScroll();
	node.focus();

	function focusables(): HTMLElement[] {
		return Array.from(
			node.querySelectorAll<HTMLElement>(
				'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
			)
		).filter((el) => !el.hasAttribute('disabled'));
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const list = focusables();
		if (list.length === 0) return;
		const first = list[0]!;
		const last = list[list.length - 1]!;
		if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	// Clicking outside the dialog can blur the focused control to <body>;
	// pull focus back so the modal cannot be escaped with the keyboard.
	function onFocusIn(e: FocusEvent) {
		if (!node.contains(e.target as Node)) node.focus();
	}

	document.addEventListener('keydown', onKeydown, true);
	document.addEventListener('focusin', onFocusIn);
	// Mark the background (not the dialog's own branch) inert while open (AUD-02).
	const app = document.querySelector<HTMLElement>('.app');
	const markedInert = app && app.contains(node) ? markBackgroundInert(node, app) : [];
	return {
		destroy() {
			document.removeEventListener('keydown', onKeydown, true);
			document.removeEventListener('focusin', onFocusIn);
			restoreInert(markedInert);
			unlockBodyScroll();
			prev?.focus();
		}
	};
}
