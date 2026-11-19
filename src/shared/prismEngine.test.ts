import assert from "node:assert/strict";
import test from "node:test";
import {
	buildShareText,
	cellKey,
	findOptimalSolution,
	generateDailyPack,
	getDayNumber,
	getInitialOrientations,
	getInteractiveCells,
	reflectDirection,
	shiftDateKey,
	traceBeam,
	validateCustomPuzzle,
} from "./prismEngine.ts";
import type { MirrorOrientation, PuzzleStage } from "./prismEngine.ts";

test("reflectDirection handles all 4 directions for / and \\", () => {
	// Slash '/' (0): N->E, E->N, S->W, W->S
	assert.equal(reflectDirection(0, 0), 1);
	assert.equal(reflectDirection(1, 0), 0);
	assert.equal(reflectDirection(2, 0), 3);
	assert.equal(reflectDirection(3, 0), 2);

	// Backslash '\' (1): N->W, W->N, S->E, E->S
	assert.equal(reflectDirection(0, 1), 3);
	assert.equal(reflectDirection(3, 1), 0);
	assert.equal(reflectDirection(2, 1), 1);
	assert.equal(reflectDirection(1, 1), 2);
});

test("traceBeam splits light through prism splitter and teleports via portals without infinite loop", () => {
	const stage: PuzzleStage = {
		id: "test-portal-loop",
		stageNumber: 3,
		name: "Portal Loop Safety",
		subtitle: "test",
		size: 5,
		par: 1,
		cells: [
			{ r: 2, c: 0, kind: "emitter", dir: 1 },
			{ r: 2, c: 2, kind: "splitter", orientation: 1 }, // passes E and reflects S
			{ r: 2, c: 4, kind: "portalA" },
			{ r: 0, c: 1, kind: "portalB" }, // exits E along row 0
			{ r: 0, c: 2, kind: "mirror", orientation: 1 }, // reflects S back into splitter (2,2)
			{ r: 4, c: 2, kind: "crystal" },
			{ r: 2, c: 3, kind: "crystal" },
		],
	};

	const res = traceBeam(stage, getInitialOrientations(stage));
	assert.equal(res.solved, true);
	assert.equal(res.portalActive, true);
	assert.equal(res.litCrystals.length, 2);
	assert.ok(res.segments.length > 0 && res.segments.length < 220);
});

test("generateDailyPack produces deterministic, solvable 3-stage packs for 100 consecutive days", () => {
	const startDate = "2026-11-11";
	assert.equal(getDayNumber(startDate), 1);
	assert.equal(getDayNumber("2026-11-19"), 9);

	for (let offset = 0; offset < 100; offset += 1) {
		const dateKey = shiftDateKey(startDate, offset);
		const packA = generateDailyPack(dateKey);
		const packB = generateDailyPack(dateKey);

		assert.deepEqual(
			packA,
			packB,
			`Daily pack must be deterministic for ${dateKey}`,
		);
		assert.equal(packA.stages.length, 3);

		for (const stage of packA.stages) {
			const startOrient = getInitialOrientations(stage);
			const startTrace = traceBeam(stage, startOrient);
			assert.equal(
				startTrace.solved,
				false,
				`${dateKey} stage ${stage.stageNumber} must not start solved`,
			);

			const opt = findOptimalSolution(stage, startOrient);
			assert.equal(
				opt.solvable,
				true,
				`${dateKey} stage ${stage.stageNumber} must be solvable`,
			);
			assert.equal(
				opt.par,
				stage.par,
				`${dateKey} stage ${stage.stageNumber} stored par must match exact BFS par`,
			);
			assert.ok(
				stage.par >= 1,
				`${dateKey} stage ${stage.stageNumber} par >= 1`,
			);

			// Follow nextFlipIndex step by step — must solve in EXACTLY stage.par steps
			const current: Record<string, MirrorOrientation> = { ...startOrient };
			const interactives = getInteractiveCells(stage);
			for (let step = 0; step < stage.par; step += 1) {
				const hint = findOptimalSolution(stage, current);
				assert.notEqual(hint.nextFlipIndex, null);
				const idx = hint.nextFlipIndex ?? 0;
				const target = interactives[idx];
				assert.ok(target);
				if (!target) break;
				const k = cellKey(target.r, target.c);
				current[k] = (current[k] ?? 0) === 0 ? 1 : 0;
			}

			const endTrace = traceBeam(stage, current);
			assert.equal(
				endTrace.solved,
				true,
				`${dateKey} stage ${stage.stageNumber} must solve in exact par steps`,
			);
		}
	}
});

test("validateCustomPuzzle rejects invalid boards and validates solvable ones", () => {
	const noEmitter: PuzzleStage = {
		id: "bad-1",
		stageNumber: 1,
		name: "No Emitter",
		subtitle: "",
		size: 5,
		par: 1,
		cells: [
			{ r: 2, c: 2, kind: "mirror", orientation: 0 },
			{ r: 2, c: 4, kind: "crystal" },
		],
	};
	assert.equal(validateCustomPuzzle(noEmitter).valid, false);

	const validBoard: PuzzleStage = {
		id: "good-1",
		stageNumber: 1,
		name: "Custom Mirror",
		subtitle: "",
		size: 5,
		par: 1,
		cells: [
			{ r: 0, c: 1, kind: "emitter", dir: 2 },
			{ r: 2, c: 1, kind: "mirror", orientation: 0 }, // needs flip to 1 (\) -> East
			{ r: 2, c: 4, kind: "crystal" },
		],
	};
	const check = validateCustomPuzzle(validBoard);
	assert.equal(check.valid, true);
	assert.equal(check.par, 1);
});

test("buildShareText formats spoiler-free Reddit comment cleanly", () => {
	const txt = buildShareText({
		dayNumber: 9,
		stageResults: [
			{ stageNumber: 1, taps: 3, par: 3, crystals: 3, hintsUsed: 0 },
			{ stageNumber: 2, taps: 5, par: 4, crystals: 4, hintsUsed: 0 },
			{ stageNumber: 3, taps: 4, par: 4, crystals: 5, hintsUsed: 0 },
		],
		totalTaps: 12,
		totalPar: 11,
		elapsedSec: 74,
		streak: 4,
		percentile: 88,
	});
	assert.ok(txt.includes("PRISM DAILY #9"));
	assert.ok(txt.includes("🔥 4d streak"));
	assert.ok(txt.includes("1:14"));
});
