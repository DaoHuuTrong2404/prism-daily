import { Hono } from "hono";
import type { UiResponse } from "@devvit/web/shared";
import { context } from "@devvit/web/server";
import { createDailyPost } from "../core/post";

type DateFormValues = {
	dateKey?: string;
};

export const forms = new Hono();

forms.post("/date-submit", async (c) => {
	try {
		const { dateKey } = await c.req.json<DateFormValues>();
		const cleanDate = typeof dateKey === "string" ? dateKey.trim() : "";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
			return c.json<UiResponse>(
				{
					showToast: "Enter a valid UTC date in YYYY-MM-DD format.",
				},
				400,
			);
		}

		const post = await createDailyPost(cleanDate);
		const cleanId = post.id.replace(/^t3_/, "");
		return c.json<UiResponse>(
			{
				navigateTo: `https://www.reddit.com/r/${context.subredditName}/comments/${cleanId}/`,
			},
			200,
		);
	} catch (error) {
		console.error(`Error creating dated post: ${error}`);
		return c.json<UiResponse>(
			{
				showToast: "Failed to create dated Prism Daily post",
			},
			400,
		);
	}
});
