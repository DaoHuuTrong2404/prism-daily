import { useEffect, useId, useRef, type ReactNode } from "react";

type ModalDialogProps = {
	open: boolean;
	title: string;
	onClose: () => void;
	children: ReactNode;
};

export const ModalDialog = ({
	open,
	title,
	onClose,
	children,
}: ModalDialogProps) => {
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const titleId = useId();

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		dialog.setAttribute("closedby", "any");

		if (open && !dialog.open) {
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	}, [open]);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		const handleClose = () => {
			dialog.returnValue = "";
			onClose();
		};
		dialog.addEventListener("close", handleClose);

		// Mandatory fallback for browsers without native closedby support (e.g. Safari)
		let cleanupFallback: (() => void) | undefined;
		if (!("closedBy" in HTMLDialogElement.prototype)) {
			let pressedOutside = false;
			const isOutside = (e: PointerEvent): boolean => {
				const rect = dialog.getBoundingClientRect();
				return (
					e.clientX < rect.left ||
					e.clientX > rect.right ||
					e.clientY < rect.top ||
					e.clientY > rect.bottom
				);
			};
			const onDown = (e: PointerEvent) => {
				pressedOutside = isOutside(e);
			};
			const onUp = (e: PointerEvent) => {
				if (pressedOutside && isOutside(e) && dialog.open) {
					dialog.close();
				}
				pressedOutside = false;
			};
			dialog.addEventListener("pointerdown", onDown);
			dialog.addEventListener("pointerup", onUp);
			cleanupFallback = () => {
				dialog.removeEventListener("pointerdown", onDown);
				dialog.removeEventListener("pointerup", onUp);
			};
		}

		return () => {
			dialog.removeEventListener("close", handleClose);
			if (cleanupFallback) cleanupFallback();
		};
	}, [onClose]);

	return (
		<dialog ref={dialogRef} className="prism-dialog" aria-labelledby={titleId}>
			<div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3">
				<h2
					id={titleId}
					className="text-sm font-semibold tracking-wide text-slate-100 uppercase"
				>
					{title}
				</h2>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close dialog"
					className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/70 text-slate-300 hover:border-sky-400/50 hover:text-white"
				>
					✕
				</button>
			</div>
			<div className="overflow-y-auto px-4 py-4">{children}</div>
		</dialog>
	);
};
