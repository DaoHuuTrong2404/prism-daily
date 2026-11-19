import { Hono } from "hono";
import type { OnAppInstallRequest, TriggerResponse } from "@devvit/web/shared";
import { context } from "@devvit/web/server";
import { createDailyPost } from "../core/post";

export const triggers = new Hono();

triggers.post("/on-app-install", async (c) => {
	try {
		const post = await createDailyPost();
		const input = await c.req.json<OnAppInstallRequest>();

		return c.json<TriggerResponse>(
			{
				status: "success",
				message: `Prism Daily post created in r/${context.subredditName} (${post.id}, trigger: ${input.type})`,
			},
			200,
		);
	} catch (error) {
		console.error(`Error creating post on install: ${error}`);
		return c.json<TriggerResponse>(
			{
				status: "error",
				message: "Failed to create Prism Daily post",
			},
			400,
		);
	}
});
