import nwa from "@nettleweb/audio";
import { _error, _log, kbdFsSource, kbdVsSource, keyMap, keys, notesFsSource, notesVsSource } from "./data";
import { ceil, construct, defineProperty, Error, Float32Array, global, Map, max, min } from "@nettleweb/core/intrinsics";

(async ({ window: win, document: doc }) => {
	if (win == null) { // worker
		const synth = new nwa.SquareSynthesizer();

		function SynthProcessor() {
			const obj = construct(AudioWorkletProcessor, [], new.target);
			obj.port.onmessage = ({ data: [op, pitch, velocity] }: MessageEvent) => {
				if (op === 1)
					synth.noteOn(pitch, velocity);
				else if (op === 0)
					synth.noteOff(pitch);
				else
					synth.allNoteOff();
			};
			obj.process = (_: any, [[frame]]: [[Float32Array]]) => {
				synth._process(frame);
				return true;
			};
			return obj;
		}

		registerProcessor("synth", defineProperty<any>(SynthProcessor, "prototype", {
			value: {
				__proto__: AudioWorkletProcessor.prototype
			},
			writable: false,
			enumerable: false,
			configurable: false
		}));
		return;
	}

	function $(id: string): HTMLElement {
		const e = doc.getElementById(id);
		if (e != null)
			return e;

		throw new Error("Cannot access element: " + id);
	}
	function error(message: string | nul) {
		if (message != null) {
			errEl.textContent = message;
			errEl.style.display = "block";
		} else errEl.style.display = "none";
	}
	function handleError(e: ErrorEvent) {
		const msg = "Unhandled error at " + (e.filename || "unknown source") + " " + e.lineno + ":" + e.colno + "\n\n Message: " + e.message;
		_error(msg, e.error);
		errEl.textContent = msg;
		errEl.style.display = "block";
	}
	function createShader(type: number, source: string): WebGLShader | null {
		const shader = gl.createShader(type);
		if (shader == null)
			return null;

		gl.shaderSource(shader, source);
		gl.compileShader(shader);

		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.error(gl.getShaderInfoLog(shader));
			gl.deleteShader(shader);
			return null;
		}

		return shader;
	}
	function createProgram(vsSource: string, fsSource: string): WebGLProgram {
		const vs = createShader(gl.VERTEX_SHADER, vsSource);
		if (vs == null)
			throw new Error("Failed to create vertex shader.");

		const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
		if (fs == null)
			throw new Error("Failed to create fragment shader.");

		const p = gl.createProgram();
		gl.attachShader(p, vs);
		gl.attachShader(p, fs);
		gl.linkProgram(p);
		return p;
	}

	async function optFetch(url: string): Promise<Uint8Array | null> {
		try {
			const res = await fetch(url, { cache: "no-cache" });
			return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
		} catch (err) {
			return null;
		}
	}

	////////////////////////////////////////
	// DOM Init
	////////////////////////////////////////

	const his = win.history;
	const errEl = $("error");
	const canvas = $("frame") as HTMLCanvasElement;

	if (doc.readyState !== "complete") {
		await new Promise<void>((resolve) => {
			const callback = () => {
				if (doc.readyState === "complete") {
					doc.removeEventListener("readystatechange", callback);
					setTimeout(resolve, 50, null);
				}
			};
			doc.addEventListener("readystatechange", callback, { passive: true });
		});
	}

	win.focus();
	doc.title = "HTML5 Piano";
	his.scrollRestoration = "manual";
	his.replaceState(void 0, "", "/");
	win.addEventListener("error", handleError, { passive: true });

	////////////////////////////////////////
	// Audio Init
	////////////////////////////////////////

	const audioContext = new AudioContext({
		sampleRate: 48000,
		latencyHint: "interactive"
	});
	await audioContext.audioWorklet.addModule("./main.js", {
		credentials: "omit"
	});

	const audioNode = new AudioWorkletNode(audioContext, "synth", {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [1]
	});
	audioNode.addEventListener("processorerror", handleError, { passive: true });
	audioNode.connect(audioContext.destination, 0, 0);

	const testMidi = await optFetch("test.mid");

	// const midi = await win.navigator.requestMIDIAccess({
	// 	sysex: true,
	// 	software: true
	// });
	// for (const [name, port] of midi.inputs) {
	// 	await port.open();

	// 	port.onmidimessage = ({ data }) => {
	// 		if (data != null) {
	// 			const [op, pitch, velocity] = data;


	// 			if (op === 128 || (op === 144 && velocity === 0)) {
	// 				if (pitch >= 21 && pitch <= 108)
	// 					pressedState[pitch - 21] = 0;

	// 				audioNode.port.postMessage([0, pitch, velocity]);
	// 			} else if (op === 144) {
	// 				if (pitch >= 21 && pitch <= 108)
	// 					pressedState[pitch - 21] = 1;

	// 				audioNode.port.postMessage([1, pitch, velocity]);
	// 			}
	// 		}
	// 	};

	// }

	////////////////////////////////////////
	// Canvas Init
	////////////////////////////////////////

	const gl = canvas.getContext("webgl2", {
		alpha: false,
		depth: false,
		antialias: false,
		preserveDrawingBuffer: true,
		failIfMajorPerformanceCaveat: false
	})!;
	if (gl == null) {
		error("Failed to initialize WebGL2 rendering context.");
		return;
	}

	const canvasW = canvas.width;
	const canvasH = canvas.height;

	let canvasTop: number;
	let canvasLeft: number;
	let canvasWRatio: number;
	let canvasHRatio: number;

	(win.onresize = () => {
		const rect = canvas.getBoundingClientRect();
		canvasTop = rect.top;
		canvasLeft = rect.left;
		canvasWRatio = canvasW / rect.width;
		canvasHRatio = canvasH / rect.height;
	})();

	// -- player state variables --

	interface VisualNote {
		key: number;
		duration: number;
		velocity: number;
		isStriking: boolean;
		timeToStrike: number;
	}

	const pressedState = new Float32Array(88);
	const activePointers = new Map<number, number>();

	// Open notes waiting for noteOff pairing to determine relative duration
	const pendingNoteOns = new Map<number, VisualNote>();

	// Active visual note segments traveling down the perspective plane
	// Structure: { keyIndex, velocity, timeToStrike, duration, isStriking }
	// All values are relative seconds <= LOOKAHEAD_SEC. Zero cumulative time.
	const activeVisualNotes: VisualNote[] = [];

	// Incoming raw events queue: elements wait until within the lookahead window
	const incomingEventQueue: nwa.MIDIEvent[] = [];

	let lastFrameTime = 0;

	// Cumulative delta delay of queued events currently waiting outside lookahead
	let cumulativeDelta = 0;

	////////////////////////////////////////
	// GL Objects Init
	////////////////////////////////////////

	/** @inline */
	const LOOKAHEAD_SEC = 2.4; // 3D perspective depth horizon in seconds

	// keyboard
	const kbdProgram = createProgram(kbdVsSource, kbdFsSource);
	const kbdUPressed = gl.getUniformLocation(kbdProgram, "u_pressed");
	const kbdUResolution = gl.getUniformLocation(kbdProgram, "u_resolution");

	// falling notes
	const notesProgram = createProgram(notesVsSource, notesFsSource);
	const notesUResolution = gl.getUniformLocation(notesProgram, 'u_resolution');
	const notesUkeyboardTop = gl.getUniformLocation(notesProgram, 'u_keyboardTopY');
	const notesUVanishingPoint = gl.getUniformLocation(notesProgram, 'u_vanishingPoint');

	// constants
	const whiteKeyW = canvasW / 52; // Total 52 white keys along the whole width
	const whiteKeyH = min(canvasH * 0.45, whiteKeyW * 5.2); // Realistic aspect ratio ~ 1:5.2, clamped safely within screen

	// Keyboard VAO
	const kbdVao = gl.createVertexArray();
	const kbdVbo = gl.createBuffer();
	gl.bindVertexArray(kbdVao);
	gl.bindBuffer(gl.ARRAY_BUFFER, kbdVbo);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 8);
	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 16);
	gl.enableVertexAttribArray(3);
	gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 24, 20);

	// 3D Notes VAO (Dynamic Stream)
	const notesVao = gl.createVertexArray();
	const notesVbo = gl.createBuffer();
	gl.bindVertexArray(notesVao);
	gl.bindBuffer(gl.ARRAY_BUFFER, notesVbo);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);

	{
		const vertices = new Float32Array(3168);
		const blackKeyW = whiteKeyW * 0.62;
		const blackKeyH = whiteKeyH * 0.64;

		let off = 0;

		function pushQuad(x0: number, y0: number, w: number, h: number, b: number, i: number, rect: number[]) {
			rect[0] = x0; rect[1] = y0; rect[2] = w; rect[3] = h;

			const x1 = x0 + w;
			const y1 = y0 + h;

			vertices.set([
				x0, y0, 0, 0, b, i,
				x1, y0, 1, 0, b, i,
				x0, y1, 0, 1, b, i,
				x0, y1, 0, 1, b, i,
				x1, y0, 1, 0, b, i,
				x1, y1, 1, 1, b, i,
			], off);

			off += 36;
		}

		// white keys first as they are behind black keys
		for (let i = 0; i < 88; i++) {
			const key = keys[i];
			const whiteIdx = key.whiteIndex;

			if (whiteIdx >= 0)
				pushQuad(whiteIdx * whiteKeyW, 0, whiteKeyW, whiteKeyH, 0, i, key.rect);
		}

		// black keys
		let nWhite = 0;

		for (let i = 0; i < 88; i++) {
			const key = keys[i];
			const whiteIdx = key.whiteIndex;

			if (whiteIdx < 0)
				pushQuad(nWhite * whiteKeyW - (blackKeyW / 2), whiteKeyH - blackKeyH, blackKeyW, blackKeyH, 1, i, key.rect);
			else
				nWhite++;
		}

		gl.bindBuffer(gl.ARRAY_BUFFER, kbdVbo);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
	}

	function updateStreamTime(dt: number) {
		cumulativeDelta = max(0, cumulativeDelta - dt);

		while (true) {
			const event = incomingEventQueue[0];
			if (event == null)
				break;

			const newDelta = cumulativeDelta + event.deltaTime;

			// If next event falls beyond the 3D visual lookahead horizon, wait
			if (newDelta > LOOKAHEAD_SEC + 1.0)
				break;

			incomingEventQueue.shift();
			cumulativeDelta = newDelta;

			const key = event.pitch - 21;
			if (key >= 0 && key < 88) {
				if (event.noteOn) {
					const note = {
						key: key,
						duration: 0.35, // Default duration if noteOff is delayed
						velocity: event.velocity,
						isStriking: false,
						timeToStrike: cumulativeDelta,
					};
					activeVisualNotes.push(note);
					pendingNoteOns.set(key, note);
				} else { // noteOff matches and sets exact note duration
					const note = pendingNoteOns.get(key);
					if (note != null) {
						note.duration = max(0.08, cumulativeDelta - note.timeToStrike);
						pendingNoteOns.delete(key);
					}
				}
			}
		}

		for (let i = 0; i < activeVisualNotes.length; i++) {
			const note = activeVisualNotes[i];
			const key = note.key;

			// Count down relative arrival time
			note.timeToStrike -= dt;

			// Check strike line contact
			if (note.timeToStrike <= 0) {
				if (!note.isStriking) {
					note.isStriking = true;
					setKeyPressed(key, 1);
				}
			}

			// Check note finish
			if (note.timeToStrike + note.duration <= 0) {
				if (note.isStriking)
					setKeyPressed(key, 0);

				activeVisualNotes.splice(i--, 1);
				continue;
			}
		}
	}

	function render(now: number) {

		////////////////////////////////////////
		// Update time frame
		////////////////////////////////////////

		const dt = min(0.1, (now - lastFrameTime) / 1000); // clamped against background-tab lags
		lastFrameTime = now;
		updateStreamTime(dt);

		// Build dynamic 3D vertices using relative countdowns
		const notesVerts: number[] = [];

		for (const note of activeVisualNotes) {
			// Compute relative distance along 3D track (0.0 = strike line, 1.0 = center horizon)
			const zStart = max(0.0, note.timeToStrike / LOOKAHEAD_SEC);
			const zEnd = min(1.0, (note.timeToStrike + note.duration) / LOOKAHEAD_SEC);

			if (zStart >= zEnd || zStart >= 1.0)
				continue;

			const key = keys[note.key];
			const [kx, , kw] = key.rect;
			const b = key.whiteIndex >= 0 ? 1 : 0;

			notesVerts.push(
				kx, 0, zStart, 0, 0, b,
				kx + kw, 0, zStart, 1, 0, b,
				kx, 0, zEnd, 0, 1, b,

				kx, 0, zEnd, 0, 1, b,
				kx + kw, 0, zStart, 1, 0, b,
				kx + kw, 0, zEnd, 1, 1, b
			);
		}

		// --- Rendering ---

		////////////////////////////////////////
		// Pass 1: Falling Notes
		////////////////////////////////////////

		const vanishingY = canvasH * 0.58; // Center of screen
		const vanishingX = canvasW * 0.50;

		gl.viewport(0, 0, canvasW, canvasH);
		gl.clearColor(0.06, 0.07, 0.09, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive luminous glow

		gl.useProgram(notesProgram);
		gl.uniform2f(notesUResolution, canvasW, canvasH);
		gl.uniform2f(notesUVanishingPoint, vanishingX, vanishingY);
		gl.uniform1f(notesUkeyboardTop, whiteKeyH);

		gl.bindVertexArray(notesVao);
		gl.bindBuffer(gl.ARRAY_BUFFER, notesVbo);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(notesVerts), gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.TRIANGLES, 0, notesVerts.length / 6);
		gl.disable(gl.BLEND);

		////////////////////////////////////////
		// Pass 2: Piano Keyboard
		////////////////////////////////////////

		gl.enable(gl.SCISSOR_TEST);
		gl.scissor(0, 0, canvasW, ceil(whiteKeyH));
		gl.viewport(0, 0, canvasW, ceil(whiteKeyH));

		gl.clearColor(0.05, 0.05, 0.07, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(kbdProgram);
		gl.uniform2f(kbdUResolution, canvasW, whiteKeyH);
		gl.uniform1fv(kbdUPressed, pressedState);

		gl.bindVertexArray(kbdVao);
		gl.drawArrays(gl.TRIANGLES, 0, 88 * 6);
		gl.disable(gl.SCISSOR_TEST);

		requestAnimationFrame(render);
	}
	function getKeyFromPos(clientX: number, clientY: number) {
		const x = (clientX - canvasLeft) * canvasWRatio;
		const y = canvasH - (clientY - canvasTop) * canvasHRatio; // inverted

		// Outside keyboard bounds
		if (y < 0 || y > whiteKeyH || x < 0 || x > canvasW)
			return -1;

		// Check black keys first (they overlap white keys)
		for (let i = 0; i < 88; i++) {
			const k = keys[i];
			if (k.whiteIndex < 0) {
				const [bx, by, bw, bh] = k.rect;
				if (x >= bx && x <= bx + bw && y >= by && y <= by + bh)
					return i;
			}
		}

		// Check white keys
		for (let i = 0; i < 88; i++) {
			const k = keys[i];
			if (k.whiteIndex >= 0) {
				const [wx, wy, ww, wh] = k.rect;
				if (x >= wx && x <= wx + ww && y >= wy && y <= wy + wh)
					return i;
			}
		}

		return -1;
	}
	function setKeyPressed(key: number, state: number) {
		if (pressedState[key] !== state) {
			pressedState[key] = state;
			audioNode.port.postMessage([state, key + 21, 80], []);
		}
	}

	canvas.onpointerup = (e) => {
		e.preventDefault();
		e.stopPropagation();

		const pointer = e.pointerId;
		const key = activePointers.get(pointer);

		if (key != null) {
			activePointers.delete(pointer);
			setKeyPressed(key, 0);
		}
	};
	canvas.onpointerdown = (e) => {
		e.preventDefault();
		e.stopPropagation();

		if (audioContext.state === "suspended")
			audioContext.resume();

		canvas.focus({
			focusVisible: false,
			preventScroll: true
		});

		const key = getKeyFromPos(e.clientX, e.clientY);
		if (key >= 0) {
			activePointers.set(e.pointerId, key);
			setKeyPressed(key, 1);
		}
	};
	canvas.onpointermove = (e) => {
		e.preventDefault();
		e.stopPropagation();

		const pointer = e.pointerId;
		const key = activePointers.get(pointer);

		if (key != null) {
			const newKey = getKeyFromPos(e.clientX, e.clientY);
			if (newKey !== key) {
				if (key >= 0)
					setKeyPressed(key, 0);
				if (newKey >= 0)
					setKeyPressed(newKey, 1);

				activePointers.set(pointer, newKey);
			}
		}
	};
	canvas.onkeyup = (e) => {
		e.preventDefault();
		e.stopPropagation();

		const pianoKey = keyMap[e.key];
		if (pianoKey != null)
			setKeyPressed(pianoKey, 0);
	}
	canvas.onkeydown = (e) => {
		e.preventDefault();
		e.stopPropagation();

		if (audioContext.state === "suspended")
			audioContext.resume();

		const pianoKey = keyMap[e.key];
		if (pianoKey != null)
			setKeyPressed(pianoKey, 1);
	};

	$("play").onclick = () => {
		if (testMidi != null) {
			const events = nwa.midi2events(testMidi);
			for (const e of events)
				incomingEventQueue.push(e);
		}
	};

	canvas.tabIndex = 1;
	render(0);
})(global);
