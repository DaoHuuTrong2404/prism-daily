import "./index.css";

import { showShareSheet, showToast } from "@devvit/web/client";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
	ApiErrorResponse,
	CompletedRunRecord,
	GameInitResponse,
	LeaderboardEntry,
	MoveDistribution,
	PlayerProfile,
	ShareCommentResponse,
	SubmitRunResponse,
} from "../shared/api";
import {
	buildShareText,
	cellKey,
	findOptimalSolution,
	formatDuration,
	generateDailyPack,
	getDayNumber,
	getInitialOrientations,
	getInteractiveCells,
	getUtcDateKey,
	shiftDateKey,
	traceBeam,
	type MirrorOrientation,
	type PuzzleStage,
	type StageResultSummary,
} from "../shared/prismEngine";
import { ModalDialog } from "./components/ModalDialog";
import { PrismBoard } from "./components/PrismBoard";
import { StudioModal } from "./components/StudioModal";
import {
	playCrystalChime,
	playMirrorClick,
	playStageClearChord,
} from "./lib/sound";

type UndoItem = {
	key: string;
	prevOrientation: MirrorOrientation;
};

export const App = () => {
	const todayUtc = useMemo(() => getUtcDateKey(), []);
	const [selectedDate, setSelectedDate] = useState<string>(todayUtc);
	const [loading, setLoading] = useState(true);
	const [mode, setMode] = useState<"daily" | "custom">("daily");
	const [subredditName, setSubredditName] = useState("Devvit");
	const [dayNumber, setDayNumber] = useState(() => getDayNumber(todayUtc));
	const [stages, setStages] = useState<PuzzleStage[]>(
		() => generateDailyPack(todayUtc).stages,
	);
	const [customMeta, setCustomMeta] = useState<{
		title: string;
		author: string;
	} | null>(null);

	// Player & community state
	const [profile, setProfile] = useState<PlayerProfile>({
		username: "Redditor",
		streak: 0,
		bestStreak: 0,
		totalSolved: 0,
		parMasterCount: 0,
	});
	const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
	const [distribution, setDistribution] = useState<MoveDistribution>({
		parOrBetter: 0,
		plus1To2: 0,
		plus3To5: 0,
		plus6OrMore: 0,
	});
	const [totalSolvers, setTotalSolvers] = useState(0);
	const [completion, setCompletion] = useState<CompletedRunRecord | null>(null);

	// Active gameplay state
	const [stageIdx, setStageIdx] = useState(0);
	const [orientations, setOrientations] = useState<
		Record<string, MirrorOrientation>
	>({});
	const [undoStack, setUndoStack] = useState<UndoItem[]>([]);
	const [stageTaps, setStageTaps] = useState(0);
	const [stageHints, setStageHints] = useState(0);
	const [stageResults, setStageResults] = useState<StageResultSummary[]>([]);
	const [hintCellKey, setHintCellKey] = useState<string | null>(null);
	const [elapsedSec, setElapsedSec] = useState(0);
	const [timerRunning, setTimerRunning] = useState(false);
	const [stageCleared, setStageCleared] = useState(false);
	const [runFinished, setRunFinished] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [sharingComment, setSharingComment] = useState(false);

	// UI & modals
	const [muted, setMuted] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const [showLeaderboard, setShowLeaderboard] = useState(false);
	const [showSummary, setShowSummary] = useState(false);
	const [showStudio, setShowStudio] = useState(false);

	const loadGame = useCallback(async (dateOverride?: string) => {
		try {
			const qs = dateOverride
				? `?date=${encodeURIComponent(dateOverride)}`
				: "";
			const res = await fetch(`/api/init${qs}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as GameInitResponse;

			setMode(data.mode);
			setSubredditName(data.subredditName);
			setSelectedDate(data.dateKey);
			setDayNumber(data.dayNumber);
			setProfile(data.profile);
			setLeaderboard(data.leaderboard);
			setDistribution(data.distribution);
			setTotalSolvers(data.totalSolvers);

			const loadedStages: PuzzleStage[] =
				data.mode === "custom" && data.customPuzzle
					? [data.customPuzzle.stage]
					: [...data.dailyPack.stages];

			setStages(loadedStages);
			setCustomMeta(
				data.mode === "custom" && data.customPuzzle
					? { title: data.customPuzzle.title, author: data.customPuzzle.author }
					: null,
			);

			const firstStage = loadedStages[0];
			if (firstStage) {
				setStageIdx(0);
				setOrientations(getInitialOrientations(firstStage));
				setUndoStack([]);
				setStageTaps(0);
				setStageHints(0);
				setStageResults([]);
				setHintCellKey(null);
				setStageCleared(false);
			}

			if (data.todayCompletion) {
				setCompletion(data.todayCompletion);
				setRunFinished(true);
				setTimerRunning(false);
				setElapsedSec(data.todayCompletion.elapsedSec);
				setShowSummary(true);
			} else {
				setCompletion(null);
				setRunFinished(false);
				setElapsedSec(0);
				setTimerRunning(true);
				setShowSummary(false);
			}
		} catch {
			// Offline / local preview fallback
			const fallbackDate = dateOverride ?? getUtcDateKey();
			const pack = generateDailyPack(fallbackDate);
			setMode("daily");
			setSelectedDate(fallbackDate);
			setDayNumber(pack.dayNumber);
			setStages([...pack.stages]);
			setOrientations(getInitialOrientations(pack.stages[0]));
			setStageIdx(0);
			setUndoStack([]);
			setStageTaps(0);
			setStageHints(0);
			setStageResults([]);
			setHintCellKey(null);
			setStageCleared(false);
			setRunFinished(false);
			setElapsedSec(0);
			setTimerRunning(true);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		const run = async () => {
			await Promise.resolve();
			if (!cancelled) {
				await loadGame();
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [loadGame]);

	// Run clock
	useEffect(() => {
		if (!timerRunning || runFinished || loading) return;
		const id = window.setInterval(() => {
			setElapsedSec((s) => s + 1);
		}, 1000);
		return () => window.clearInterval(id);
	}, [timerRunning, runFinished, loading]);

	const activeStage: PuzzleStage =
		stages[stageIdx] ?? stages[0] ?? generateDailyPack(todayUtc).stages[0];

	const trace = useMemo(
		() => traceBeam(activeStage, orientations),
		[activeStage, orientations],
	);

	const submitFinalRun = useCallback(
		async (finalResults: StageResultSummary[]) => {
			setSubmitting(true);
			setRunFinished(true);
			setTimerRunning(false);

			const totalTaps = finalResults.reduce((acc, r) => acc + r.taps, 0);
			const totalPar = finalResults.reduce((acc, r) => acc + r.par, 0);
			const hintsUsed = finalResults.reduce((acc, r) => acc + r.hintsUsed, 0);
			const safeElapsed = Math.max(1, elapsedSec);

			try {
				const res = await fetch("/api/submit-run", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						mode,
						dateKey: selectedDate,
						totalTaps,
						totalPar,
						elapsedSec: safeElapsed,
						hintsUsed,
						stageResults: finalResults,
					}),
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const json = (await res.json()) as SubmitRunResponse;
				setCompletion(json.completion);
				setProfile(json.profile);
				setLeaderboard(json.leaderboard);
				setDistribution(json.distribution);
				setTotalSolvers(json.totalSolvers);
				if (json.flairAwarded) {
					showToast(`Unlocked flair: ${json.flairAwarded}`);
				}
			} catch {
				// Local fallback completion card if running standalone outside Devvit
				setCompletion({
					dateKey: selectedDate,
					totalTaps,
					totalPar,
					elapsedSec: safeElapsed,
					hintsUsed,
					stageResults: finalResults,
					rank: 1,
					percentile: 99,
					completedAt: new Date().toISOString(),
					commentShared: false,
				});
			} finally {
				setSubmitting(false);
				setShowSummary(true);
			}
		},
		[elapsedSec, mode, selectedDate],
	);

	const handleCellTap = (r: number, c: number) => {
		if (stageCleared || loading) return;
		const k = cellKey(r, c);
		const prevOrient: MirrorOrientation = orientations[k] ?? 0;
		const nextOrient: MirrorOrientation = prevOrient === 0 ? 1 : 0;

		const nextOrientations: Record<string, MirrorOrientation> = {
			...orientations,
			[k]: nextOrient,
		};

		const nextTaps = stageTaps + 1;
		const prevLitCount = trace.litCrystals.length;
		const nextTrace = traceBeam(activeStage, nextOrientations);

		setOrientations(nextOrientations);
		setUndoStack((stack) => [
			...stack,
			{ key: k, prevOrientation: prevOrient },
		]);
		setStageTaps(nextTaps);
		setHintCellKey(null);

		if (nextTrace.solved) {
			const isLastStage = stageIdx >= stages.length - 1;
			playStageClearChord(isLastStage, muted);
			setStageCleared(true);

			const summary: StageResultSummary = {
				stageNumber: activeStage.stageNumber,
				taps: nextTaps,
				par: activeStage.par,
				crystals: nextTrace.totalCrystals,
				hintsUsed: stageHints,
			};
			const updatedResults = [...stageResults, summary];
			setStageResults(updatedResults);

			if (isLastStage && !completion) {
				void submitFinalRun(updatedResults);
			} else if (isLastStage && completion) {
				setRunFinished(true);
				setShowSummary(true);
			}
		} else if (nextTrace.litCrystals.length > prevLitCount) {
			playCrystalChime(nextTrace.litCrystals.length, muted);
		} else {
			playMirrorClick(muted);
		}
	};

	const handleAdvanceStage = () => {
		const nextIdx = stageIdx + 1;
		const nextStage = stages[nextIdx];
		if (!nextStage) return;
		setStageIdx(nextIdx);
		setOrientations(getInitialOrientations(nextStage));
		setUndoStack([]);
		setStageTaps(0);
		setStageHints(0);
		setHintCellKey(null);
		setStageCleared(false);
	};

	const handleUndo = () => {
		if (undoStack.length === 0 || stageCleared) return;
		const last = undoStack[undoStack.length - 1];
		if (!last) return;
		setUndoStack((stack) => stack.slice(0, -1));
		setOrientations((prev) => ({ ...prev, [last.key]: last.prevOrientation }));
		setStageTaps((t) => Math.max(0, t - 1));
		setHintCellKey(null);
		playMirrorClick(muted);
	};

	const handleResetStage = () => {
		if (stageCleared) return;
		setOrientations(getInitialOrientations(activeStage));
		setUndoStack([]);
		setStageTaps(0);
		setHintCellKey(null);
		playMirrorClick(muted);
	};

	const handleSmartHint = () => {
		if (stageCleared) return;
		const opt = findOptimalSolution(activeStage, orientations);
		if (!opt.solvable || opt.nextFlipIndex === null) {
			showToast("Already optimal!");
			return;
		}
		const interactives = getInteractiveCells(activeStage);
		const target = interactives[opt.nextFlipIndex];
		if (!target) return;
		setHintCellKey(cellKey(target.r, target.c));
		setStageHints((h) => h + 1);
		playCrystalChime(2, muted);
	};

	const handleReplayPractice = () => {
		const first = stages[0];
		if (!first) return;
		setShowSummary(false);
		setStageIdx(0);
		setOrientations(getInitialOrientations(first));
		setUndoStack([]);
		setStageTaps(0);
		setStageHints(0);
		setStageResults([]);
		setHintCellKey(null);
		setStageCleared(false);
		setRunFinished(false);
	};

	const handleShiftArchiveDay = (delta: number) => {
		const nextDate = shiftDateKey(selectedDate, delta);
		if (nextDate > todayUtc) return;
		if (nextDate < "2026-11-11") return;
		setLoading(true);
		void loadGame(nextDate);
	};

	const shareText = useMemo(() => {
		const summary = completion;
		if (!summary) return "";
		return buildShareText({
			dayNumber,
			stageResults: summary.stageResults,
			totalTaps: summary.totalTaps,
			totalPar: summary.totalPar,
			elapsedSec: summary.elapsedSec,
			streak: profile.streak,
			percentile: summary.percentile,
			...(customMeta ? { customTitle: customMeta.title } : {}),
		});
	}, [completion, customMeta, dayNumber, profile.streak]);

	const handleShareToComments = async () => {
		if (!shareText || !completion) return;
		setSharingComment(true);
		try {
			const res = await fetch("/api/share-comment", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: shareText, dateKey: selectedDate }),
			});
			if (!res.ok) {
				const err = (await res.json()) as ApiErrorResponse;
				showToast(err.message || "Could not post comment.");
				return;
			}
			const json = (await res.json()) as ShareCommentResponse;
			if (json.ok) {
				setCompletion((prev) =>
					prev ? { ...prev, commentShared: true } : prev,
				);
				showToast("Score posted to Reddit comments!");
			}
		} catch {
			showToast("Failed to post comment.");
		} finally {
			setSharingComment(false);
		}
	};

	const handleCopyOrShareSheet = async () => {
		if (!shareText) return;
		try {
			await showShareSheet({
				title: customMeta
					? `PRISM STUDIO: ${customMeta.title}`
					: `PRISM DAILY #${dayNumber}`,
				text: shareText,
			});
		} catch {
			// Fallback to clipboard
		}
		try {
			if (navigator.clipboard) {
				await navigator.clipboard.writeText(shareText);
				showToast("Result card copied to clipboard!");
			}
		} catch {
			showToast("Ready to share!");
		}
	};

	const distTotal = Math.max(
		1,
		distribution.parOrBetter +
			distribution.plus1To2 +
			distribution.plus3To5 +
			distribution.plus6OrMore,
	);

	const playerBucket = useMemo(() => {
		if (!completion) return "";
		const d = completion.totalTaps - completion.totalPar;
		if (d <= 0) return "parOrBetter";
		if (d <= 2) return "plus1To2";
		if (d <= 5) return "plus3To5";
		return "plus6OrMore";
	}, [completion]);

	return (
		<div className="optical-bench-bg flex min-h-full w-full flex-col items-center px-3 py-3 text-slate-100">
			<div className="flex w-full max-w-[440px] flex-1 flex-col gap-3">
				{/* Top Header */}
				<header className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-950/75 px-3 py-2 backdrop-blur">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="truncate text-sm font-black tracking-wide text-white">
								{mode === "custom"
									? `STUDIO: ${customMeta?.title ?? "Custom"}`
									: `PRISM DAILY #${dayNumber}`}
							</span>
							{profile.streak > 0 ? (
								<span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
									🔥 {profile.streak}
								</span>
							) : null}
						</div>
						<div className="flex items-center gap-1.5 text-[11px] text-slate-400">
							{mode === "daily" ? (
								<>
									<button
										type="button"
										aria-label="Previous day"
										disabled={selectedDate <= "2026-11-11" || loading}
										onClick={() => handleShiftArchiveDay(-1)}
										className="cursor-pointer rounded px-1 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
									>
										‹
									</button>
									<span className="tabular-nums">{selectedDate}</span>
									<button
										type="button"
										aria-label="Next day"
										disabled={selectedDate >= todayUtc || loading}
										onClick={() => handleShiftArchiveDay(1)}
										className="cursor-pointer rounded px-1 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
									>
										›
									</button>
								</>
							) : (
								<span>by u/{customMeta?.author ?? "Redditor"}</span>
							)}
						</div>
					</div>

					{/* Action Icon Strip */}
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onClick={() => setShowStudio(true)}
							aria-label="Open Community Puzzle Studio"
							title="Create & Post Puzzle"
							className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-sky-500/35 bg-sky-500/15 text-base font-bold text-sky-300 hover:bg-sky-500/25"
						>
							+
						</button>
						<button
							type="button"
							onClick={() => setShowLeaderboard(true)}
							aria-label="Open Subreddit Leaderboard"
							title="Leaderboard"
							className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900 text-sm text-amber-300 hover:border-amber-400/50"
						>
							🏆
						</button>
						<button
							type="button"
							onClick={() => setShowHelp(true)}
							aria-label="How to Play"
							title="How to Play"
							className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900 text-sm font-bold text-slate-200 hover:border-slate-500"
						>
							?
						</button>
						<button
							type="button"
							onClick={() => setMuted((m) => !m)}
							aria-label={muted ? "Unmute audio" : "Mute audio"}
							title={muted ? "Unmute" : "Mute"}
							className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900 text-sm text-slate-300 hover:border-slate-500"
						>
							{muted ? "🔇" : "🔊"}
						</button>
					</div>
				</header>

				{/* Stage Progress Pills (Daily 3-stage mode) */}
				{stages.length > 1 ? (
					<div
						className="grid grid-cols-3 gap-1.5"
						role="status"
						aria-label="Stage progress"
					>
						{stages.map((st, idx) => {
							const done = idx < stageIdx || (idx === stageIdx && stageCleared);
							const active = idx === stageIdx;
							return (
								<div
									key={st.id}
									className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
										done
											? "border-emerald-500/45 bg-emerald-950/45 text-emerald-300"
											: active
												? "border-sky-400/55 bg-sky-950/50 text-sky-200"
												: "border-slate-800 bg-slate-950/60 text-slate-500"
									}`}
								>
									<span>{done ? "✓" : `0${st.stageNumber}`}</span>
									<span className="truncate">{st.name}</span>
								</div>
							);
						})}
					</div>
				) : null}

				{/* Telemetry HUD */}
				<div className="grid grid-cols-3 gap-2">
					<div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-center">
						<div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
							Crystals
						</div>
						<div
							className={`text-base font-black tabular-nums ${
								trace.solved ? "text-emerald-400" : "text-sky-300"
							}`}
						>
							{trace.litCrystals.length} / {trace.totalCrystals}
						</div>
					</div>
					<div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-center">
						<div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
							Taps / Par
						</div>
						<div
							className={`text-base font-black tabular-nums ${
								stageTaps <= activeStage.par
									? "text-amber-300"
									: "text-slate-100"
							}`}
						>
							{stageTaps} / {activeStage.par}
						</div>
					</div>
					<div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-center">
						<div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
							Time
						</div>
						<div className="text-base font-black text-slate-100 tabular-nums">
							{formatDuration(elapsedSec)}
						</div>
					</div>
				</div>

				{/* Subtitle prompt */}
				<p className="text-center text-xs text-slate-400">
					{activeStage.subtitle}
				</p>

				{/* Optical Bench Board */}
				<div className="flex w-full justify-center">
					{loading ? (
						<div className="flex aspect-square w-full max-w-[380px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/80 text-sm text-slate-400">
							Calibrating optical bench...
						</div>
					) : (
						<PrismBoard
							stage={activeStage}
							orientations={orientations}
							trace={trace}
							onCellTap={handleCellTap}
							hintCellKey={hintCellKey}
							interactive={!stageCleared}
						/>
					)}
				</div>

				{/* Stage Clear CTA OR Tactical Controls */}
				{stageCleared ? (
					<div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-950/40 p-3 text-center">
						<div className="text-sm font-extrabold text-emerald-300">
							{stageTaps <= activeStage.par && stageHints === 0
								? `★ PAR CLEAR! ${stageTaps}/${activeStage.par} taps`
								: `Stage ${activeStage.stageNumber} Aligned in ${stageTaps} taps (Par ${activeStage.par})`}
						</div>
						{stageIdx < stages.length - 1 ? (
							<button
								type="button"
								onClick={handleAdvanceStage}
								className="min-h-11 w-full cursor-pointer rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950 shadow-[0_6px_20px_rgba(52,211,153,0.4)] hover:bg-emerald-400"
							>
								NEXT STAGE ({stageIdx + 2}/{stages.length}) →
							</button>
						) : (
							<button
								type="button"
								disabled={submitting}
								onClick={() => setShowSummary(true)}
								className="min-h-11 w-full cursor-pointer rounded-xl bg-[#ff4500] px-4 py-2.5 text-sm font-black text-white shadow-[0_6px_20px_rgba(255,69,0,0.4)] hover:bg-[#e03d00]"
							>
								{submitting
									? "Saving Score..."
									: "VIEW DAILY SCORECARD & SHARE →"}
							</button>
						)}
					</div>
				) : (
					<div className="grid grid-cols-3 gap-2">
						<button
							type="button"
							disabled={undoStack.length === 0}
							onClick={handleUndo}
							className="min-h-11 cursor-pointer rounded-xl border border-slate-700/80 bg-slate-900/90 px-3 py-2 text-xs font-bold text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
						>
							↶ Undo
						</button>
						<button
							type="button"
							disabled={stageTaps === 0}
							onClick={handleResetStage}
							className="min-h-11 cursor-pointer rounded-xl border border-slate-700/80 bg-slate-900/90 px-3 py-2 text-xs font-bold text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
						>
							↻ Reset
						</button>
						<button
							type="button"
							onClick={handleSmartHint}
							className="min-h-11 cursor-pointer rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-500/25"
						>
							✦ Hint
						</button>
					</div>
				)}

				{/* Quick bottom bar if user already solved today */}
				{completion && !showSummary ? (
					<button
						type="button"
						onClick={() => setShowSummary(true)}
						className="min-h-10 w-full cursor-pointer rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-300 hover:bg-sky-500/20"
					>
						View My Saved Daily Scorecard (#{completion.rank} in r/
						{subredditName})
					</button>
				) : null}
			</div>

			{/* Victory & Community Scorecard Modal */}
			<ModalDialog
				open={showSummary}
				title={
					customMeta
						? `Cleared: ${customMeta.title}`
						: `PRISM DAILY #${dayNumber} Complete`
				}
				onClose={() => setShowSummary(false)}
			>
				{completion ? (
					<div className="flex flex-col gap-4">
						<div className="grid grid-cols-4 gap-2 text-center">
							<div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
								<div className="text-[10px] text-slate-400">TAPS</div>
								<div className="text-sm font-black text-amber-300 tabular-nums">
									{completion.totalTaps}/{completion.totalPar}
								</div>
							</div>
							<div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
								<div className="text-[10px] text-slate-400">TIME</div>
								<div className="text-sm font-black text-slate-100 tabular-nums">
									{formatDuration(completion.elapsedSec)}
								</div>
							</div>
							<div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
								<div className="text-[10px] text-slate-400">RANK</div>
								<div className="text-sm font-black text-sky-300 tabular-nums">
									#{completion.rank}
								</div>
							</div>
							<div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">
								<div className="text-[10px] text-slate-400">STREAK</div>
								<div className="text-sm font-black text-orange-400 tabular-nums">
									🔥 {profile.streak}
								</div>
							</div>
						</div>

						{/* Subreddit Percentile & Distribution Histogram */}
						<div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
							<div className="mb-2 flex items-center justify-between text-xs">
								<span className="font-bold text-slate-200">
									r/{subredditName} Breakdown
								</span>
								<span className="font-semibold text-emerald-300 tabular-nums">
									Top {Math.max(1, 100 - completion.percentile)}% (
									{totalSolvers} solved)
								</span>
							</div>
							<div className="flex flex-col gap-1.5 text-[11px]">
								{(
									[
										["parOrBetter", "Par ★", distribution.parOrBetter],
										["plus1To2", "+1–2", distribution.plus1To2],
										["plus3To5", "+3–5", distribution.plus3To5],
										["plus6OrMore", "+6+", distribution.plus6OrMore],
									] as const
								).map(([bucketKey, label, count]) => {
									const pct = Math.max(
										6,
										Math.round((count / distTotal) * 100),
									);
									const isUser = playerBucket === bucketKey;
									return (
										<div key={bucketKey} className="flex items-center gap-2">
											<span className="w-11 shrink-0 font-mono text-slate-400">
												{label}
											</span>
											<div className="h-4 flex-1 overflow-hidden rounded bg-slate-900">
												<div
													className={`flex h-full items-center justify-end pr-1.5 text-[10px] font-bold tabular-nums ${
														isUser
															? "bg-sky-500 text-slate-950"
															: "bg-slate-700 text-slate-200"
													}`}
													style={{ width: `${pct}%` }}
												>
													{count}
												</div>
											</div>
										</div>
									);
								})}
							</div>
						</div>

						{/* Spoiler-free share text preview */}
						<pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-200">
							{shareText}
						</pre>

						{/* Community Share Actions */}
						<div className="flex flex-col gap-2">
							<button
								type="button"
								disabled={sharingComment || completion.commentShared}
								onClick={() => {
									void handleShareToComments();
								}}
								className="min-h-11 w-full cursor-pointer rounded-xl bg-[#ff4500] px-4 py-2.5 text-sm font-bold text-white shadow-[0_6px_20px_rgba(255,69,0,0.35)] hover:bg-[#e03d00] disabled:cursor-not-allowed disabled:opacity-50"
							>
								{completion.commentShared
									? "✓ Shared to Thread Comments"
									: sharingComment
										? "Posting Comment..."
										: "Post Score to Reddit Comments"}
							</button>

							<div className="grid grid-cols-2 gap-2">
								<button
									type="button"
									onClick={() => {
										void handleCopyOrShareSheet();
									}}
									className="min-h-10 cursor-pointer rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:border-sky-400/50"
								>
									Copy / Share Card
								</button>
								<button
									type="button"
									onClick={handleReplayPractice}
									className="min-h-10 cursor-pointer rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:border-slate-500"
								>
									Replay Practice
								</button>
							</div>

							<button
								type="button"
								onClick={() => {
									setShowSummary(false);
									setShowStudio(true);
								}}
								className="min-h-10 w-full cursor-pointer rounded-xl border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-500/25"
							>
								+ Build & Post Your Own Puzzle
							</button>
						</div>
					</div>
				) : null}
			</ModalDialog>

			{/* Leaderboard Modal */}
			<ModalDialog
				open={showLeaderboard}
				title={`r/${subredditName} Leaderboard`}
				onClose={() => setShowLeaderboard(false)}
			>
				<div className="flex flex-col gap-2">
					{leaderboard.length === 0 ? (
						<p className="py-6 text-center text-xs text-slate-400">
							No solvers yet today — complete the 3 stages to claim #1!
						</p>
					) : (
						leaderboard.map((entry) => {
							const isMe = entry.username === profile.username;
							return (
								<div
									key={entry.username}
									className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
										isMe
											? "border-sky-400/50 bg-sky-950/45"
											: "border-slate-800 bg-slate-900/70"
									}`}
								>
									<div className="flex min-w-0 items-center gap-2.5">
										<span className="w-6 text-center text-xs font-black text-amber-300 tabular-nums">
											#{entry.rank}
										</span>
										{entry.snoovatarUrl ? (
											<img
												src={entry.snoovatarUrl}
												alt=""
												className="h-7 w-7 rounded-full border border-slate-700 bg-slate-800 object-cover"
											/>
										) : (
											<div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-[11px] font-bold text-sky-300">
												{entry.username.slice(0, 1).toUpperCase()}
											</div>
										)}
										<div className="min-w-0">
											<div className="truncate text-xs font-bold text-slate-100">
												u/{entry.username}
											</div>
											<div className="flex items-center gap-1.5 text-[10px] text-slate-400">
												{entry.parMaster ? (
													<span className="font-bold text-emerald-300">
														★ PAR
													</span>
												) : null}
												{entry.streak > 0 ? (
													<span>🔥 {entry.streak}d</span>
												) : null}
											</div>
										</div>
									</div>
									<div className="shrink-0 text-right tabular-nums">
										<div className="text-xs font-black text-white">
											{entry.totalTaps} taps
										</div>
										<div className="text-[10px] text-slate-400">
											{formatDuration(entry.elapsedSec)}
										</div>
									</div>
								</div>
							);
						})
					)}
				</div>
			</ModalDialog>

			{/* How to Play Modal */}
			<ModalDialog
				open={showHelp}
				title="How to Play PRISM DAILY"
				onClose={() => setShowHelp(false)}
			>
				<div className="flex flex-col gap-3 text-xs leading-relaxed text-slate-300">
					<p>
						Ignite every <strong className="text-emerald-300">Crystal</strong>{" "}
						on the optical bench simultaneously in as few taps as possible.
						Every UTC midnight unlocks 3 new provably solvable stages.
					</p>
					<ul className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/75 p-3">
						<li>
							<strong className="text-amber-300">Sun Emitter:</strong> Fires the
							primary laser beam in its arrow direction.
						</li>
						<li>
							<strong className="text-sky-300">Mirror (/ or \):</strong> Tap to
							flip 90°. Reflects incoming light along its mirror face.
						</li>
						<li>
							<strong className="text-amber-200">Diamond Prism:</strong> Tap to
							flip 90°. Passes light straight through <em>and</em> splits a
							second ray at 90°.
						</li>
						<li>
							<strong className="text-fuchsia-300">
								Twin Portals (A ↔ B):
							</strong>{" "}
							Beam entering one ring teleports out the matching ring keeping its
							direction.
						</li>
						<li>
							<strong className="text-emerald-300">Crystals:</strong> Beams pass
							right through crystals and light them up. Hit all crystals to
							clear the stage!
						</li>
					</ul>
					<p className="text-[11px] text-slate-400">
						Beat all 3 stages at or under <strong>Par</strong> without hints to
						earn the <strong className="text-sky-300">PRISM Par Master</strong>{" "}
						badge & subreddit flair.
					</p>
				</div>
			</ModalDialog>

			{/* Community Puzzle Studio Modal */}
			<StudioModal open={showStudio} onClose={() => setShowStudio(false)} />
		</div>
	);
};

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
