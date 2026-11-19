export type Direction = 0 | 1 | 2 | 3; // 0: North, 1: East, 2: South, 3: West

export type CellKind =
	| "empty"
	| "block"
	| "emitter"
	| "crystal"
	| "mirror"
	| "splitter"
	| "portalA"
	| "portalB";

export type MirrorOrientation = 0 | 1; // 0: '/' (NE-SW), 1: '\' (NW-SE)

export type PuzzleCell = {
	r: number;
	c: number;
	kind: CellKind;
	dir?: Direction;
	orientation?: MirrorOrientation;
};

export type PuzzleStage = {
	id: string;
	stageNumber: 1 | 2 | 3;
	name: string;
	subtitle: string;
	size: 5 | 6;
	par: number;
	cells: PuzzleCell[];
};

export type DailyPack = {
	dateKey: string;
	dayNumber: number;
	stages: [PuzzleStage, PuzzleStage, PuzzleStage];
};

export type BeamSegment = {
	r1: number;
	c1: number;
	r2: number;
	c2: number;
	kind: "primary" | "split" | "portal";
	depth: number;
};

export type TraceResult = {
	segments: BeamSegment[];
	litCrystals: string[];
	totalCrystals: number;
	litOptics: string[];
	portalActive: boolean;
	solved: boolean;
};

export type OptimalSolution = {
	solvable: boolean;
	par: number;
	nextFlipIndex: number | null;
	winningMask: number | null;
};

export type StageResultSummary = {
	stageNumber: 1 | 2 | 3;
	taps: number;
	par: number;
	crystals: number;
	hintsUsed: number;
};

export type CustomPuzzleValidation = {
	valid: boolean;
	error?: string;
	par?: number;
};

const DR: readonly [number, number, number, number] = [-1, 0, 1, 0];
const DC: readonly [number, number, number, number] = [0, 1, 0, -1];

// Slash '/' (0): N->E, E->N, S->W, W->S
const REFLECT_SLASH: readonly [Direction, Direction, Direction, Direction] = [
	1, 0, 3, 2,
];
// Backslash '\' (1): N->W, W->N, S->E, E->S
const REFLECT_BACKSLASH: readonly [Direction, Direction, Direction, Direction] =
	[3, 2, 1, 0];

export const cellKey = (r: number, c: number): string => `${r},${c}`;

export const reflectDirection = (
	incoming: Direction,
	orientation: MirrorOrientation,
): Direction => {
	return orientation === 0
		? REFLECT_SLASH[incoming]
		: REFLECT_BACKSLASH[incoming];
};

export const getUtcDateKey = (date: Date = new Date()): string => {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, "0");
	const d = String(date.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
};

export const shiftDateKey = (dateKey: string, deltaDays: number): string => {
	const parts = dateKey.split("-").map((n) => Number.parseInt(n, 10));
	const y = parts[0] ?? 2026;
	const m = (parts[1] ?? 11) - 1;
	const d = parts[2] ?? 19;
	const dt = new Date(Date.UTC(y, m, d + deltaDays));
	return getUtcDateKey(dt);
};

// Launch epoch: 2026-11-11 (Hackathon kickoff date -> Day #1)
const EPOCH_MS = Date.UTC(2026, 10, 11);

export const getDayNumber = (dateKey: string): number => {
	const parts = dateKey.split("-").map((n) => Number.parseInt(n, 10));
	const y = parts[0] ?? 2026;
	const m = (parts[1] ?? 11) - 1;
	const d = parts[2] ?? 19;
	const targetMs = Date.UTC(y, m, d);
	const diff = Math.floor((targetMs - EPOCH_MS) / 86_400_000) + 1;
	return Math.max(1, diff);
};

