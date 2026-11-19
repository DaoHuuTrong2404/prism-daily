import { context, reddit, redis, settings } from "@devvit/web/server";
import { Hono } from "hono";
import type {
	ApiErrorResponse,
	ArchiveDayStatus,
	CommunityPuzzleSummary,
	CompletedRunRecord,
	GameInitResponse,
	HallOfFameEntry,
	LeaderboardEntry,
	MoveDistribution,
	PlayerProfile,
	PublishPuzzleRequest,
	PublishPuzzleResponse,
	ShareCommentRequest,
	ShareCommentResponse,
	SplashResponse,
	SubmitRunRequest,
	SubmitRunResponse,
} from "../../shared/api";
import {
	generateDailyPack,
	getDayNumber,
	getUtcDateKey,
	shiftDateKey,
	validateCustomPuzzle,
	type StageResultSummary,
} from "../../shared/prismEngine";
import {
	COMMUNITY_RECENT_KEY,
	createCustomPuzzlePost,
	readPostMeta,
	type StoredCommunityPuzzle,
} from "../core/post";

export const api = new Hono();

const lbKey = (scopeId: string): string => `prism:lb:${scopeId}`;
const lbMetaKey = (scopeId: string): string => `prism:lbmeta:${scopeId}`;
const distKey = (scopeId: string): string => `prism:dist:${scopeId}`;
const runKey = (scopeId: string, username: string): string =>
	`prism:run:${scopeId}:${username}`;
const profileKey = (username: string): string => `prism:profile:${username}`;
const solvedDatesKey = (username: string): string => `prism:solved:${username}`;
const avatarCacheKey = (username: string): string => `prism:avatar:${username}`;
const pubLimitKey = (dateKey: string, username: string): string =>
	`prism:publimit:${dateKey}:${username}`;

const HOF_KEY = "prism:hof:alltime";
const HOF_META_KEY = "prism:hof:meta";
const MAX_DAILY_CUSTOM_POSTS = 5;

type StoredLbMeta = {
	totalTaps: number;
	totalPar: number;
	elapsedSec: number;
	streak: number;
	parMaster: boolean;
	snoovatarUrl?: string;
};

type StoredHofMeta = {
	parMasterCount: number;
	totalSolved: number;
	bestStreak: number;
	snoovatarUrl?: string;
};

const parseNumber = (val: string | undefined, fallback = 0): number => {
	if (!val) return fallback;
	const parsed = Number.parseInt(val, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const readBoolSetting = async (
	name: string,
	fallback: boolean,
): Promise<boolean> => {
	try {
		const value = await settings.get<boolean>(name);
		return typeof value === "boolean" ? value : fallback;
	} catch {
		return fallback;
	}
};

const computeLbScore = (totalTaps: number, elapsedSec: number): number => {
	const safeTaps = Math.max(1, Math.min(99, totalTaps));
	const safeSec = Math.max(0, Math.min(99_999, Math.floor(elapsedSec)));
	return 10_000_000 - safeTaps * 100_000 - safeSec;
};

const computeHofScore = (
	parMasterCount: number,
	totalSolved: number,
	bestStreak: number,
): number => {
	return parMasterCount * 10_000 + totalSolved * 100 + bestStreak;
};

const getCachedSnoovatar = async (
	username: string,
): Promise<string | undefined> => {
	if (!username || username === "anonymous" || username === "Redditor") {
		return undefined;
	}
	const cached = await redis.get(avatarCacheKey(username));
	if (cached !== undefined) {
		return cached || undefined;
	}
	try {
		const url = await reddit.getSnoovatarUrl(username);
		await redis.set(avatarCacheKey(username), url ?? "", {
			expiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
		});
		return url;
	} catch {
		return undefined;
	}
};

const loadProfile = async (username: string): Promise<PlayerProfile> => {
	const [hash, snoovatarUrl] = await Promise.all([
		redis.hGetAll(profileKey(username)),
		getCachedSnoovatar(username),
	]);

	const profile: PlayerProfile = {
		username,
		streak: parseNumber(hash.streak, 0),
		bestStreak: parseNumber(hash.bestStreak, 0),
		totalSolved: parseNumber(hash.totalSolved, 0),
		parMasterCount: parseNumber(hash.parMasterCount, 0),
	};
	if (snoovatarUrl) profile.snoovatarUrl = snoovatarUrl;
	if (hash.lastPlayedDate) profile.lastPlayedDate = hash.lastPlayedDate;
	return profile;
};

const loadSolvedDates = async (
	username: string,
): Promise<Record<string, ArchiveDayStatus>> => {
	const raw = await redis.hGetAll(solvedDatesKey(username));
	const map: Record<string, ArchiveDayStatus> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(k) && (v === "par" || v === "solved")) {
			map[k] = v;
		}
	}
	return map;
};

