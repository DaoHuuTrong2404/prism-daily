import { Hono } from "hono";
import { context, redis, settings } from "@devvit/web/server";
import { getUtcDateKey } from "../../shared/prismEngine";
import { createDailyPost, dailyPostedKey } from "../core/post";

export const schedulerRoutes = new Hono();

schedulerRoutes.post("/daily-post", async (c) => {
	try {
		const enabled = (await settings.get<boolean>("autoPostDaily")) ?? true;
		if (!enabled) {
			return c.json({ status: "skipped", reason: "autoPostDaily disabled" });
		}

		const dateKey = getUtcDateKey();
		const alreadyPosted = await redis.get(dailyPostedKey(dateKey));
		if (alreadyPosted) {
			return c.json({
				status: "skipped",
				reason: `Already posted ${dateKey} (${alreadyPosted})`,
			});
		}

		const post = await createDailyPost(dateKey);
		console.log(
			`[PRISM DAILY] Scheduled post created for ${dateKey} in r/${context.subredditName}: ${post.id}`,
		);
		return c.json({ status: "ok", dateKey, postId: post.id });
	} catch (error) {
		console.error("[PRISM DAILY] Scheduled daily-post failed:", error);
		return c.json(
			{
				status: "error",
				message: error instanceof Error ? error.message : "Scheduler failed",
			},
			500,
		);
	}
});