export const hashString = (input: string): number => {
	let h = 2166136261;
	for (let i = 0; i < input.length; i += 1) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

export const mulberry32 = (seed: number): (() => number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

export const getInteractiveCells = (puzzle: PuzzleStage): PuzzleCell[] => {
	return puzzle.cells
		.filter((cell) => cell.kind === "mirror" || cell.kind === "splitter")
		.sort((a, b) => (a.r !== b.r ? a.r - b.r : a.c - b.c));
};

export const getInitialOrientations = (
	puzzle: PuzzleStage,
): Record<string, MirrorOrientation> => {
	const map: Record<string, MirrorOrientation> = {};
	for (const cell of puzzle.cells) {
		if (cell.kind === "mirror" || cell.kind === "splitter") {
			map[cellKey(cell.r, cell.c)] = cell.orientation ?? 0;
		}
	}
	return map;
};

export const traceBeam = (
	puzzle: PuzzleStage,
	orientations: Record<string, MirrorOrientation>,
): TraceResult => {
	const size = puzzle.size;
	const cellMap = new Map<string, PuzzleCell>();
	let emitter: PuzzleCell | null = null;
	let portalA: PuzzleCell | null = null;
	let portalB: PuzzleCell | null = null;
	let totalCrystals = 0;

	for (const cell of puzzle.cells) {
		cellMap.set(cellKey(cell.r, cell.c), cell);
		if (cell.kind === "emitter") emitter = cell;
		if (cell.kind === "crystal") totalCrystals += 1;
		if (cell.kind === "portalA") portalA = cell;
		if (cell.kind === "portalB") portalB = cell;
	}

	const segments: BeamSegment[] = [];
	const litCrystalsSet = new Set<string>();
	const litOpticsSet = new Set<string>();
	let portalActive = false;

	if (!emitter) {
		return {
			segments,
			litCrystals: [],
			totalCrystals,
			litOptics: [],
			portalActive: false,
			solved: false,
		};
	}

	type Ray = {
		r: number;
		c: number;
		dir: Direction;
		kind: "primary" | "split" | "portal";
		depth: number;
	};

	const startDir: Direction = emitter.dir ?? 1;
	const queue: Ray[] = [
		{
			r: emitter.r,
			c: emitter.c,
			dir: startDir,
			kind: "primary",
			depth: 0,
		},
	];

	const visitedRays = new Set<string>();
	const MAX_STEPS = 220;
	let steps = 0;

	while (queue.length > 0 && steps < MAX_STEPS) {
		const ray = queue.shift();
		if (!ray) break;

		const stateId = `${ray.r},${ray.c},${ray.dir}`;
		if (visitedRays.has(stateId)) continue;
		visitedRays.add(stateId);
		steps += 1;

		const nr = ray.r + DR[ray.dir];
		const nc = ray.c + DC[ray.dir];

		if (nr < 0 || nr >= size || nc < 0 || nc >= size) {
			segments.push({
				r1: ray.r,
				c1: ray.c,
				r2: ray.r + DR[ray.dir] * 0.5,
				c2: ray.c + DC[ray.dir] * 0.5,
				kind: ray.kind,
				depth: ray.depth,
			});
			continue;
		}

		const nextKey = cellKey(nr, nc);
		const nextCell = cellMap.get(nextKey);

		if (nextCell && nextCell.kind === "block") {
			segments.push({
				r1: ray.r,
				c1: ray.c,
				r2: ray.r + DR[ray.dir] * 0.5,
				c2: ray.c + DC[ray.dir] * 0.5,
				kind: ray.kind,
				depth: ray.depth,
			});
			continue;
		}

		segments.push({
			r1: ray.r,
			c1: ray.c,
			r2: nr,
			c2: nc,
			kind: ray.kind,
			depth: ray.depth,
		});

		if (!nextCell || nextCell.kind === "empty") {
			queue.push({
				r: nr,
				c: nc,
				dir: ray.dir,
				kind: ray.kind,
				depth: ray.depth + 1,
			});
			continue;
		}

		if (nextCell.kind === "emitter") {
			continue;
		}

		if (nextCell.kind === "crystal") {
			litCrystalsSet.add(nextKey);
			queue.push({
				r: nr,
				c: nc,
				dir: ray.dir,
				kind: ray.kind,
				depth: ray.depth + 1,
			});
			continue;
		}

		if (nextCell.kind === "mirror") {
			litOpticsSet.add(nextKey);
			const orient: MirrorOrientation =
				orientations[nextKey] ?? nextCell.orientation ?? 0;
			const outDir = reflectDirection(ray.dir, orient);
			queue.push({
				r: nr,
				c: nc,
				dir: outDir,
				kind: ray.kind,
				depth: ray.depth + 1,
			});
			continue;
		}

		if (nextCell.kind === "splitter") {
			litOpticsSet.add(nextKey);
			const orient: MirrorOrientation =
				orientations[nextKey] ?? nextCell.orientation ?? 0;
			const reflectedDir = reflectDirection(ray.dir, orient);
			queue.push({
				r: nr,
				c: nc,
				dir: ray.dir,
				kind: ray.kind,
				depth: ray.depth + 1,
			});
			queue.push({
				r: nr,
				c: nc,
				dir: reflectedDir,
				kind: "split",
				depth: ray.depth + 1,
			});
			continue;
		}

		if (nextCell.kind === "portalA" && portalB) {
			portalActive = true;
			queue.push({
				r: portalB.r,
				c: portalB.c,
				dir: ray.dir,
				kind: "portal",
				depth: ray.depth + 1,
			});
			continue;
		}

		if (nextCell.kind === "portalB" && portalA) {
			portalActive = true;
			queue.push({
				r: portalA.r,
				c: portalA.c,
				dir: ray.dir,
				kind: "portal",
				depth: ray.depth + 1,
			});
			continue;
		}
	}

	const litCrystals = Array.from(litCrystalsSet);
	const litOptics = Array.from(litOpticsSet);

	return {
		segments,
		litCrystals,
		totalCrystals,
		litOptics,
		portalActive,
		solved: totalCrystals > 0 && litCrystals.length === totalCrystals,
	};
};

const popcount = (x: number): number => {
	let n = x;
	let count = 0;
	while (n !== 0) {
		n &= n - 1;
		count += 1;
	}
	return count;
};

export const findOptimalSolution = (
	puzzle: PuzzleStage,
	currentOrientations: Record<string, MirrorOrientation>,
): OptimalSolution => {
	const interactives = getInteractiveCells(puzzle);
	const count = interactives.length;

	if (count === 0) {
		const res = traceBeam(puzzle, currentOrientations);
		return {
			solvable: res.solved,
			par: 0,
			nextFlipIndex: null,
			winningMask: res.solved ? 0 : null,
		};
	}

	if (count > 12) {
		const res = traceBeam(puzzle, currentOrientations);
		return {
			solvable: res.solved,
			par: res.solved ? 0 : 99,
			nextFlipIndex: null,
			winningMask: null,
		};
	}

	const keys = interactives.map((cell) => cellKey(cell.r, cell.c));
	const baseOrientations: MirrorOrientation[] = interactives.map(
		(cell, idx) =>
			currentOrientations[keys[idx] ?? ""] ?? cell.orientation ?? 0,
	);

	let bestDistance = Number.POSITIVE_INFINITY;
	let bestMask: number | null = null;
	const totalStates = 1 << count;

	const testOrientations: Record<string, MirrorOrientation> = {};

	for (let flipMask = 0; flipMask < totalStates; flipMask += 1) {
		const dist = popcount(flipMask);
		if (dist >= bestDistance) continue;

		for (let i = 0; i < count; i += 1) {
			const key = keys[i];
			const base = baseOrientations[i] ?? 0;
			if (key !== undefined) {
				const flipped = (flipMask & (1 << i)) !== 0;
				testOrientations[key] = flipped ? (base === 0 ? 1 : 0) : base;
			}
		}

		const res = traceBeam(puzzle, testOrientations);
		if (res.solved) {
			bestDistance = dist;
			bestMask = flipMask;
			if (bestDistance === 0) break;
		}
	}

	if (bestMask === null) {
		return { solvable: false, par: -1, nextFlipIndex: null, winningMask: null };
	}

	let nextFlipIndex: number | null = null;
	if (bestMask > 0) {
		for (let i = 0; i < count; i += 1) {
			if ((bestMask & (1 << i)) !== 0) {
				nextFlipIndex = i;
				break;
			}
		}
	}

	return {
		solvable: true,
		par: bestDistance,
		nextFlipIndex,
		winningMask: bestMask,
	};
};

type StageGenSpec = {
	stageNumber: 1 | 2 | 3;
	name: string;
	subtitle: string;
	size: 5 | 6;
	targetMirrors: number;
	targetSplitters: number;
	usePortals: boolean;
	targetCrystals: number;
	targetBlocks: number;
	minPar: number;
	maxPar: number;
};

const STAGE_SPECS: readonly [StageGenSpec, StageGenSpec, StageGenSpec] = [
	{
		stageNumber: 1,
		name: "First Light",
		subtitle: "Tap mirrors to bounce the beam through every crystal",
		size: 5,
		targetMirrors: 5,
		targetSplitters: 0,
		usePortals: false,
		targetCrystals: 3,
		targetBlocks: 3,
		minPar: 3,
		maxPar: 4,
	},
	{
		stageNumber: 2,
		name: "Split Beam",
		subtitle: "Diamond prisms pass light straight AND reflect at 90°",
		size: 6,
		targetMirrors: 5,
		targetSplitters: 2,
		usePortals: false,
		targetCrystals: 4,
		targetBlocks: 4,
		minPar: 4,
		maxPar: 5,
	},
	{
		stageNumber: 3,
		name: "Quantum Relay",
		subtitle: "Combine splitters and twin wormhole portals",
		size: 6,
		targetMirrors: 6,
		targetSplitters: 2,
		usePortals: true,
		targetCrystals: 5,
		targetBlocks: 4,
		minPar: 4,
		maxPar: 6,
	},
];

const randInt = (
	rng: () => number,
	min: number,
	maxInclusive: number,
): number => {
	return min + Math.floor(rng() * (maxInclusive - min + 1));
};

const shuffleInPlace = <T>(arr: T[], rng: () => number): T[] => {
	for (let i = arr.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = arr[i];
		const swap = arr[j];
		if (tmp !== undefined && swap !== undefined) {
			arr[i] = swap;
			arr[j] = tmp;
		}
	}
	return arr;
};

const pickBorderEmitter = (
	size: 5 | 6,
	rng: () => number,
): { r: number; c: number; dir: Direction } => {
	const edge = randInt(rng, 0, 3);
	const pos = randInt(rng, 1, size - 2);
	if (edge === 0) return { r: 0, c: pos, dir: 2 };
	if (edge === 1) return { r: pos, c: size - 1, dir: 3 };
	if (edge === 2) return { r: size - 1, c: pos, dir: 0 };
	return { r: pos, c: 0, dir: 1 };
};

const tryGenerateStage = (
	dateKey: string,
	spec: StageGenSpec,
	rng: () => number,
): PuzzleStage | null => {
	const size = spec.size;
	const occupied = new Set<string>();
	const cells: PuzzleCell[] = [];

	const emitterInfo = pickBorderEmitter(size, rng);
	const emitterCell: PuzzleCell = {
		r: emitterInfo.r,
		c: emitterInfo.c,
		kind: "emitter",
		dir: emitterInfo.dir,
	};
	cells.push(emitterCell);
	occupied.add(cellKey(emitterCell.r, emitterCell.c));

	type Walker = { r: number; c: number; dir: Direction; turnsLeft: number };
	const walkers: Walker[] = [
		{
			r: emitterCell.r,
			c: emitterCell.c,
			dir: emitterInfo.dir,
			turnsLeft: spec.targetMirrors + spec.targetSplitters,
		},
	];

	let mirrorsPlaced = 0;
	let splittersPlaced = 0;
	let portalsPlaced = false;
	let walkDepth = 0;

	while (walkers.length > 0 && walkDepth < 40) {
		const walker = walkers.shift();
		if (!walker) break;
		walkDepth += 1;

		const rayCells: Array<{ r: number; c: number }> = [];
		let cr = walker.r + DR[walker.dir];
		let cc = walker.c + DC[walker.dir];
		while (cr >= 0 && cr < size && cc >= 0 && cc < size) {
			const k = cellKey(cr, cc);
			if (occupied.has(k)) break;
			rayCells.push({ r: cr, c: cc });
			cr += DR[walker.dir];
			cc += DC[walker.dir];
		}

		if (rayCells.length === 0) continue;

		const canPlaceSplitter =
			splittersPlaced < spec.targetSplitters && rayCells.length >= 2;
		const canPlaceMirror =
			mirrorsPlaced < spec.targetMirrors && rayCells.length >= 1;
		const canPlacePortal =
			spec.usePortals &&
			!portalsPlaced &&
			rayCells.length >= 2 &&
			walkDepth >= 2;

		if (
			walker.turnsLeft > 0 &&
			(canPlaceSplitter || canPlaceMirror || canPlacePortal)
		) {
			const pickIdx =
				rayCells.length === 1
					? 0
					: randInt(
							rng,
							0,
							Math.min(rayCells.length - 1, Math.max(1, rayCells.length - 1)),
						);
			const spot = rayCells[pickIdx];
			if (!spot) continue;

			if (canPlacePortal && rng() < 0.45) {
				const candidatesB: Array<{ r: number; c: number }> = [];
				for (let rr = 0; rr < size; rr += 1) {
					for (let cc2 = 0; cc2 < size; cc2 += 1) {
						const k2 = cellKey(rr, cc2);
						if (occupied.has(k2) || (rr === spot.r && cc2 === spot.c)) continue;
						const nextR = rr + DR[walker.dir];
						const nextC = cc2 + DC[walker.dir];
						if (
							nextR >= 0 &&
							nextR < size &&
							nextC >= 0 &&
							nextC < size &&
							!occupied.has(cellKey(nextR, nextC))
						) {
							candidatesB.push({ r: rr, c: cc2 });
						}
					}
				}

				if (candidatesB.length > 0) {
					const dest = candidatesB[randInt(rng, 0, candidatesB.length - 1)];
					if (dest) {
						cells.push({ r: spot.r, c: spot.c, kind: "portalA" });
						cells.push({ r: dest.r, c: dest.c, kind: "portalB" });
						occupied.add(cellKey(spot.r, spot.c));
						occupied.add(cellKey(dest.r, dest.c));
						portalsPlaced = true;
						walkers.push({
							r: dest.r,
							c: dest.c,
							dir: walker.dir,
							turnsLeft: walker.turnsLeft,
						});
						continue;
					}
				}
			}

			const orient: MirrorOrientation = rng() < 0.5 ? 0 : 1;
			const outDir = reflectDirection(walker.dir, orient);
			const isSplitter = canPlaceSplitter && (!canPlaceMirror || rng() < 0.45);

			cells.push({
				r: spot.r,
				c: spot.c,
				kind: isSplitter ? "splitter" : "mirror",
				orientation: orient,
			});
			occupied.add(cellKey(spot.r, spot.c));

			if (isSplitter) {
				splittersPlaced += 1;
				walkers.push({
					r: spot.r,
					c: spot.c,
					dir: walker.dir,
					turnsLeft: Math.max(0, Math.floor((walker.turnsLeft - 1) / 2)),
				});
				walkers.push({
					r: spot.r,
					c: spot.c,
					dir: outDir,
					turnsLeft: Math.max(0, Math.ceil((walker.turnsLeft - 1) / 2)),
				});
			} else {
				mirrorsPlaced += 1;
				walkers.push({
					r: spot.r,
					c: spot.c,
					dir: outDir,
					turnsLeft: walker.turnsLeft - 1,
				});
			}
		}
	}

	if (spec.targetSplitters > 0 && splittersPlaced === 0) return null;
	if (spec.usePortals && !portalsPlaced) return null;
	if (mirrorsPlaced + splittersPlaced < spec.minPar + 1) return null;

	const baseStage: PuzzleStage = {
		id: `${dateKey}-s${spec.stageNumber}`,
		stageNumber: spec.stageNumber,
		name: spec.name,
		subtitle: spec.subtitle,
		size,
		par: spec.minPar,
		cells: [...cells],
	};

	const solutionOrientations = getInitialOrientations(baseStage);
	const solutionTrace = traceBeam(baseStage, solutionOrientations);

	const depthMap = new Map<string, number>();
	for (const seg of solutionTrace.segments) {
		const r = Math.round(seg.r2);
		const c = Math.round(seg.c2);
		if (
			r >= 0 &&
			r < size &&
			c >= 0 &&
			c < size &&
			seg.r2 === r &&
			seg.c2 === c
		) {
			const k = cellKey(r, c);
			if (!occupied.has(k)) {
				const prev = depthMap.get(k) ?? -1;
				if (seg.depth > prev) depthMap.set(k, seg.depth);
			}
		}
	}

	const crystalCandidates = Array.from(depthMap.entries())
		.map(([key, depth]) => {
			const parts = key.split(",").map((n) => Number.parseInt(n, 10));
			return { r: parts[0] ?? 0, c: parts[1] ?? 0, depth };
		})
		.sort((a, b) => b.depth - a.depth);

	if (crystalCandidates.length < spec.targetCrystals) return null;

	const topPool = crystalCandidates.slice(
		0,
		Math.min(crystalCandidates.length, spec.targetCrystals + 4),
	);
	shuffleInPlace(topPool, rng);
	topPool.sort((a, b) => b.depth - a.depth);

	for (let i = 0; i < spec.targetCrystals; i += 1) {
		const spot = topPool[i];
		if (!spot) continue;
		cells.push({ r: spot.r, c: spot.c, kind: "crystal" });
		occupied.add(cellKey(spot.r, spot.c));
	}

	const emptyUnlit: Array<{ r: number; c: number }> = [];
	for (let r = 0; r < size; r += 1) {
		for (let c = 0; c < size; c += 1) {
			const k = cellKey(r, c);
			if (!occupied.has(k) && !depthMap.has(k)) {
				emptyUnlit.push({ r, c });
			}
		}
	}
	shuffleInPlace(emptyUnlit, rng);
	for (let i = 0; i < Math.min(spec.targetBlocks, emptyUnlit.length); i += 1) {
		const b = emptyUnlit[i];
		if (!b) continue;
		cells.push({ r: b.r, c: b.c, kind: "block" });
		occupied.add(cellKey(b.r, b.c));
	}

	const currentInteractives = cells.filter(
		(c) => c.kind === "mirror" || c.kind === "splitter",
	).length;
	if (currentInteractives < 8 && emptyUnlit.length > spec.targetBlocks) {
		const decoy = emptyUnlit[spec.targetBlocks];
		if (decoy) {
			cells.push({
				r: decoy.r,
				c: decoy.c,
				kind: "mirror",
				orientation: rng() < 0.5 ? 0 : 1,
			});
			occupied.add(cellKey(decoy.r, decoy.c));
		}
	}

	const candidateStage: PuzzleStage = {
		id: `${dateKey}-s${spec.stageNumber}`,
		stageNumber: spec.stageNumber,
		name: spec.name,
		subtitle: spec.subtitle,
		size,
		par: spec.minPar,
		cells,
	};
	const verifySolved = traceBeam(
		candidateStage,
		getInitialOrientations(candidateStage),
	);
	if (!verifySolved.solved) return null;
	if (spec.usePortals && !verifySolved.portalActive) return null;

	const interactiveCells = getInteractiveCells(candidateStage);
	const n = interactiveCells.length;
	if (n > 10) return null;

	const baseSolOrient = getInitialOrientations(candidateStage);

	for (let attempt = 0; attempt < 18; attempt += 1) {
		const flipCount = randInt(rng, spec.minPar, Math.min(n, spec.maxPar + 1));
		const indices = Array.from({ length: n }, (_, i) => i);
		shuffleInPlace(indices, rng);

		const scrambledOrient: Record<string, MirrorOrientation> = {
			...baseSolOrient,
		};
		for (let i = 0; i < flipCount; i += 1) {
			const idx = indices[i];
			const cell = idx !== undefined ? interactiveCells[idx] : undefined;
			if (!cell) continue;
			const k = cellKey(cell.r, cell.c);
			scrambledOrient[k] = (scrambledOrient[k] ?? 0) === 0 ? 1 : 0;
		}

		const startTrace = traceBeam(candidateStage, scrambledOrient);
		if (startTrace.solved) continue;
		if (startTrace.litCrystals.length > Math.floor(spec.targetCrystals / 2))
			continue;

		const opt = findOptimalSolution(candidateStage, scrambledOrient);
		if (opt.solvable && opt.par >= spec.minPar && opt.par <= spec.maxPar) {
			const finalCells: PuzzleCell[] = candidateStage.cells.map((cell) => {
				if (cell.kind === "mirror" || cell.kind === "splitter") {
					const k = cellKey(cell.r, cell.c);
					return { ...cell, orientation: scrambledOrient[k] ?? 0 };
				}
				return cell;
			});

			return {
				...candidateStage,
				par: opt.par,
				cells: finalCells,
			};
		}
	}

	return null;
};

const buildFallbackStage = (
	dateKey: string,
	stageNumber: 1 | 2 | 3,
): PuzzleStage => {
	if (stageNumber === 1) {
		const stage: PuzzleStage = {
			id: `${dateKey}-s1`,
			stageNumber: 1,
			name: "First Light",
			subtitle: "Tap mirrors to bounce the beam through every crystal",
			size: 5,
			par: 3,
			cells: [
				{ r: 0, c: 1, kind: "emitter", dir: 2 },
				{ r: 3, c: 1, kind: "mirror", orientation: 0 },
				{ r: 3, c: 4, kind: "mirror", orientation: 1 },
				{ r: 1, c: 4, kind: "mirror", orientation: 0 },
				{ r: 2, c: 1, kind: "crystal" },
				{ r: 3, c: 3, kind: "crystal" },
				{ r: 1, c: 2, kind: "crystal" },
				{ r: 2, c: 3, kind: "block" },
				{ r: 4, c: 0, kind: "block" },
			],
		};
		const opt = findOptimalSolution(stage, getInitialOrientations(stage));
		return { ...stage, par: Math.max(1, opt.par) };
	}

	if (stageNumber === 2) {
		const stage: PuzzleStage = {
			id: `${dateKey}-s2`,
			stageNumber: 2,
			name: "Split Beam",
			subtitle: "Diamond prisms pass light straight AND reflect at 90°",
			size: 6,
			par: 4,
			cells: [
				{ r: 1, c: 0, kind: "emitter", dir: 1 },
				{ r: 1, c: 2, kind: "splitter", orientation: 0 },
				{ r: 1, c: 5, kind: "mirror", orientation: 0 },
				{ r: 4, c: 2, kind: "mirror", orientation: 0 },
				{ r: 4, c: 4, kind: "mirror", orientation: 1 },
				{ r: 1, c: 4, kind: "crystal" },
				{ r: 3, c: 5, kind: "crystal" },
				{ r: 4, c: 3, kind: "crystal" },
				{ r: 2, c: 4, kind: "crystal" },
				{ r: 0, c: 4, kind: "block" },
				{ r: 3, c: 1, kind: "block" },
				{ r: 5, c: 5, kind: "block" },
			],
		};
		const opt = findOptimalSolution(stage, getInitialOrientations(stage));
		return { ...stage, par: Math.max(1, opt.par) };
	}

	const stage: PuzzleStage = {
		id: `${dateKey}-s3`,
		stageNumber: 3,
		name: "Quantum Relay",
		subtitle: "Combine splitters and twin wormhole portals",
		size: 6,
		par: 4,
		cells: [
			{ r: 0, c: 2, kind: "emitter", dir: 2 },
			{ r: 2, c: 2, kind: "splitter", orientation: 0 },
			{ r: 2, c: 4, kind: "portalA" },
			{ r: 5, c: 1, kind: "portalB" },
			{ r: 5, c: 4, kind: "mirror", orientation: 1 },
			{ r: 4, c: 2, kind: "mirror", orientation: 1 },
			{ r: 4, c: 0, kind: "mirror", orientation: 0 },
			{ r: 2, c: 3, kind: "crystal" },
			{ r: 5, c: 3, kind: "crystal" },
			{ r: 3, c: 4, kind: "crystal" },
			{ r: 4, c: 1, kind: "crystal" },
			{ r: 1, c: 0, kind: "crystal" },
			{ r: 0, c: 4, kind: "block" },
			{ r: 1, c: 5, kind: "block" },
			{ r: 3, c: 1, kind: "block" },
		],
	};
	const opt = findOptimalSolution(stage, getInitialOrientations(stage));
	return { ...stage, par: Math.max(1, opt.par) };
};

export const generateDailyPack = (dateKey: string): DailyPack => {
	const dayNumber = getDayNumber(dateKey);

	const stages = STAGE_SPECS.map((spec) => {
		const rng = mulberry32(
			hashString(`prism-daily-v1:${dateKey}:stage:${spec.stageNumber}`),
		);
		for (let tries = 0; tries < 90; tries += 1) {
			const candidate = tryGenerateStage(dateKey, spec, rng);
			if (candidate) return candidate;
		}
		return buildFallbackStage(dateKey, spec.stageNumber);
	});

	const s1 = stages[0] ?? buildFallbackStage(dateKey, 1);
	const s2 = stages[1] ?? buildFallbackStage(dateKey, 2);
	const s3 = stages[2] ?? buildFallbackStage(dateKey, 3);

	return {
		dateKey,
		dayNumber,
		stages: [s1, s2, s3],
	};
};

export const validateCustomPuzzle = (
	puzzle: PuzzleStage,
): CustomPuzzleValidation => {
	if (puzzle.size !== 5 && puzzle.size !== 6) {
		return { valid: false, error: "Grid must be 5×5 or 6×6." };
	}

	let emitters = 0;
	let crystals = 0;
	let interactives = 0;
	let portalAs = 0;
	let portalBs = 0;
	const seen = new Set<string>();

	for (const cell of puzzle.cells) {
		if (
			cell.r < 0 ||
			cell.r >= puzzle.size ||
			cell.c < 0 ||
			cell.c >= puzzle.size
		) {
			return { valid: false, error: "Cell coordinate out of bounds." };
		}
		const k = cellKey(cell.r, cell.c);
		if (seen.has(k)) {
			return { valid: false, error: "Duplicate cell at the same coordinate." };
		}
		seen.add(k);

		if (cell.kind === "emitter") emitters += 1;
		if (cell.kind === "crystal") crystals += 1;
		if (cell.kind === "mirror" || cell.kind === "splitter") interactives += 1;
		if (cell.kind === "portalA") portalAs += 1;
		if (cell.kind === "portalB") portalBs += 1;
	}

	if (emitters !== 1) {
		return { valid: false, error: "Place exactly 1 Sun Emitter." };
	}
	if (crystals < 1 || crystals > 8) {
		return { valid: false, error: "Place between 1 and 8 Crystals." };
	}
	if (interactives < 1 || interactives > 10) {
		return {
			valid: false,
			error: "Place between 1 and 10 Mirrors or Splitters.",
		};
	}
	if ((portalAs > 0 || portalBs > 0) && (portalAs !== 1 || portalBs !== 1)) {
		return {
			valid: false,
			error: "Portals must be placed as a complete A + B pair.",
		};
	}

	const initialOrientations = getInitialOrientations(puzzle);
	const initialTrace = traceBeam(puzzle, initialOrientations);
	if (initialTrace.solved) {
		return {
			valid: false,
			error:
				"Puzzle is already solved! Tap at least one mirror to scramble it first.",
		};
	}

	const opt = findOptimalSolution(puzzle, initialOrientations);
	if (!opt.solvable || opt.par < 1) {
		return {
			valid: false,
			error: "No valid mirror combination lights all crystals.",
		};
	}

	return { valid: true, par: opt.par };
};

export const formatDuration = (totalSeconds: number): string => {
	const safe = Math.max(0, Math.floor(totalSeconds));
	const mins = Math.floor(safe / 60);
	const secs = safe % 60;
	return `${mins}:${String(secs).padStart(2, "0")}`;
};

export const buildShareText = (params: {
	dayNumber: number;
	stageResults: StageResultSummary[];
	totalTaps: number;
	totalPar: number;
	elapsedSec: number;
	streak: number;
	percentile: number;
	customTitle?: string;
}): string => {
	const {
		dayNumber,
		stageResults,
		totalTaps,
		totalPar,
		elapsedSec,
		streak,
		percentile,
		customTitle,
	} = params;

	const header = customTitle
		? `PRISM STUDIO • "${customTitle}"`
		: `PRISM DAILY #${dayNumber}`;

	const lines = stageResults.map((s) => {
		const isPar = s.taps <= s.par && s.hintsUsed === 0;
		const gems = (isPar ? "💎" : "🔷").repeat(
			Math.min(6, Math.max(1, s.crystals)),
		);
		const badge = isPar ? "PAR" : `+${Math.max(0, s.taps - s.par)}`;
		return `Stage ${s.stageNumber}: ${gems} (${s.taps}/${s.par} • ${badge})`;
	});

	const delta = totalTaps - totalPar;
	const rankTag = delta <= 0 ? "★ PAR MASTER" : `+${delta} over par`;
	const streakPart = streak > 0 ? ` • 🔥 ${streak}d streak` : "";
	const pctPart =
		percentile > 0 ? ` • Top ${Math.max(1, 100 - percentile)}%` : "";

	return [
		`${header} ✨`,
		...lines,
		`Total: ${totalTaps} taps (${rankTag}) • ⏱ ${formatDuration(elapsedSec)}${streakPart}${pctPart}`,
	].join("\n");
};