const loadDistribution = async (scopeId: string): Promise<MoveDistribution> => {
	const raw = await redis.hGetAll(distKey(scopeId));
	return {
		parOrBetter: parseNumber(raw.parOrBetter, 0),
		plus1To2: parseNumber(raw.plus1To2, 0),
		plus3To5: parseNumber(raw.plus3To5, 0),
		plus6OrMore: parseNumber(raw.plus6OrMore, 0),
	};
};

const loadLeaderboard = async (
	scopeId: string,
	limit = 15,
): Promise<{ entries: LeaderboardEntry[]; totalSolvers: number }> => {
	const [topMembers, totalSolvers] = await Promise.all([
		redis.zRange(lbKey(scopeId), 0, limit - 1, { by: "rank", reverse: true }),
		redis.zCard(lbKey(scopeId)),
	]);

	if (topMembers.length === 0) {
		return { entries: [], totalSolvers };
	}

	const usernames = topMembers.map((m) => m.member);
	const metaStrings = await redis.hMGet(lbMetaKey(scopeId), usernames);

	const entries: LeaderboardEntry[] = topMembers.map((item, idx) => {
		const rawMeta = metaStrings[idx];
		let parsed: StoredLbMeta = {
			totalTaps: 0,
			totalPar: 0,
			elapsedSec: 0,
			streak: 1,
			parMaster: false,
		};
		if (rawMeta) {
			try {
				parsed = JSON.parse(rawMeta) as StoredLbMeta;
			} catch {
				// use defaults
			}
		}
		const entry: LeaderboardEntry = {
			rank: idx + 1,
			username: item.member,
			totalTaps: parsed.totalTaps,
			totalPar: parsed.totalPar,
			elapsedSec: parsed.elapsedSec,
			streak: parsed.streak,
			parMaster: parsed.parMaster,
		};
		if (parsed.snoovatarUrl) {
			entry.snoovatarUrl = parsed.snoovatarUrl;
		}
		return entry;
	});

	return { entries, totalSolvers };
};

const loadHallOfFame = async (limit = 15): Promise<HallOfFameEntry[]> => {
	const topMembers = await redis.zRange(HOF_KEY, 0, limit - 1, {
		by: "rank",
		reverse: true,
	});
	if (topMembers.length === 0) return [];

	const usernames = topMembers.map((m) => m.member);
	const metaStrings = await redis.hMGet(HOF_META_KEY, usernames);

	return topMembers.map((item, idx) => {
		const rawMeta = metaStrings[idx];
		let parsed: StoredHofMeta = {
			parMasterCount: 0,
			totalSolved: 1,
			bestStreak: 1,
		};
		if (rawMeta) {
			try {
				parsed = JSON.parse(rawMeta) as StoredHofMeta;
			} catch {
				// defaults
			}
		}
		const entry: HallOfFameEntry = {
			rank: idx + 1,
			username: item.member,
			parMasterCount: parsed.parMasterCount,
			totalSolved: parsed.totalSolved,
			bestStreak: parsed.bestStreak,
		};
		if (parsed.snoovatarUrl) {
			entry.snoovatarUrl = parsed.snoovatarUrl;
		}
		return entry;
	});
};

const loadCommunityPuzzles = async (): Promise<CommunityPuzzleSummary[]> => {
	const raw = await redis.get(COMMUNITY_RECENT_KEY);
	if (!raw) return [];
	let stored: StoredCommunityPuzzle[] = [];
	try {
		const parsed = JSON.parse(raw) as StoredCommunityPuzzle[];
		if (Array.isArray(parsed)) stored = parsed.slice(0, 12);
	} catch {
		return [];
	}
	if (stored.length === 0) return [];

	const solverCounts = await Promise.all(
		stored.map((item) => redis.zCard(lbKey(`custom:${item.postId}`))),
	);

	return stored.map((item, idx) => ({
		...item,
		solvers: solverCounts[idx] ?? 0,
	}));
};

