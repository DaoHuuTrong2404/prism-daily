import { Hono } from "hono";
import { context, reddit, redis } from "@devvit/web/server";
import type {
	ApiErrorResponse,
	CompletedRunRecord,
	GameInitResponse,
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
} from "../../shared/prismEngine";
import { createCustomPuzzlePost, readPostMeta } from "../core/post";

export const api = new Hono();

const lbKey = (scopeId: string): string => `prism:lb:${scopeId}`;
const lbMetaKey = (scopeId: string): string => `prism:lbmeta:${scopeId}`;
const distKey = (scopeId: string): string => `prism:dist:${scopeId}`;
const runKey = (scopeId: string, username: string): string =>
	`prism:run:${scopeId}:${username}`;
const profileKey = (username: string): string => `prism:profile:${username}`;
const avatarCacheKey = (username: string): string => `prism:avatar:${username}`;

type StoredLbMeta = {
	totalTaps: number;
	totalPar: number;
	elapsedSec: number;
	streak: number;
	parMaster: boolean;
	snoovatarUrl?: string;
};

const parseNumber = (val: string | undefined, fallback = 0): number => {
	if (!val) return fallback;
	const parsed = Number.parseInt(val, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const computeLbScore = (totalTaps: number, elapsedSec: number): number => {
	const safeTaps = Math.max(1, Math.min(99, totalTaps));
	const safeSec = Math.max(0, Math.min(99_999, Math.floor(elapsedSec)));
	return 10_000_000 - safeTaps * 100_000 - safeSec;
};

const getCachedSnoovatar = async (
	username: string,
): Promise<string | undefined> => {
	if (!username || username === "anonymous") return undefined;
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

		const [profileHash, totalSolvers, existingRun] = await Promise.all([
			redis.hGetAll(profileKey(username)),
			redis.zCard(lbKey(scopeId)),
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
			totalSolvers,
			alreadySolved: Boolean(existingRun),
			previewStage,
		};

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
		const [meta, usernameRaw] = await Promise.all([
			readPostMeta(postId),
			reddit.getCurrentUsername(),
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

		const [profile, todayCompletion, lbResult, distribution] =
			await Promise.all([
				loadProfile(username),
				loadCompletion(scopeId, username),
				loadLeaderboard(scopeId, 15),
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
		const username = (await reddit.getCurrentUsername()) ?? "Redditor";
		const dateKey =
			body.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(body.dateKey)
				? body.dateKey
				: getUtcDateKey();

		const scopeId =
			body.mode === "custom" ? `custom:${postId}` : `daily:${dateKey}`;

		const totalTaps = Math.max(1, Math.min(999, Math.floor(body.totalTaps)));
		const totalPar = Math.max(1, Math.min(999, Math.floor(body.totalPar)));
		const elapsedSec = Math.max(
			1,
			Math.min(86400, Math.floor(body.elapsedSec)),
		);
		const hintsUsed = Math.max(0, Math.min(99, Math.floor(body.hintsUsed)));
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

			if (body.mode === "daily") {
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
			await redis.hSet(profileKey(username), profileUpdate);

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
			await redis.hIncrBy(distKey(scopeId), bucket, 1);

			// Record leaderboard score (first official run counts for fairness)
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
			await Promise.all([
				redis.zAdd(lbKey(scopeId), { member: username, score }),
				redis.hSet(lbMetaKey(scopeId), {
					[username]: JSON.stringify(metaEntry),
				}),
			]);
		}

		const [lbResult, distribution, ascRank] = await Promise.all([
			loadLeaderboard(scopeId, 15),
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
			stageResults: body.stageResults,
			rank,
			percentile,
			completedAt: new Date().toISOString(),
			commentShared: false,
		};

		if (!existing) {
			await redis.set(runKey(scopeId, username), JSON.stringify(completion));
		}

		// Best-effort subreddit flair badge for Par Masters or 3+ day streaks
		let flairAwarded: string | undefined;
		if (
			!existing &&
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
		const body = await c.req.json<PublishPuzzleRequest>();
		const username = (await reddit.getCurrentUsername()) ?? "Redditor";
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

		return c.json<PublishPuzzleResponse>({
			ok: true,
			postId: post.id,
			url: `https://www.reddit.com/r/${subredditName}/comments/${post.id}`,
		});
	} catch (error) {
		const msg =
			error instanceof Error ? error.message : "Failed to publish puzzle";
		return c.json<ApiErrorResponse>({ status: "error", message: msg }, 500);
	}
});
