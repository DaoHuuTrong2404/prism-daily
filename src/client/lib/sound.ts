const PENTATONIC_HZ: readonly number[] = [
	523.25, // C5
	587.33, // D5
	659.25, // E5
	783.99, // G5
	880.0, // A5
	1046.5, // C6
];

let audioCtx: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
	if (typeof window === "undefined") return null;
	if (audioCtx) {
		if (audioCtx.state === "suspended") {
			void audioCtx.resume().catch(() => {});
		}
		return audioCtx;
	}
	const Ctor = window.AudioContext;
	if (!Ctor) return null;
	try {
		audioCtx = new Ctor();
		return audioCtx;
	} catch {
		return null;
	}
};

export const playMirrorClick = (muted: boolean): void => {
	if (muted) return;
	const ctx = getAudioContext();
	if (!ctx) return;

	const now = ctx.currentTime;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = "triangle";
	osc.frequency.setValueAtTime(460, now);
	osc.frequency.exponentialRampToValueAtTime(205, now + 0.042);

	gain.gain.setValueAtTime(0.085, now);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.048);

	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(now);
	osc.stop(now + 0.052);
};

export const playUndoClick = (muted: boolean): void => {
	if (muted) return;
	const ctx = getAudioContext();
	if (!ctx) return;

	const now = ctx.currentTime;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = "sine";
	osc.frequency.setValueAtTime(280, now);
	osc.frequency.exponentialRampToValueAtTime(190, now + 0.055);

	gain.gain.setValueAtTime(0.06, now);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(now);
	osc.stop(now + 0.065);
};

export const playPortalWarp = (muted: boolean): void => {
	if (muted) return;
	const ctx = getAudioContext();
	if (!ctx) return;

	const now = ctx.currentTime;
	const freqs = [330, 495];
	for (const base of freqs) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.setValueAtTime(base, now);
		osc.frequency.exponentialRampToValueAtTime(base * 1.48, now + 0.16);

		gain.gain.setValueAtTime(0.001, now);
		gain.gain.linearRampToValueAtTime(0.045, now + 0.03);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(now);
		osc.stop(now + 0.2);
	}
};

export const playCrystalChime = (litCount: number, muted: boolean): void => {
	if (muted || litCount <= 0) return;
	const ctx = getAudioContext();
	if (!ctx) return;

	const now = ctx.currentTime;
	const idx = Math.min(PENTATONIC_HZ.length - 1, Math.max(0, litCount - 1));
	const freq = PENTATONIC_HZ[idx] ?? 523.25;

	// Primary crystal tone + subtle glass overtone
	const layers: readonly [number, number, number][] = [
		[freq, 0.1, 0.3],
		[freq * 2, 0.032, 0.19],
	];

	for (const [f, peak, dur] of layers) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.setValueAtTime(f, now);

		gain.gain.setValueAtTime(0.001, now);
		gain.gain.linearRampToValueAtTime(peak, now + 0.014);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(now);
		osc.stop(now + dur + 0.02);
	}
};

export const playStageClearChord = (
	isFinal: boolean,
	muted: boolean,
	isParMaster = false,
): void => {
	if (muted) return;
	const ctx = getAudioContext();
	if (!ctx) return;

	const notes = isFinal
		? isParMaster
			? [523.25, 659.25, 783.99, 1046.5, 1318.5]
			: [523.25, 659.25, 783.99, 1046.5]
		: [523.25, 659.25, 783.99];
	const baseTime = ctx.currentTime;

	notes.forEach((freq, i) => {
		const start = baseTime + i * 0.062;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = i === notes.length - 1 && isParMaster ? "triangle" : "sine";
		osc.frequency.setValueAtTime(freq, start);

		gain.gain.setValueAtTime(0.001, start);
		gain.gain.linearRampToValueAtTime(0.088, start + 0.022);
		gain.gain.exponentialRampToValueAtTime(0.001, start + 0.48);

		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(start);
		osc.stop(start + 0.5);
	});
};