const loadCompletion = async (
	scopeId: string,
	username: string,
): Promise<CompletedRunRecord | undefined> => {
	const raw = await redis.get(runKey(scopeId, username));
	if (!raw) return undefined;
	try {
		return JSON.parse(raw) as CompletedRunRecord;
	} catch {
		return undefined;
	}
};

api.get("/splash", async (c) => {
	const { postId, subredditName } = context;
	if (!postId) {
		return c.json<ApiErrorResponse>(
			{ status: "error", message: "postId is required" },
			400,
		);
	}

	try {
		const [meta, usernameRaw] = await Promise.all([
			readPostMeta(postId),
			reddit.getCurrentUsername(),
		]);
		const username = usernameRaw ?? "Redditor";
		const dateKey = meta.mode === "daily" ? meta.dateKey : getUtcDateKey();
		const dayNumber = getDayNumber(dateKey);
		const scopeId =
			meta.mode === "daily" ? `daily:${dateKey}` : `custom:${postId}`;

		const [profileHash, lbPreview, existingRun] = await Promise.all([
			redis.hGetAll(profileKey(username)),
			loadLeaderboard(scopeId, 1),
			redis.get(runKey(scopeId, username)),
		]);

		const previewStage =
			meta.mode === "custom"
				? meta.stage
				: generateDailyPack(dateKey).stages[0];

		const payload: SplashResponse = {
			dateKey,
			dayNumber,
			mode: meta.mode,
			username,
			subredditName: subredditName ?? "Devvit",
			streak: parseNumber(profileHash.streak, 0),
			totalSolvers: lbPreview.totalSolvers,
			alreadySolved: Boolean(existingRun),
			previewStage,
		};

		if (lbPreview.entries[0]) {
			payload.topLeader = lbPreview.entries[0];
		}

		if (meta.mode === "custom") {
			payload.customTitle = meta.title;
			payload.customAuthor = meta.author;
			payload.customPar = meta.stage.par;
		}

		return c.json<SplashResponse>(payload);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Splash init failed";
		return c.json<ApiErrorResponse>({ status: "error", message: msg }, 500);
	}
});

api.get("/init", async (c) => {
	const { postId, subredditName } = context;
	if (!postId) {
		return c.json<ApiErrorResponse>(
			{ status: "error", message: "postId is required" },
			400,
		);
	}

	try {
		const requestedDate = c.req.query("date");
		const [meta, usernameRaw, studioEnabled] = await Promise.all([
			readPostMeta(postId),
			reddit.getCurrentUsername(),
			readBoolSetting("allowCommunityStudio", true),
		]);
		const username = usernameRaw ?? "Redditor";

		const validDateParam =
			requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
				? requestedDate
				: undefined;

		const effectiveMode: "daily" | "custom" = validDateParam
			? "daily"
			: meta.mode;

		const dateKey =
			validDateParam ??
			(meta.mode === "daily" ? meta.dateKey : getUtcDateKey());
		const dayNumber = getDayNumber(dateKey);
		const dailyPack = generateDailyPack(dateKey);

		const scopeId =
			effectiveMode === "daily" ? `daily:${dateKey}` : `custom:${postId}`;

		const [
			profile,
			todayCompletion,
			lbResult,
			hallOfFame,
			communityPuzzles,
			solvedDates,
			distribution,
		] = await Promise.all([
			loadProfile(username),
			loadCompletion(scopeId, username),
			loadLeaderboard(scopeId, 15),
			loadHallOfFame(15),
			loadCommunityPuzzles(),
			loadSolvedDates(username),
			loadDistribution(scopeId),
		]);

		const response: GameInitResponse = {
			postId,
			subredditName: subredditName ?? "Devvit",
			mode: effectiveMode,
			dateKey,
			dayNumber,
			dailyPack,
			profile,
			leaderboard: lbResult.entries,
			hallOfFame,
			communityPuzzles,
			solvedDates,
			studioEnabled,
			distribution,
			totalSolvers: lbResult.totalSolvers,
		};

		if (effectiveMode === "custom" && meta.mode === "custom") {
			response.customPuzzle = {
				title: meta.title,
				author: meta.author,
				stage: meta.stage,
			};
		}

		if (todayCompletion) {
			response.todayCompletion = todayCompletion;
		}

		return c.json<GameInitResponse>(response);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Init failed";
		return c.json<ApiErrorResponse>({ status: "error", message: msg }, 500);
	}
});

