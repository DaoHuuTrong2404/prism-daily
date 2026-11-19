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
	osc.frequency.setValueAtTime(420, now);
	osc.frequency.exponentialRampToValueAtTime(190, now + 0.045);

	gain.gain.setValueAtTime(0.08, now);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(now);
	osc.stop(now + 0.055);
};

export const playCrystalChime = (litCount: number, muted: boolean): void => {
	if (muted || litCount <= 0) return;
	const ctx = getAudioContext();
	if (!ctx) return;

	const now = ctx.currentTime;
	const idx = Math.min(PENTATONIC_HZ.length - 1, Math.max(0, litCount - 1));
	const freq = PENTATONIC_HZ[idx] ?? 523.25;

	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = "sine";
	osc.frequency.setValueAtTime(freq, now);

	gain.gain.setValueAtTime(0.001, now);
	gain.gain.linearRampToValueAtTime(0.11, now + 0.015);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(now);
	osc.stop(now + 0.3);
};

export const playStageClearChord = (isFinal: boolean, muted: boolean): void => {
	if (muted) return;
	const ctx = getAudioContext();
	if (!ctx) return;

	const notes = isFinal
		? [523.25, 659.25, 783.99, 1046.5]
		: [523.25, 659.25, 783.99];
	const baseTime = ctx.currentTime;

	notes.forEach((freq, i) => {
		const start = baseTime + i * 0.065;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.setValueAtTime(freq, start);

		gain.gain.setValueAtTime(0.001, start);
		gain.gain.linearRampToValueAtTime(0.09, start + 0.025);
		gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);

		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(start);
		osc.stop(start + 0.48);
	});
};
