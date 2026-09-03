// Modal dialog behavior: initial focus, Tab trapping, and focus return to
// the triggering element on close. Apply with `use:modal` on the dialog card.
export function modal(node: HTMLElement) {
	const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	node.focus();

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const focusables = Array.from(
			node.querySelectorAll<HTMLElement>(
				'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
			)
		).filter((el) => !el.hasAttribute('disabled'));
		if (focusables.length === 0) return;
		const first = focusables[0]!;
		const last = focusables[focusables.length - 1]!;
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	node.addEventListener('keydown', onKeydown);
	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			prev?.focus();
		}
	};
}
