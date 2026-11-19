import { Hono } from "hono";
import type { UiResponse } from "@devvit/web/shared";
import { context } from "@devvit/web/server";
import { createDailyPost } from "../core/post";
import { getUtcDateKey } from "../../shared/prismEngine";

export const menu = new Hono();

menu.post("/post-create", async (c) => {
	try {
		const post = await createDailyPost();

		const cleanId = post.id.replace(/^t3_/, "");

		return c.json<UiResponse>(
			{
				navigateTo: `https://www.reddit.com/r/${context.subredditName}/comments/${cleanId}/`,
			},
			200,
		);
	} catch (error) {
		console.error(`Error creating daily post: ${error}`);
		return c.json<UiResponse>(
			{
				showToast: "Failed to create Prism Daily post",
			},
			400,
		);
	}
});

menu.post("/date-form", async (c) => {
	return c.json<UiResponse>(
		{
			showForm: {
				name: "dateForm",
				form: {
					title: "Post Prism Daily for Specific Date",
					fields: [
						{
							name: "dateKey",
							label: "UTC Date (YYYY-MM-DD)",
							type: "string",
							defaultValue: getUtcDateKey(),
							required: true,
						},
					],
					acceptLabel: "Create Daily Post",
				},
			},
		},
		200,
	);
});
