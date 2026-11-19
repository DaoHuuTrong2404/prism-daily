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

export const postMetaKey = (postId: string): string =>
	`prism:post:${postId}:meta`;

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
	await redis.set(postMetaKey(post.id), JSON.stringify(meta));
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

	const meta: PostMeta = {
		mode: "custom",
		title: cleanTitle,
		author: params.author,
		stage: params.stage,
	};
	await redis.set(postMetaKey(post.id), JSON.stringify(meta));
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
