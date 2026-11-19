import type { DailyPack, PuzzleStage, StageResultSummary } from "./prismEngine";

export type PlayerProfile = {
	username: string;
	snoovatarUrl?: string;
	streak: number;
	bestStreak: number;
	totalSolved: number;
	parMasterCount: number;
	lastPlayedDate?: string;
};

export type LeaderboardEntry = {
	rank: number;
	username: string;
	snoovatarUrl?: string;
	totalTaps: number;
	totalPar: number;
	elapsedSec: number;
	streak: number;
	parMaster: boolean;
};

export type HallOfFameEntry = {
	rank: number;
	username: string;
	snoovatarUrl?: string;
	parMasterCount: number;
	totalSolved: number;
	bestStreak: number;
};

export type CommunityPuzzleSummary = {
	postId: string;
	url: string;
	title: string;
	author: string;
	par: number;
	size: 5 | 6;
	solvers: number;
	createdAt: string;
};

export type ArchiveDayStatus = "par" | "solved";

export type MoveDistribution = {
	parOrBetter: number;
	plus1To2: number;
	plus3To5: number;
	plus6OrMore: number;
};

export type CompletedRunRecord = {
	dateKey: string;
	totalTaps: number;
	totalPar: number;
	elapsedSec: number;
	hintsUsed: number;
	stageResults: StageResultSummary[];
	rank: number;
	percentile: number;
	completedAt: string;
	commentShared: boolean;
};

export type SplashResponse = {
	dateKey: string;
	dayNumber: number;
	mode: "daily" | "custom";
	customTitle?: string;
	customAuthor?: string;
	customPar?: number;
	username: string;
	subredditName: string;
	streak: number;
	totalSolvers: number;
	alreadySolved: boolean;
	topLeader?: LeaderboardEntry;
	previewStage: PuzzleStage;
};

export type GameInitResponse = {
	postId: string;
	subredditName: string;
	mode: "daily" | "custom";
	dateKey: string;
	dayNumber: number;
	dailyPack: DailyPack;
	customPuzzle?: {
		title: string;
		author: string;
		stage: PuzzleStage;
	};
	profile: PlayerProfile;
	todayCompletion?: CompletedRunRecord;
	leaderboard: LeaderboardEntry[];
	hallOfFame: HallOfFameEntry[];
	communityPuzzles: CommunityPuzzleSummary[];
	solvedDates: Record<string, ArchiveDayStatus>;
	studioEnabled: boolean;
	distribution: MoveDistribution;
	totalSolvers: number;
};

export type SubmitRunRequest = {
	mode: "daily" | "custom";
	dateKey: string;
	totalTaps: number;
	totalPar: number;
	elapsedSec: number;
	hintsUsed: number;
	stageResults: StageResultSummary[];
};

export type SubmitRunResponse = {
	ok: true;
	completion: CompletedRunRecord;
	profile: PlayerProfile;
	leaderboard: LeaderboardEntry[];
	hallOfFame: HallOfFameEntry[];
	solvedDates: Record<string, ArchiveDayStatus>;
	distribution: MoveDistribution;
	totalSolvers: number;
	flairAwarded?: string;
};

export type ShareCommentRequest = {
	text: string;
	dateKey: string;
};

export type ShareCommentResponse = {
	ok: true;
	commentId: string;
};

export type PublishPuzzleRequest = {
	title: string;
	stage: PuzzleStage;
};

export type PublishPuzzleResponse = {
	ok: true;
	postId: string;
	url: string;
};

export type ApiErrorResponse = {
	status: "error";
	message: string;
};
