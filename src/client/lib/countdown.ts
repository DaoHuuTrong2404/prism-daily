export const getNextUtcCountdown = (nowMs: number = Date.now()): string => {
	const now = new Date(nowMs);
	const nextMidnightMs = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate() + 1,
		0,
		0,
		0,
	);
	const diffSec = Math.max(0, Math.floor((nextMidnightMs - nowMs) / 1000));
	const h = String(Math.floor(diffSec / 3600)).padStart(2, "0");
	const m = String(Math.floor((diffSec % 3600) / 60)).padStart(2, "0");
	const s = String(diffSec % 60).padStart(2, "0");
	return `${h}:${m}:${s}`;
};
