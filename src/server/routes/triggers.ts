import { context } from "@devvit/web/server";
import type { OnAppInstallRequest, TriggerResponse } from "@devvit/web/shared";
import { Hono } from "hono";
import { createDailyPost } from "../core/post";
import { ensureShowcaseSeeded } from "../core/seed";

export const triggers = new Hono();

triggers.post("/on-app-install", async (c) => {
	try {
		const post = await createDailyPost();
		await ensureShowcaseSeeded(post.id);
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

triggers.post("/on-app-upgrade", async (c) => {
	try {
		await ensureShowcaseSeeded("t3_1y039g5");
		return c.json<TriggerResponse>(
			{
				status: "success",
				message: `Prism Daily upgraded and showcase seeded in r/${context.subredditName}`,
			},
			200,
		);
	} catch (error) {
		console.error(`Error on app upgrade: ${error}`);
		return c.json<TriggerResponse>(
			{
				status: "error",
				message: "Upgrade hook failed",
			},
			400,
		);
	}
});