api.post("/submit-run", async (c) => {
	const { postId, subredditName } = context;
	if (!postId) {
		return c.json<ApiErrorResponse>(
			{ status: "error", message: "postId is required" },
			400,
		);
	}

	try {
		const body = await c.req.json<SubmitRunRequest>();
		const [meta, usernameRaw, awardFlairs] = await Promise.all([
			readPostMeta(postId),
			reddit.getCurrentUsername(),
			readBoolSetting("awardUserFlairs", true),
		]);
		const username = usernameRaw ?? "Redditor";
		const dateKey =
			body.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(body.dateKey)
				? body.dateKey
				: getUtcDateKey();

		const isCustom = body.mode === "custom" && meta.mode === "custom";
		const scopeId = isCustom ? `custom:${postId}` : `daily:${dateKey}`;

		// Server-authoritative Par integrity verification (prevents forged sub-Par tap scores)
		const authoritativeStages = isCustom
			? [meta.stage]
			: [...generateDailyPack(dateKey).stages];
		const authoritativeTotalPar = authoritativeStages.reduce(
			(sum, st) => sum + st.par,
			0,
		);

		const sanitizedStageResults: StageResultSummary[] = authoritativeStages.map(
			(st, idx) => {
				const reported = Array.isArray(body.stageResults)
					? body.stageResults[idx]
					: undefined;
				const taps = Math.max(
					st.par,
					Math.min(199, Math.floor(reported?.taps ?? st.par)),
				);
				const hintsUsed = Math.max(
					0,
					Math.min(30, Math.floor(reported?.hintsUsed ?? 0)),
				);
				const crystalCount = st.cells.filter(
					(cell) => cell.kind === "crystal",
				).length;
				return {
					stageNumber: st.stageNumber,
					taps,
					par: st.par,
					crystals: crystalCount,
					hintsUsed,
				};
			},
		);

		const totalPar = authoritativeTotalPar;
		const totalTaps = Math.max(
			totalPar,
			sanitizedStageResults.reduce((acc, s) => acc + s.taps, 0),
		);
		const hintsUsed = sanitizedStageResults.reduce(
			(acc, s) => acc + s.hintsUsed,
			0,
		);
		const elapsedSec = Math.max(
			1,
			Math.min(86_400, Math.floor(body.elapsedSec || 1)),
		);
		const parMaster = totalTaps <= totalPar && hintsUsed === 0;

		const existing = await loadCompletion(scopeId, username);
		const profile = await loadProfile(username);

		let nextStreak = profile.streak;
		let nextBest = profile.bestStreak;
		let nextTotalSolved = profile.totalSolved;
		let nextParMaster = profile.parMasterCount;
		let lastPlayedDate = profile.lastPlayedDate;

		if (!existing) {
			nextTotalSolved += 1;
			if (parMaster) nextParMaster += 1;

			if (!isCustom) {
				const yesterday = shiftDateKey(dateKey, -1);
				if (lastPlayedDate === yesterday) {
					nextStreak = Math.max(1, nextStreak + 1);
				} else if (lastPlayedDate === dateKey) {
					nextStreak = Math.max(1, nextStreak);
				} else {
					nextStreak = 1;
				}
				nextBest = Math.max(nextBest, nextStreak);
				lastPlayedDate = dateKey;
			}

			const profileUpdate: Record<string, string> = {
				streak: String(nextStreak),
				bestStreak: String(nextBest),
				totalSolved: String(nextTotalSolved),
				parMasterCount: String(nextParMaster),
			};
			if (lastPlayedDate) {
				profileUpdate.lastPlayedDate = lastPlayedDate;
			}

			// Update move distribution histogram
			const delta = totalTaps - totalPar;
			const bucket =
				delta <= 0
					? "parOrBetter"
					: delta <= 2
						? "plus1To2"
						: delta <= 5
							? "plus3To5"
							: "plus6OrMore";

			// Record leaderboard & all-time Hall of Fame scores (first run counts for fairness)
			const score = computeLbScore(totalTaps, elapsedSec);
			const metaEntry: StoredLbMeta = {
				totalTaps,
				totalPar,
				elapsedSec,
				streak: nextStreak,
				parMaster,
			};
			if (profile.snoovatarUrl) {
				metaEntry.snoovatarUrl = profile.snoovatarUrl;
			}

			const hofMeta: StoredHofMeta = {
				parMasterCount: nextParMaster,
				totalSolved: nextTotalSolved,
				bestStreak: nextBest,
			};
			if (profile.snoovatarUrl) {
				hofMeta.snoovatarUrl = profile.snoovatarUrl;
			}

			const writes: Promise<unknown>[] = [
				redis.hSet(profileKey(username), profileUpdate),
				redis.hIncrBy(distKey(scopeId), bucket, 1),
				redis.zAdd(lbKey(scopeId), { member: username, score }),
				redis.hSet(lbMetaKey(scopeId), {
					[username]: JSON.stringify(metaEntry),
				}),
				redis.zAdd(HOF_KEY, {
					member: username,
					score: computeHofScore(nextParMaster, nextTotalSolved, nextBest),
				}),
				redis.hSet(HOF_META_KEY, {
					[username]: JSON.stringify(hofMeta),
				}),
			];

			if (!isCustom) {
				writes.push(
					redis.hSet(solvedDatesKey(username), {
						[dateKey]: parMaster ? "par" : "solved",
					}),
				);
			}

			await Promise.all(writes);
		}

		const [lbResult, hallOfFame, solvedDates, distribution, ascRank] =
			await Promise.all([
				loadLeaderboard(scopeId, 15),
				loadHallOfFame(15),
				loadSolvedDates(username),
				loadDistribution(scopeId),
				redis.zRank(lbKey(scopeId), username),
			]);

		const totalSolvers = Math.max(1, lbResult.totalSolvers);
		// zRank is 0-indexed ascending (lowest score = 0); convert to 1-indexed descending rank
		const rank =
			ascRank !== undefined
				? Math.max(1, totalSolvers - ascRank)
				: totalSolvers;
		const percentile =
			totalSolvers <= 1
				? 99
				: Math.max(
						1,
						Math.min(
							99,
							Math.round(((totalSolvers - rank) / totalSolvers) * 100),
						),
					);

		const completion: CompletedRunRecord = existing ?? {
			dateKey,
			totalTaps,
			totalPar,
			elapsedSec,
			hintsUsed,
			stageResults: sanitizedStageResults,
			rank,
			percentile,
			completedAt: new Date().toISOString(),
			commentShared: false,
		};

		if (!existing) {
			await redis.set(runKey(scopeId, username), JSON.stringify(completion));
		}

		// Best-effort subreddit flair badge when mod setting allows
		let flairAwarded: string | undefined;
		if (
			!existing &&
			awardFlairs &&
			subredditName &&
			username !== "Redditor" &&
			username !== "anonymous"
		) {
			const flairText =
				nextStreak >= 3
					? `PRISM 🔥 ${nextStreak}d Streak`
					: parMaster
						? "PRISM 💎 Par Master"
						: undefined;
			if (flairText) {
				try {
					await reddit.setUserFlair({
						subredditName,
						username,
						text: flairText,
						backgroundColor: parMaster ? "#0284c7" : "#d97706",
						textColor: "light",
					});
					flairAwarded = flairText;
				} catch {
					// Subreddit flair permissions may be disabled — ignore gracefully
				}
			}
		}

		const updatedProfile: PlayerProfile = {
			username,
			streak: nextStreak,
			bestStreak: nextBest,
			totalSolved: nextTotalSolved,
			parMasterCount: nextParMaster,
		};
		if (profile.snoovatarUrl)
			updatedProfile.snoovatarUrl = profile.snoovatarUrl;
		if (lastPlayedDate) updatedProfile.lastPlayedDate = lastPlayedDate;

		const resp: SubmitRunResponse = {
			ok: true,
			completion,
			profile: updatedProfile,
			leaderboard: lbResult.entries,
			hallOfFame,
			solvedDates,
			distribution,
			totalSolvers: lbResult.totalSolvers,
		};
		if (flairAwarded) resp.flairAwarded = flairAwarded;

		return c.json<SubmitRunResponse>(resp);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Failed to submit run";
		return c.json<ApiErrorResponse>({ status: "error", message: msg }, 500);
	}
});

