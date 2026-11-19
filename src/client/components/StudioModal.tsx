import { useMemo, useState } from "react";
import { navigateTo, showToast } from "@devvit/web/client";
import {
	cellKey,
	getInitialOrientations,
	traceBeam,
	validateCustomPuzzle,
	type CellKind,
	type Direction,
	type PuzzleCell,
	type PuzzleStage,
} from "../../shared/prismEngine";
import type { ApiErrorResponse, PublishPuzzleResponse } from "../../shared/api";
import { ModalDialog } from "./ModalDialog";
import { PrismBoard } from "./PrismBoard";

type StudioModalProps = {
	open: boolean;
	onClose: () => void;
};

type ToolKind =
	| "mirror"
	| "splitter"
	| "crystal"
	| "block"
	| "emitter"
	| "portalA"
	| "portalB"
	| "erase";

const TOOLS: readonly { id: ToolKind; label: string }[] = [
	{ id: "mirror", label: "Mirror" },
	{ id: "splitter", label: "Prism" },
	{ id: "crystal", label: "Crystal" },
	{ id: "block", label: "Block" },
	{ id: "emitter", label: "Emitter" },
	{ id: "portalA", label: "Portal A" },
	{ id: "portalB", label: "Portal B" },
	{ id: "erase", label: "Erase" },
];

const INITIAL_STUDIO_CELLS: PuzzleCell[] = [
	{ r: 0, c: 1, kind: "emitter", dir: 2 },
	{ r: 3, c: 1, kind: "mirror", orientation: 0 },
	{ r: 3, c: 4, kind: "mirror", orientation: 1 },
	{ r: 1, c: 4, kind: "crystal" },
	{ r: 3, c: 3, kind: "crystal" },
];

