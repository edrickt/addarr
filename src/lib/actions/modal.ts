// Modal dialog behavior: initial focus, Tab trapping, and focus return to
// the triggering element on close. Apply with `use:modal` on the dialog card.
export function modal(node: HTMLElement) {
	const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

	node.addEventListener('keydown', onKeydown);
	document.addEventListener('focusin', onFocusIn);
	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			document.removeEventListener('focusin', onFocusIn);
			prev?.focus();
		}
	};
}