api.post("/share-comment", async (c) => {
	const { postId } = context;
	if (!postId) {
		return c.json<ApiErrorResponse>(
			{ status: "error", message: "postId is required" },
			400,
		);
	}

	try {
		const body = await c.req.json<ShareCommentRequest>();
		const username = (await reddit.getCurrentUsername()) ?? "Redditor";
		const cleanText = body.text.trim().slice(0, 600);
		if (!cleanText) {
			return c.json<ApiErrorResponse>(
				{ status: "error", message: "Share text cannot be empty" },
				400,
			);
		}

		const comment = await reddit.submitComment({
			id: postId,
			text: `**u/${username}** completed the beam:\n\n\`\`\`\n${cleanText}\n\`\`\``,
		});

		const meta = await readPostMeta(postId);
		const scopeId =
			meta.mode === "custom"
				? `custom:${postId}`
				: `daily:${body.dateKey || meta.dateKey}`;
		const existing = await loadCompletion(scopeId, username);
		if (existing) {
			await redis.set(
				runKey(scopeId, username),
				JSON.stringify({ ...existing, commentShared: true }),
			);
		}

		return c.json<ShareCommentResponse>({
			ok: true,
			commentId: comment.id,
		});
	} catch (error) {
		const msg =
			error instanceof Error ? error.message : "Failed to post comment";
		return c.json<ApiErrorResponse>({ status: "error", message: msg }, 500);
	}
});