export const StudioModal = ({ open, onClose }: StudioModalProps) => {
	const [title, setTitle] = useState("Mirror Gauntlet");
	const [size, setSize] = useState<5 | 6>(5);
	const [tool, setTool] = useState<ToolKind>("mirror");
	const [cells, setCells] = useState<PuzzleCell[]>(INITIAL_STUDIO_CELLS);
	const [publishing, setPublishing] = useState(false);

	const stage: PuzzleStage = useMemo(
		() => ({
			id: "studio-draft",
			stageNumber: 1,
			name: title || "Custom Optics",
			subtitle: "Community Studio Puzzle",
			size,
			par: 1,
			cells,
		}),
		[title, size, cells],
	);

	const orientations = useMemo(() => getInitialOrientations(stage), [stage]);
	const trace = useMemo(
		() => traceBeam(stage, orientations),
		[stage, orientations],
	);
	const validation = useMemo(() => validateCustomPuzzle(stage), [stage]);

	const handleCellTap = (r: number, c: number) => {
		setCells((prev) => {
			const k = cellKey(r, c);
			const existing = prev.find((item) => cellKey(item.r, item.c) === k);

			if (tool === "erase") {
				return prev.filter((item) => cellKey(item.r, item.c) !== k);
			}

			// Clicking an existing mirror/splitter with the same tool flips its angle
			if (
				existing &&
				existing.kind === tool &&
				(existing.kind === "mirror" || existing.kind === "splitter")
			) {
				return prev.map((item) =>
					cellKey(item.r, item.c) === k
						? { ...item, orientation: item.orientation === 0 ? 1 : 0 }
						: item,
				);
			}

			// Clicking an existing emitter rotates its beam direction clockwise
			if (existing && existing.kind === "emitter" && tool === "emitter") {
				const nextDir = (((existing.dir ?? 0) + 1) % 4) as Direction;
				return prev.map((item) =>
					cellKey(item.r, item.c) === k ? { ...item, dir: nextDir } : item,
				);
			}

			let filtered = prev.filter((item) => cellKey(item.r, item.c) !== k);
			// Enforce singleton emitter / portalA / portalB
			if (tool === "emitter" || tool === "portalA" || tool === "portalB") {
				filtered = filtered.filter((item) => item.kind !== tool);
			}

			const kind: CellKind = tool;
			const added: PuzzleCell =
				kind === "emitter"
					? { r, c, kind, dir: 1 }
					: kind === "mirror" || kind === "splitter"
						? { r, c, kind, orientation: 0 }
						: { r, c, kind };

			return [...filtered, added];
		});
	};

	const handleSizeChange = (nextSize: 5 | 6) => {
		setSize(nextSize);
		setCells((prev) =>
			prev.filter((cell) => cell.r < nextSize && cell.c < nextSize),
		);
	};

	const handlePublish = async () => {
		if (!validation.valid || validation.par === undefined) {
			showToast(validation.error ?? "Fix the puzzle before publishing.");
			return;
		}

		setPublishing(true);
		try {
			const res = await fetch("/api/publish-puzzle", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: title.trim() || "Community Beam",
					stage: { ...stage, par: validation.par },
				}),
			});
			if (!res.ok) {
				const err = (await res.json()) as ApiErrorResponse;
				showToast(err.message || "Could not publish puzzle.");
				return;
			}
			const data = (await res.json()) as PublishPuzzleResponse;
			showToast("Published your puzzle to Reddit!");
			onClose();
			navigateTo(data.url);
		} catch {
			showToast("Network error while publishing.");
		} finally {
			setPublishing(false);
		}
	};

	return (
		<ModalDialog open={open} title="Community Puzzle Studio" onClose={onClose}>
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<input
						type="text"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						maxLength={50}
						aria-label="Puzzle title"
						placeholder="Name your puzzle..."
						className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
					/>
					<div className="flex overflow-hidden rounded-lg border border-slate-700">
						<button
							type="button"
							onClick={() => handleSizeChange(5)}
							className={`cursor-pointer px-2.5 py-2 text-xs font-semibold ${
								size === 5
									? "bg-sky-500 text-slate-950"
									: "bg-slate-900 text-slate-300"
							}`}
						>
							5×5
						</button>
						<button
							type="button"
							onClick={() => handleSizeChange(6)}
							className={`cursor-pointer px-2.5 py-2 text-xs font-semibold ${
								size === 6
									? "bg-sky-500 text-slate-950"
									: "bg-slate-900 text-slate-300"
							}`}
						>
							6×6
						</button>
					</div>
				</div>

				{/* Palette */}
				<div className="grid grid-cols-4 gap-1.5">
					{TOOLS.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => setTool(item.id)}
							className={`min-h-9 cursor-pointer rounded-lg border px-2 py-1.5 text-xs font-semibold ${
								tool === item.id
									? "border-sky-400 bg-sky-500/20 text-sky-200"
									: "border-slate-700/80 bg-slate-900/80 text-slate-300 hover:border-slate-500"
							}`}
						>
							{item.label}
						</button>
					))}
				</div>

				<p className="text-[11px] text-slate-400">
					Tap cells to place. Tap an existing Emitter, Mirror, or Prism again to
					rotate it.
				</p>

				<div className="flex justify-center">
					<PrismBoard
						stage={stage}
						orientations={orientations}
						trace={trace}
						onCellTap={handleCellTap}
						interactive
						studioMode
						compact
					/>
				</div>

				{/* Live solver validation pill */}
				<div
					className={`rounded-lg border px-3 py-2 text-xs font-medium ${
						validation.valid
							? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
							: "border-amber-500/40 bg-amber-950/35 text-amber-200"
					}`}
				>
					{validation.valid
						? `✓ Solvable! Optimal Par = ${validation.par} taps. Ready to post to Reddit.`
						: validation.error}
				</div>

				<button
					type="button"
					disabled={!validation.valid || publishing}
					onClick={() => {
						void handlePublish();
					}}
					className="min-h-11 w-full cursor-pointer rounded-xl bg-[#ff4500] px-4 py-2.5 text-sm font-bold text-white shadow-[0_6px_20px_rgba(255,69,0,0.35)] hover:bg-[#e03d00] disabled:cursor-not-allowed disabled:opacity-45"
				>
					{publishing ? "Publishing to Subreddit..." : "Publish as Reddit Post"}
				</button>
			</div>
		</ModalDialog>
	);
};
