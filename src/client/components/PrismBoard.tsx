import { useId, type KeyboardEvent } from "react";
import {
	cellKey,
	type Direction,
	type MirrorOrientation,
	type PuzzleCell,
	type PuzzleStage,
	type TraceResult,
} from "../../shared/prismEngine";

type PrismBoardProps = {
	stage: PuzzleStage;
	orientations: Record<string, MirrorOrientation>;
	trace: TraceResult;
	onCellTap?: (r: number, c: number) => void;
	hintCellKey?: string | null;
	onboardCellKey?: string | null;
	burstKeys?: string[];
	interactive?: boolean;
	compact?: boolean;
	studioMode?: boolean;
};

const DIR_ROTATION_DEG: Record<Direction, number> = {
	0: -90, // North
	1: 0, // East
	2: 90, // South
	3: 180, // West
};

const beamColor = (kind: "primary" | "split" | "portal"): string => {
	if (kind === "split") return "#fbbf24";
	if (kind === "portal") return "#e879f9";
	return "#38bdf8";
};

export const PrismBoard = ({
	stage,
	orientations,
	trace,
	onCellTap,
	hintCellKey = null,
	onboardCellKey = null,
	burstKeys = [],
	interactive = true,
	compact = false,
	studioMode = false,
}: PrismBoardProps) => {
	const filterId = useId();
	const size = stage.size;
	const viewBoxSize = size * 100;

	const cellMap = new Map<string, PuzzleCell>();
	for (const cell of stage.cells) {
		cellMap.set(cellKey(cell.r, cell.c), cell);
	}

	const litCrystals = new Set(trace.litCrystals);
	const litOptics = new Set(trace.litOptics);

	const handleKeyDown = (
		e: KeyboardEvent<HTMLButtonElement>,
		r: number,
		c: number,
	) => {
		let nr = r;
		let nc = c;
		if (e.key === "ArrowUp") nr = Math.max(0, r - 1);
		else if (e.key === "ArrowDown") nr = Math.min(size - 1, r + 1);
		else if (e.key === "ArrowLeft") nc = Math.max(0, c - 1);
		else if (e.key === "ArrowRight") nc = Math.min(size - 1, c + 1);
		else return;

		e.preventDefault();
		const target = e.currentTarget
			.closest("[data-prism-grid]")
			?.querySelector<HTMLButtonElement>(`[data-cell="${nr}-${nc}"]`);
		target?.focus();
	};

	return (
		<div
			data-prism-grid
			className={`relative aspect-square w-full select-none rounded-2xl border border-slate-700/60 bg-[#0b101b] p-2 shadow-[0_18px_48px_rgba(0,0,0,0.65)] ${
				compact ? "max-w-[230px]" : "max-w-[380px]"
			}`}
		>
			{/* Solved emerald border aura */}
			{trace.solved && !studioMode ? (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -inset-px rounded-2xl border-2 border-emerald-400/80 shadow-[0_0_36px_rgba(52,211,153,0.42)]"
				/>
			) : null}

			<div className="relative h-full w-full overflow-hidden rounded-xl bg-[#090d16]">
				{/* Precision tile grid underneath beams */}
				<div
					className="grid h-full w-full"
					style={{
						gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
						gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
					}}
				>
					{Array.from({ length: size * size }, (_, idx) => {
						const r = Math.floor(idx / size);
						const c = idx % size;
						const k = cellKey(r, c);
						const cell = cellMap.get(k);
						const isMirror = cell?.kind === "mirror";
						const isSplitter = cell?.kind === "splitter";
						const isTappable =
							interactive && (studioMode || isMirror || isSplitter);
						const isHinted = hintCellKey === k;
						const isOnboard = !isHinted && onboardCellKey === k;
						const isLitOptic = litOptics.has(k);
						const isLitCrystal = litCrystals.has(k);
						const orient: MirrorOrientation =
							orientations[k] ?? cell?.orientation ?? 0;

						const ariaLabel = cell
							? `Row ${r + 1} Column ${c + 1}: ${cell.kind}${
									isMirror || isSplitter
										? orient === 0
											? " angled slash, tap to rotate"
											: " angled backslash, tap to rotate"
										: ""
								}`
							: `Row ${r + 1} Column ${c + 1}: empty`;

						return (
							<button
								key={k}
								type="button"
								data-cell={`${r}-${c}`}
								disabled={!isTappable}
								onClick={() => {
									if (isTappable && onCellTap) onCellTap(r, c);
								}}
								onKeyDown={(e) => handleKeyDown(e, r, c)}
								aria-label={ariaLabel}
								className={`relative flex items-center justify-center border border-slate-800/70 transition-colors ${
									isTappable
										? "cursor-pointer hover:bg-sky-500/12"
										: "cursor-default"
								} ${
									isMirror || isSplitter
										? isLitOptic
											? "bg-sky-950/35"
											: "bg-slate-900/65"
										: cell?.kind === "block"
											? "bg-slate-950"
											: "bg-transparent"
								} ${
									isHinted
										? "hint-tile-anim z-20 rounded-lg"
										: isOnboard
											? "onboard-tile-anim z-20 rounded-lg"
											: ""
								}`}
							>
								{/* Tappable optic corner notches */}
								{(isMirror || isSplitter) && interactive && !compact ? (
									<span
										aria-hidden="true"
										className={`pointer-events-none absolute inset-1 rounded-md border ${
											isLitOptic ? "border-sky-400/50" : "border-slate-600/35"
										}`}
									/>
								) : null}

								{/* Obsidian Block */}
								{cell?.kind === "block" ? (
									<div
										aria-hidden="true"
										className="h-[78%] w-[78%] rounded-md border border-slate-700/70 bg-gradient-to-br from-slate-800 via-slate-900 to-black shadow-inner"
									/>
								) : null}

								{/* Sun Emitter */}
								{cell?.kind === "emitter" ? (
									<div
										aria-hidden="true"
										className="relative z-20 flex h-[70%] w-[70%] items-center justify-center rounded-full border border-amber-300/85 bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600 shadow-[0_0_22px_rgba(251,191,36,0.8)]"
										style={{
											transform: `rotate(${DIR_ROTATION_DEG[cell.dir ?? 1]}deg)`,
										}}
									>
										<svg
											viewBox="0 0 24 24"
											className="h-[62%] w-[62%] text-slate-950"
											fill="currentColor"
										>
											<path d="M5 11h10.17l-3.58-3.59L13 6l6 6-6 6-1.41-1.41L15.17 13H5z" />
										</svg>
									</div>
								) : null}

								{/* Crystal Target */}
								{cell?.kind === "crystal" ? (
									<div
										aria-hidden="true"
										className={`relative z-20 flex h-[64%] w-[64%] items-center justify-center ${
											isLitCrystal ? "crystal-lit-anim" : ""
										}`}
									>
										<svg
											viewBox="0 0 40 40"
											className="h-full w-full overflow-visible"
										>
											{isLitCrystal ? (
												<circle
													cx="20"
													cy="20"
													r="18"
													fill="rgba(52, 211, 153, 0.34)"
												/>
											) : null}
											<polygon
												points="20,4 33,13 33,27 20,36 7,27 7,13"
												fill={isLitCrystal ? "#34d399" : "#1e293b"}
												stroke={isLitCrystal ? "#fde047" : "#64748b"}
												strokeWidth="2.4"
											/>
											<polygon
												points="20,9 27,20 20,31 13,20"
												fill={isLitCrystal ? "#ecfdf5" : "#334155"}
												opacity={isLitCrystal ? 0.96 : 0.7}
											/>
										</svg>
									</div>
								) : null}

								{/* Rotatable Mirror */}
								{isMirror ? (
									<div
										aria-hidden="true"
										className="relative z-20 flex h-full w-full items-center justify-center transition-transform duration-150 ease-out"
										style={{
											transform:
												orient === 0 ? "rotate(-45deg)" : "rotate(45deg)",
										}}
									>
										<div
											className={`h-[14%] w-[78%] rounded-full border transition-all ${
												isLitOptic
													? "border-sky-100 bg-gradient-to-r from-sky-300 via-white to-sky-300 shadow-[0_0_18px_rgba(56,189,248,0.95)]"
													: "border-slate-400/80 bg-gradient-to-r from-slate-500 via-slate-200 to-slate-500"
											}`}
										/>
									</div>
								) : null}

								{/* Rotatable Prism Splitter */}
								{isSplitter ? (
									<div
										aria-hidden="true"
										className="relative z-20 flex h-full w-full items-center justify-center"
									>
										<div
											className={`h-[56%] w-[56%] rotate-45 rounded-sm border-2 transition-colors ${
												isLitOptic
													? "border-amber-200 bg-amber-400/30 shadow-[0_0_20px_rgba(251,191,36,0.9)]"
													: "border-amber-500/55 bg-amber-500/10"
											}`}
										/>
										<div
											className="pointer-events-none absolute h-[11%] w-[70%] rounded-full bg-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.95)] transition-transform duration-150 ease-out"
											style={{
												transform:
													orient === 0 ? "rotate(-45deg)" : "rotate(45deg)",
											}}
										/>
									</div>
								) : null}

								{/* Twin Quantum Portals */}
								{cell?.kind === "portalA" || cell?.kind === "portalB" ? (
									<div
										aria-hidden="true"
										className="relative z-20 flex h-[70%] w-[70%] items-center justify-center"
									>
										<div
											className={`${
												trace.portalActive
													? "portal-active-anim"
													: "portal-spin-anim"
											} absolute inset-0 rounded-full border-2 border-dashed ${
												cell.kind === "portalA"
													? trace.portalActive
														? "border-fuchsia-300 shadow-[0_0_24px_rgba(232,121,249,0.95)]"
														: "border-fuchsia-400/80 shadow-[0_0_14px_rgba(232,121,249,0.6)]"
													: trace.portalActive
														? "border-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.95)]"
														: "border-cyan-300/80 shadow-[0_0_14px_rgba(34,211,238,0.6)]"
											}`}
										/>
										<div
											className={`flex h-[58%] w-[58%] items-center justify-center rounded-full text-[10px] font-black ${
												cell.kind === "portalA"
													? "bg-fuchsia-500/35 text-fuchsia-100"
													: "bg-cyan-500/35 text-cyan-100"
											}`}
										>
											{cell.kind === "portalA" ? "A" : "B"}
										</div>
									</div>
								) : null}

								{/* Smart Hint badge */}
								{isHinted && !compact ? (
									<span
										aria-hidden="true"
										className="pointer-events-none absolute -top-1 right-0.5 z-30 rounded bg-amber-400 px-1 py-0.5 text-[8px] font-black tracking-wider text-slate-950"
									>
										HINT
									</span>
								) : null}

								{/* Contextual First-Tap Onboarding badge */}
								{isOnboard && !compact ? (
									<span
										aria-hidden="true"
										className="pointer-events-none absolute -top-1 right-0.5 z-30 rounded bg-sky-400 px-1 py-0.5 text-[8px] font-black tracking-wider text-slate-950"
									>
										TAP
									</span>
								) : null}
							</button>
						);
					})}
				</div>

				{/* SVG Live Laser + Impact Flare + Photon Burst Overlay */}
				<svg
					aria-hidden="true"
					viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
					className="pointer-events-none absolute inset-0 z-10 h-full w-full"
				>
					<defs>
						<filter id={filterId} x="-25%" y="-25%" width="150%" height="150%">
							<feGaussianBlur stdDeviation="5" result="blur" />
							<feMerge>
								<feMergeNode in="blur" />
								<feMergeNode in="SourceGraphic" />
							</feMerge>
						</filter>
					</defs>

					{trace.segments.map((seg, idx) => {
						const x1 = seg.c1 * 100 + 50;
						const y1 = seg.r1 * 100 + 50;
						const x2 = seg.c2 * 100 + 50;
						const y2 = seg.r2 * 100 + 50;
						const stroke = beamColor(seg.kind);

						return (
							<g key={`${idx}-${x1}-${y1}-${x2}-${y2}`}>
								<line
									x1={x1}
									y1={y1}
									x2={x2}
									y2={y2}
									stroke={stroke}
									strokeWidth={14}
									strokeLinecap="round"
									opacity={0.3}
									filter={`url(#${filterId})`}
								/>
								<line
									x1={x1}
									y1={y1}
									x2={x2}
									y2={y2}
									stroke={stroke}
									strokeWidth={5.5}
									strokeLinecap="round"
									opacity={0.96}
								/>
								<line
									x1={x1}
									y1={y1}
									x2={x2}
									y2={y2}
									stroke="#ffffff"
									strokeWidth={2.2}
									strokeLinecap="round"
									strokeDasharray="10 14"
									className="beam-flow-anim"
									opacity={0.92}
								/>
							</g>
						);
					})}

					{/* Luminous bounce flare nodes on lit mirrors & splitters */}
					{trace.litOptics.map((k) => {
						const parts = k.split(",");
						const r = Number.parseInt(parts[0] ?? "0", 10);
						const c = Number.parseInt(parts[1] ?? "0", 10);
						const cell = cellMap.get(k);
						const cx = c * 100 + 50;
						const cy = r * 100 + 50;
						const col = cell?.kind === "splitter" ? "#fbbf24" : "#7dd3fc";
						return (
							<g key={`flare-${k}`}>
								<circle cx={cx} cy={cy} r={14} fill={col} opacity={0.28} />
								<circle cx={cx} cy={cy} r={5} fill="#ffffff" opacity={0.92} />
							</g>
						);
					})}

					{/* Crystal ignition photon shockwave rings */}
					{burstKeys.map((token) => {
						const [coord] = token.split("@");
						const parts = (coord ?? "0,0").split(",");
						const r = Number.parseInt(parts[0] ?? "0", 10);
						const c = Number.parseInt(parts[1] ?? "0", 10);
						const cx = c * 100 + 50;
						const cy = r * 100 + 50;
						return (
							<circle
								key={`burst-${token}`}
								cx={cx}
								cy={cy}
								r={34}
								fill="none"
								stroke="#6ee7b7"
								strokeWidth={5}
								className="spark-ring-anim"
							/>
						);
					})}
				</svg>
			</div>
		</div>
	);
};
