import { context, reddit, redis } from "@devvit/web/server";
import {
	getDayNumber,
	getUtcDateKey,
	type PuzzleStage,
} from "../../shared/prismEngine";

export type PostMeta =
	| {
			mode: "daily";
			dateKey: string;
	  }
	| {
			mode: "custom";
			title: string;
			author: string;
			stage: PuzzleStage;
	  };

export type StoredCommunityPuzzle = {
	postId: string;
	url: string;
	title: string;
	author: string;
	par: number;
	size: 5 | 6;
	createdAt: string;
};

export const postMetaKey = (postId: string): string =>
	`prism:post:${postId}:meta`;

export const dailyPostedKey = (dateKey: string): string =>
	`prism:daily-posted:${dateKey}`;

export const COMMUNITY_RECENT_KEY = "prism:community:recent";

export const createDailyPost = async (requestedDate?: string) => {
	const dateKey =
		requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
			? requestedDate
			: getUtcDateKey();
	const dayNumber = getDayNumber(dateKey);
	const subredditName = context.subredditName;

	const post = await reddit.submitCustomPost({
		subredditName,
		title: `PRISM DAILY #${dayNumber} — Bend the Beam (${dateKey})`,
	});

	const meta: PostMeta = {
		mode: "daily",
		dateKey,
	};
	await Promise.all([
		redis.set(postMetaKey(post.id), JSON.stringify(meta)),
		redis.set(dailyPostedKey(dateKey), post.id),
	]);
	return post;
};

export const createCustomPuzzlePost = async (params: {
	title: string;
	author: string;
	stage: PuzzleStage;
}) => {
	const cleanTitle = params.title.trim().slice(0, 64) || "Untitled Optics";
	const subredditName = context.subredditName;

	const post = await reddit.submitCustomPost({
		subredditName,
		title: `PRISM STUDIO: "${cleanTitle}" by u/${params.author} (Par ${params.stage.par})`,
	});

	const cleanId = post.id.replace(/^t3_/, "");
	const url = `https://www.reddit.com/r/${subredditName}/comments/${cleanId}/`;
	const meta: PostMeta = {
		mode: "custom",
		title: cleanTitle,
		author: params.author,
		stage: params.stage,
	};

	// Persist post metadata and update recent community puzzle showcase index (capped to 12)
	const existingRaw = await redis.get(COMMUNITY_RECENT_KEY);
	let recent: StoredCommunityPuzzle[] = [];
	if (existingRaw) {
		try {
			const parsed = JSON.parse(existingRaw) as StoredCommunityPuzzle[];
			if (Array.isArray(parsed)) recent = parsed;
		} catch {
			recent = [];
		}
	}

	const entry: StoredCommunityPuzzle = {
		postId: post.id,
		url,
		title: cleanTitle,
		author: params.author,
		par: params.stage.par,
		size: params.stage.size,
		createdAt: new Date().toISOString(),
	};
	const nextRecent = [
		entry,
		...recent.filter((item) => item.postId !== post.id),
	].slice(0, 12);

	await Promise.all([
		redis.set(postMetaKey(post.id), JSON.stringify(meta)),
		redis.set(COMMUNITY_RECENT_KEY, JSON.stringify(nextRecent)),
	]);
	return post;
};

export const readPostMeta = async (postId: string): Promise<PostMeta> => {
	const raw = await redis.get(postMetaKey(postId));
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as PostMeta;
			if (parsed && (parsed.mode === "daily" || parsed.mode === "custom")) {
				return parsed;
			}
		} catch {
			// Fallback to today's daily
		}
	}
	return {
		mode: "daily",
		dateKey: getUtcDateKey(),
	};
};