api.post("/publish-puzzle", async (c) => {
	const { subredditName } = context;
	if (!subredditName) {
		return c.json<ApiErrorResponse>(
			{ status: "error", message: "Subreddit context missing" },
			400,
		);
	}

	try {
		const [studioEnabled, usernameRaw, body] = await Promise.all([
			readBoolSetting("allowCommunityStudio", true),
			reddit.getCurrentUsername(),
			c.req.json<PublishPuzzleRequest>(),
		]);

		if (!studioEnabled) {
			return c.json<ApiErrorResponse>(
				{
					status: "error",
					message:
						"Community Puzzle Studio is currently disabled by subreddit moderators.",
				},
				403,
			);
		}

		const username = usernameRaw ?? "Redditor";
		const todayKey = getUtcDateKey();
		const limitKey = pubLimitKey(todayKey, username);
		const publishedToday = parseNumber(await redis.get(limitKey), 0);
		if (publishedToday >= MAX_DAILY_CUSTOM_POSTS) {
			return c.json<ApiErrorResponse>(
				{
					status: "error",
					message: `Daily limit reached (${MAX_DAILY_CUSTOM_POSTS} custom puzzles per UTC day).`,
				},
				429,
			);
		}

		const check = validateCustomPuzzle(body.stage);
		if (!check.valid || check.par === undefined) {
			return c.json<ApiErrorResponse>(
				{
					status: "error",
					message: check.error ?? "Puzzle validation failed",
				},
				400,
			);
		}

		const verifiedStage = {
			...body.stage,
			id: `custom-${Date.now()}`,
			stageNumber: 1 as const,
			par: check.par,
		};

		const post = await createCustomPuzzlePost({
			title: body.title,
			author: username,
			stage: verifiedStage,
		});

		await redis.incrBy(limitKey, 1);
		await redis.expire(limitKey, 26 * 60 * 60);

		const cleanId = post.id.replace(/^t3_/, "");
		return c.json<PublishPuzzleResponse>({
			ok: true,
			postId: post.id,
			url: `https://www.reddit.com/r/${subredditName}/comments/${cleanId}/`,
		});
	} catch (error) {
		const msg =
			error instanceof Error ? error.message : "Failed to publish puzzle";
		return c.json<ApiErrorResponse>({ status: "error", message: msg }, 500);
	}
});
