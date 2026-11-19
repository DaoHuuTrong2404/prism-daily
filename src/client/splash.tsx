import "./index.css";

import { context, requestExpandedMode } from "@devvit/web/client";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SplashResponse } from "../shared/api";
import {
	cellKey,
	findOptimalSolution,
	formatDuration,
	generateDailyPack,
	getDayNumber,
	getInitialOrientations,
	getInteractiveCells,
	getUtcDateKey,
	traceBeam,
	type MirrorOrientation,
} from "../shared/prismEngine";
import { PrismBoard } from "./components/PrismBoard";
import { getNextUtcCountdown } from "./lib/countdown";

export const Splash = () => {
	const fallbackDate = useMemo(() => getUtcDateKey(), []);
	const fallbackStage = useMemo(
		() => generateDailyPack(fallbackDate).stages[0],
		[fallbackDate],
	);

	const [data, setData] = useState<SplashResponse>(() => {
		let initialUser = "Redditor";
		let initialSub = "Devvit";
		try {
			if (context?.username) initialUser = context.username;
			if (context?.subredditName) initialSub = context.subredditName;
		} catch {
			// Safe fallback when previewed outside Reddit host iframe
		}
		return {
			dateKey: fallbackDate,
			dayNumber: getDayNumber(fallbackDate),
			mode: "daily",
			username: initialUser,
			subredditName: initialSub,
			streak: 0,
			totalSolvers: 0,
			alreadySolved: false,
			previewStage: fallbackStage,
		};
	});

	const [previewFlipStep, setPreviewFlipStep] = useState(0);
	const [countdown, setCountdown] = useState(() => getNextUtcCountdown());

	useEffect(() => {
		let alive = true;
		const load = async () => {
			try {
				const res = await fetch("/api/splash");
				if (!res.ok) return;
				const json = (await res.json()) as SplashResponse;
				if (alive && json.previewStage) {
					setData(json);
				}
			} catch {
				// Keep instant deterministic fallback
			}
		};
		void load();
		return () => {
			alive = false;
		};
	}, []);

	// Live countdown to next UTC puzzle
	useEffect(() => {
		const id = window.setInterval(() => {
			setCountdown(getNextUtcCountdown());
		}, 1000);
		return () => window.clearInterval(id);
	}, []);

	// Gentle live laser pulse preview (toggles 1 mirror without spoiling Stage 1)
	useEffect(() => {
		if (
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			return;
		}
		const id = window.setInterval(() => {
			setPreviewFlipStep((prev) => (prev === 0 ? 1 : 0));
		}, 1700);
		return () => window.clearInterval(id);
	}, []);

	const animatedOrientations = useMemo(() => {
		const stage = data.previewStage;
		const base: Record<string, MirrorOrientation> =
			getInitialOrientations(stage);
		const interactives = getInteractiveCells(stage);
		const opt = findOptimalSolution(stage, base);
		const mask = opt.winningMask ?? 0;

		let flipped = 0;
		for (
			let i = 0;
			i < interactives.length && flipped < previewFlipStep;
			i += 1
		) {
			if ((mask & (1 << i)) !== 0) {
				const cell = interactives[i];
				if (cell) {
					const k = cellKey(cell.r, cell.c);
					base[k] = (base[k] ?? 0) === 0 ? 1 : 0;
					flipped += 1;
				}
			}
		}
		return base;
	}, [data.previewStage, previewFlipStep]);

	const previewTrace = useMemo(
		() => traceBeam(data.previewStage, animatedOrientations),
		[data.previewStage, animatedOrientations],
	);

	const isCustom = data.mode === "custom";

	return (
		<main className="optical-bench-bg flex min-h-full w-full flex-col items-center justify-center px-4 py-3 text-slate-100">
			<div className="flex w-full max-w-[420px] flex-col items-center gap-2.5">
				{/* Top status pills */}
				<div className="flex flex-wrap items-center justify-center gap-1.5">
					<span className="rounded-full border border-sky-400/35 bg-sky-500/15 px-2.5 py-0.5 text-[10px] font-extrabold tracking-widest text-sky-300 uppercase">
						{isCustom ? "COMMUNITY STUDIO" : `PRISM DAILY #${data.dayNumber}`}
					</span>
					{data.streak > 0 ? (
						<span className="rounded-full border border-amber-400/35 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
							🔥 {data.streak}d
						</span>
					) : null}
					{data.totalSolvers > 0 ? (
						<span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] font-medium text-slate-300 tabular-nums">
							{data.totalSolvers} solved
						</span>
					) : null}
					{!isCustom ? (
						<span className="rounded-full border border-slate-800 bg-slate-950/80 px-2 py-0.5 text-[10px] font-medium text-slate-400 tabular-nums">
							Next {countdown}
						</span>
					) : null}
				</div>

				{/* Title */}
				<div className="text-center">
					<h1 className="text-lg font-black tracking-tight text-white sm:text-xl">
						{isCustom
							? `"${data.customTitle ?? "Custom Optics"}"`
							: "Bend the Daily Beam"}
					</h1>
					<p className="mt-0.5 text-[11px] text-slate-400">
						{isCustom
							? `Created by u/${data.customAuthor ?? "Redditor"} • Par ${data.customPar ?? 3} taps`
							: "01 Mirrors • 02 Prism Splitters • 03 Quantum Portals"}
					</p>
				</div>

				{/* Live animated optical preview */}
				<div className="flex w-full justify-center">
					<PrismBoard
						stage={data.previewStage}
						orientations={animatedOrientations}
						trace={previewTrace}
						interactive={false}
						compact
					/>
				</div>

				{/* Subreddit Leader Ticker */}
				{data.topLeader ? (
					<div className="flex items-center gap-2 rounded-full border border-amber-400/30 bg-slate-950/85 px-3 py-1 text-[11px] text-slate-200">
						{data.topLeader.snoovatarUrl ? (
							<img
								src={data.topLeader.snoovatarUrl}
								alt=""
								className="h-4 w-4 rounded-full border border-amber-400/50 object-cover"
							/>
						) : null}
						<span className="font-bold text-amber-300">👑 #1</span>
						<span className="max-w-[130px] truncate font-semibold text-white">
							u/{data.topLeader.username}
						</span>
						<span className="text-slate-400 tabular-nums">
							{data.topLeader.totalTaps} taps •{" "}
							{formatDuration(data.topLeader.elapsedSec)}
						</span>
					</div>
				) : null}

				{/* Primary CTA */}
				<button
					type="button"
					onClick={(e) => requestExpandedMode(e.nativeEvent, "game")}
					className="flex min-h-11 w-full max-w-[270px] cursor-pointer items-center justify-center gap-2 rounded-full bg-[#ff4500] px-6 py-2.5 text-sm font-extrabold tracking-wide text-white shadow-[0_8px_28px_rgba(255,69,0,0.45)] hover:bg-[#e03d00]"
				>
					<span>
						{data.alreadySolved
							? "VIEW MY SCORE & LEADERBOARD"
							: isCustom
								? "SOLVE THIS PUZZLE"
								: "PLAY TODAY'S BEAM"}
					</span>
					<span aria-hidden="true">→</span>
				</button>

				<p className="text-[10px] text-slate-500">
					Playing as{" "}
					<span className="font-semibold text-slate-300">
						u/{data.username}
					</span>{" "}
					in r/
					{data.subredditName}
				</p>
			</div>
		</main>
	);
};

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Splash />
	</StrictMode>,
);
