import { context, reddit, redis } from "@devvit/web/server";
import type { CompletedRunRecord } from "../../shared/api";
import {
	buildShareText,
	generateDailyPack,
	getDayNumber,
	getUtcDateKey,
	validateCustomPuzzle,
	type PuzzleStage,
	type StageResultSummary,
} from "../../shared/prismEngine";
import { createCustomPuzzlePost, dailyPostedKey } from "./post";

const SEED_FLAG_KEY = "prism:seeded:v2";
const SEED_USER = "Electronic_Hat5350";

const SHOWCASE_UGC_STAGE: PuzzleStage = {
	id: "showcase-wormhole-crucible",
	stageNumber: 1,
	name: "Twin Wormhole Crucible",
	subtitle: "Split the beam and warp across twin quantum rings",
	size: 6,
	par: 2,
	cells: [
		{ r: 1, c: 0, kind: "emitter", dir: 1 },
		{ r: 1, c: 2, kind: "splitter", orientation: 0 }, // flip to 1 (\) -> splits E and S
		{ r: 1, c: 4, kind: "crystal" },
		{ r: 1, c: 5, kind: "portalA" },
		{ r: 4, c: 1, kind: "portalB" }, // exits E along row 4
		{ r: 4, c: 3, kind: "crystal" },
		{ r: 4, c: 5, kind: "mirror", orientation: 1 }, // flip to 0 (/) -> reflects N to (2,5)
		{ r: 2, c: 5, kind: "crystal" },
		{ r: 3, c: 2, kind: "crystal" },
		{ r: 0, c: 3, kind: "block" },
		{ r: 3, c: 4, kind: "block" },
	],
};

export const ensureShowcaseSeeded = async (
	fallbackPostId?: string,
): Promise<void> => {
	try {
		const already = await redis.get(SEED_FLAG_KEY);
		if (already) return;
		await redis.set(SEED_FLAG_KEY, "1");

		const dateKey = getUtcDateKey();
		const dayNumber = getDayNumber(dateKey);
		const pack = generateDailyPack(dateKey);
		const scopeId = `daily:${dateKey}`;

		let snoovatarUrl: string | undefined;
		try {
			snoovatarUrl = await reddit.getSnoovatarUrl(SEED_USER);
			if (snoovatarUrl) {
				await redis.set(`prism:avatar:${SEED_USER}`, snoovatarUrl, {
					expiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
				});
			}
		} catch {
			// ignore
		}

		const stageResults: StageResultSummary[] = pack.stages.map((st) => ({
			stageNumber: st.stageNumber,
			taps: st.par,
			par: st.par,
			crystals: st.cells.filter((c) => c.kind === "crystal").length,
			hintsUsed: 0,
		}));

		const totalPar = stageResults.reduce((acc, s) => acc + s.par, 0);
		const totalTaps = totalPar;
		const elapsedSec = 42;
		const score = 10_000_000 - totalTaps * 100_000 - elapsedSec;

		const completion: CompletedRunRecord = {
			dateKey,
			totalTaps,
			totalPar,
			elapsedSec,
			hintsUsed: 0,
			stageResults,
			rank: 1,
			percentile: 99,
			completedAt: new Date().toISOString(),
			commentShared: true,
		};

		const lbMeta = {
			totalTaps,
			totalPar,
			elapsedSec,
			streak: 1,
			parMaster: true,
			...(snoovatarUrl ? { snoovatarUrl } : {}),
		};

		const hofMeta = {
			parMasterCount: 1,
			totalSolved: 1,
			bestStreak: 1,
			...(snoovatarUrl ? { snoovatarUrl } : {}),
		};

		await Promise.all([
			redis.hSet(`prism:profile:${SEED_USER}`, {
				streak: "1",
				bestStreak: "1",
				totalSolved: "1",
				parMasterCount: "1",
				lastPlayedDate: dateKey,
			}),
			redis.hSet(`prism:solved:${SEED_USER}`, { [dateKey]: "par" }),
			redis.hIncrBy(`prism:dist:${scopeId}`, "parOrBetter", 1),
			redis.zAdd(`prism:lb:${scopeId}`, { member: SEED_USER, score }),
			redis.hSet(`prism:lbmeta:${scopeId}`, {
				[SEED_USER]: JSON.stringify(lbMeta),
			}),
			redis.zAdd("prism:hof:alltime", {
				member: SEED_USER,
				score: 10_101,
			}),
			redis.hSet("prism:hof:meta", {
				[SEED_USER]: JSON.stringify(hofMeta),
			}),
			redis.set(
				`prism:run:${scopeId}:${SEED_USER}`,
				JSON.stringify(completion),
			),
		]);

		// Post spoiler-free score comment on today's daily post
		const storedDailyId = await redis.get(dailyPostedKey(dateKey));
		const rawTargetId = storedDailyId || fallbackPostId || "t3_1y039g5";
		const targetPostId: `t3_${string}` = `t3_${rawTargetId.replace(/^t3_/, "")}`;

		const shareText = buildShareText({
			dayNumber,
			stageResults,
			totalTaps,
			totalPar,
			elapsedSec,
			streak: 1,
			percentile: 99,
		});

		try {
			await reddit.submitComment({
				id: targetPostId,
				text: `**u/${SEED_USER}** completed the beam:\n\n\`\`\`\n${shareText}\n\`\`\``,
			});
		} catch {
			// ignore if comment fails
		}

		// Best-effort flair unlock
		if (context.subredditName) {
			try {
				await reddit.setUserFlair({
					subredditName: context.subredditName,
					username: SEED_USER,
					text: "PRISM 💎 Par Master",
					backgroundColor: "#0284c7",
					textColor: "light",
				});
			} catch {
				// ignore
			}
		}

		// Publish 1 verified Community Puzzle Studio UGC post on the subreddit
		const check = validateCustomPuzzle(SHOWCASE_UGC_STAGE);
		if (check.valid && check.par !== undefined) {
			try {
				await createCustomPuzzlePost({
					title: "Twin Wormhole Crucible",
					author: SEED_USER,
					stage: { ...SHOWCASE_UGC_STAGE, par: check.par },
				});
			} catch {
				// ignore
			}
		}
	} catch (error) {
		console.error("[PRISM DAILY] Showcase seed error:", error);
	}
};
