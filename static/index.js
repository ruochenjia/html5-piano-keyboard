"use strict"; (() => {


	// --- Audio Synthesis (Web Audio API) ---
	const AudioEngine = {
		ctx: null,
		activeNotes: new Map(),
		init() {
			if (!this.ctx) {
				const AudioContext = window.AudioContext || window.webkitAudioContext;
				this.ctx = new AudioContext();
			}
			if (this.ctx.state === 'suspended') {
				this.ctx.resume();
			}
		},
		// Note index 0 = A0 (27.5Hz), 48 = A4 (440Hz), 87 = C8 (4186Hz)
		play(keyIndex) {
			this.init();
			if (this.activeNotes.has(keyIndex)) return;

			const freq = 440 * Math.pow(2, (keyIndex - 48) / 12);
			const osc = this.ctx.createOscillator();
			const gain = this.ctx.createGain();

			// Warm electric/acoustic piano-like timbre
			osc.type = 'triangle';
			osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

			const now = this.ctx.currentTime;
			gain.gain.setValueAtTime(0, now);
			gain.gain.linearRampToValueAtTime(0.3, now + 0.008);
			gain.gain.exponentialRampToValueAtTime(0.12, now + 0.3);

			osc.connect(gain);
			gain.connect(this.ctx.destination);
			osc.start(now);

			this.activeNotes.set(keyIndex, { osc, gain });
		},
		stop(keyIndex) {
			if (!this.activeNotes.has(keyIndex)) return;
			const { osc, gain } = this.activeNotes.get(keyIndex);
			const now = this.ctx.currentTime;
			gain.gain.cancelScheduledValues(now);
			gain.gain.setValueAtTime(gain.gain.value, now);
			gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
			osc.stop(now + 0.16);
			this.activeNotes.delete(keyIndex);
		}
	};

	// --- Keyboard Data Generation ---
	// 88 keys: 0 is A0, 1 is A#0, 2 is B0, 3 is C1 ... 87 is C8
	// Semitone offsets within octave C: [C, C#, D, D#, E, F, F#, G, G#, A, A#, B]
	const IS_BLACK_PATTERN = [false, true, false, true, false, false, true, false, true, false, true, false];
	const KEYS = [];
	let whiteCounter = 0;

	for (let i = 0; i < 88; i++) {
		// Key 0 is A (index 9 in C-scale)
		const semitone = (i + 9) % 12;
		const isBlack = IS_BLACK_PATTERN[semitone];
		KEYS.push({
			index: i,
			isBlack: isBlack,
			whiteIndex: isBlack ? -1 : whiteCounter,
			rect: [0, 0, 0, 0], // [x, y, width, height] in CSS pixels
		});
		if (!isBlack) whiteCounter++;
	}
	// Total white keys: 52, total black keys: 36

	// --- WebGL 2 Shaders ---
	const vsSource = `#version 300 es
      precision mediump float;
      layout(location = 0) in vec2 a_pos;    // Key Quad vertex (pixel coords)
      layout(location = 1) in vec2 a_uv;     // Local UV [0..1]
      layout(location = 2) in float a_black; // 0.0: white, 1.0: black
      layout(location = 3) in float a_id;    // Key index [0..87]

      uniform vec2 u_resolution;
      uniform float u_pressed[88];

      out vec2 v_uv;
      out float v_isBlack;
      out float v_pressed;

      void main() {
        v_uv = a_uv;
        v_isBlack = a_black;
        v_pressed = u_pressed[int(a_id)];

        // Map pixel coords [0..W, 0..H] into clip space [-1, 1]
        // Note: Y = 0 is at bottom of viewport
        vec2 clipSpace = (a_pos / u_resolution) * 2.0 - 1.0;
        gl_Position = vec4(clipSpace, 0.0, 1.0);
      }
    `;

	const fsSource = `#version 300 es
      precision mediump float;
      in vec2 v_uv;
      in float v_isBlack;
      in float v_pressed;
      out vec4 fragColor;

      void main() {
        vec2 uv = v_uv;

        if (v_isBlack > 0.5) {
          // --- Black Key Rendering ---
          // Sleek matte bevels with high-end gloss highlight
          float bevelX = min(uv.x, 1.0 - uv.x) * 7.0;
          float bevelY = uv.y * 12.0;
          float bevel = clamp(min(bevelX, bevelY), 0.0, 1.0);

          vec3 baseColor = mix(vec3(0.04, 0.04, 0.05), vec3(0.14, 0.14, 0.16), uv.y);
          baseColor *= (0.6 + 0.4 * bevel);

          // Top spec light
          if (uv.y > 0.96 && uv.x > 0.1 && uv.x < 0.9) {
            baseColor += vec3(0.12);
          }

          // Active Press Tint (Cyan/Sapphire glow on depressed black key)
          if (v_pressed > 0.5) {
            vec3 activeGlow = vec3(0.15, 0.50, 0.95);
            baseColor = mix(baseColor, activeGlow, 0.55);
            baseColor += vec3(0.1, 0.25, 0.45) * (1.0 - uv.y);
          }

          fragColor = vec4(baseColor, 1.0);

        } else {
          // --- White Key Rendering ---
          // Ivory vertical gradient + rounded edge shadow
          float edgeDist = min(uv.x, 1.0 - uv.x);
          float sideShadow = smoothstep(0.0, 0.07, edgeDist);
          float bottomLip = smoothstep(0.0, 0.035, uv.y);

          vec3 baseColor = mix(vec3(0.92, 0.92, 0.94), vec3(0.99, 0.99, 1.0), uv.y);
          baseColor *= (0.75 + 0.25 * sideShadow);
          baseColor *= (0.65 + 0.35 * bottomLip);

          // Key side separator thin line
          if (uv.x < 0.02 || uv.x > 0.98) {
            baseColor *= 0.65;
          }

          // Active Press Tint (Clean modern blue illumination effect)
          if (v_pressed > 0.5) {
            vec3 pressedGrad = mix(vec3(0.35, 0.70, 1.0), vec3(0.75, 0.90, 1.0), uv.y);
            baseColor = mix(baseColor, pressedGrad, 0.5);
            // Simulate downward key dip
            baseColor *= (0.85 + 0.15 * uv.y);
          }

          fragColor = vec4(baseColor, 1.0);
        }
      }
    `;

	// --- WebGL Setup & Buffer Builder ---
	const canvas = document.getElementById('frame');
	const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, preserveDrawingBuffer: true });
	if (!gl) alert('WebGL 2 is required.');

	function createShader(gl, type, source) {
		const shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.error(gl.getShaderInfoLog(shader));
			gl.deleteShader(shader);
			return null;
		}
		return shader;
	}

	const program = gl.createProgram();
	gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
	gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
	gl.linkProgram(program);

	const uResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
	const uPressedLoc = gl.getUniformLocation(program, 'u_pressed');

	const vao = gl.createVertexArray();
	const vbo = gl.createBuffer();
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

	// Vertex structure: [x, y, u, v, isBlack, keyId] = 6 floats per vertex
	const STRIDE = 6 * 4;
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);

	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 2 * 4);

	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 4 * 4);

	gl.enableVertexAttribArray(3);
	gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, 5 * 4);

	// State
	const pressedState = new Float32Array(88);
	let keyboardHeight = 0;
	let canvasW = 0;
	let canvasH = 0;

	// --- Layout and Geometry Calculations ---
	function updateKeyGeometry() {
		const dpr = window.devicePixelRatio || 1;
		canvasW = canvas.width = Math.floor(window.innerWidth * dpr);
		canvasH = canvas.height = Math.floor(window.innerHeight * dpr);

		// Total 52 white keys along the whole width
		const numWhiteKeys = 52;
		const whiteKeyW = canvasW / numWhiteKeys;

		// Realistic aspect ratio ~ 1:5.2, clamped safely within screen
		keyboardHeight = Math.min(canvasH * 0.45, whiteKeyW * 5.2);

		const blackKeyW = whiteKeyW * 0.62;
		const blackKeyH = keyboardHeight * 0.64;

		const vertices = [];

		function pushQuad(x, y, w, h, isBlack, id) {
			const x0 = x, x1 = x + w;
			const y0 = y, y1 = y + h;
			// Two triangles (y=0 at keyboard base)
			const quad = [
				x0, y0, 0, 0, isBlack, id,
				x1, y0, 1, 0, isBlack, id,
				x0, y1, 0, 1, isBlack, id,
				x0, y1, 0, 1, isBlack, id,
				x1, y0, 1, 0, isBlack, id,
				x1, y1, 1, 1, isBlack, id,
			];
			vertices.push(...quad);
		}

		// 1. Calculate White Keys (drawn first)
		for (const key of KEYS) {
			if (!key.isBlack) {
				const x = key.whiteIndex * whiteKeyW;
				const y = 0; // Relative to bottom viewport
				key.rect = [x, y, whiteKeyW, keyboardHeight];
				pushQuad(x, y, whiteKeyW, keyboardHeight, 0.0, key.index);
			}
		}

		// 2. Calculate Black Keys (drawn on top)
		let currentWhiteIdx = 0;
		for (const key of KEYS) {
			if (key.isBlack) {
				// Centered over the boundary of the preceding white key
				const x = (currentWhiteIdx * whiteKeyW) - (blackKeyW / 2);
				const y = keyboardHeight - blackKeyH;
				key.rect = [x, y, blackKeyW, blackKeyH];
				pushQuad(x, y, blackKeyW, blackKeyH, 1.0, key.index);
			} else {
				currentWhiteIdx++;
			}
		}

		gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
	}

	// --- Render Loop (Scissor Restricted) ---
	function render() {
		// CRITICAL REQUIREMENT:
		// Enable SCISSOR_TEST strictly on the keyboard region.
		// Any area outside [0, 0, canvasW, keyboardHeight] remains 100% UNTOUCHED!
		gl.enable(gl.SCISSOR_TEST);
		gl.scissor(0, 0, canvasW, Math.ceil(keyboardHeight));
		gl.viewport(0, 0, canvasW, Math.ceil(keyboardHeight));

		// Clear only the keyboard area
		gl.clearColor(0.08, 0.08, 0.1, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(program);
		gl.uniform2f(uResolutionLoc, canvasW, keyboardHeight);
		gl.uniform1fv(uPressedLoc, pressedState);

		gl.bindVertexArray(vao);
		// 88 keys * 6 vertices = 528 vertices
		gl.drawArrays(gl.TRIANGLES, 0, 88 * 6);

		// Disable scissor when done
		gl.disable(gl.SCISSOR_TEST);
	}

	// --- Hit Testing ---
	function getKeyAtCoordinates(clientX, clientY) {
		const dpr = window.devicePixelRatio || 1;
		const x = clientX * dpr;
		// Invert Y to match keyboard bottom alignment
		const canvasBottomY = canvasH;
		const y = canvasBottomY - (clientY * dpr);

		// Outside keyboard bounds
		if (y < 0 || y > keyboardHeight || x < 0 || x > canvasW) {
			return -1;
		}

		// Check black keys first (they overlap white keys)
		for (let i = 0; i < KEYS.length; i++) {
			const k = KEYS[i];
			if (k.isBlack) {
				const [bx, by, bw, bh] = k.rect;
				if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
					return k.index;
				}
			}
		}

		// Check white keys
		for (let i = 0; i < KEYS.length; i++) {
			const k = KEYS[i];
			if (!k.isBlack) {
				const [wx, wy, ww, wh] = k.rect;
				if (x >= wx && x <= wx + ww && y >= wy && y <= wy + wh) {
					return k.index;
				}
			}
		}

		return -1;
	}

	// --- Touch & Mouse Event Handling ---
	const activePointers = new Map();

	function setKeyPressed(keyIndex, pressed) {
		if (keyIndex < 0 || keyIndex >= 88) return;
		if (pressed && pressedState[keyIndex] === 0.0) {
			pressedState[keyIndex] = 1.0;
			AudioEngine.play(keyIndex);
			render();
		} else if (!pressed && pressedState[keyIndex] === 1.0) {
			pressedState[keyIndex] = 0.0;
			AudioEngine.stop(keyIndex);
			render();
		}
	}

	function onPointerDown(e) {
		const keyIndex = getKeyAtCoordinates(e.clientX, e.clientY);
		if (keyIndex !== -1) {
			activePointers.set(e.pointerId, keyIndex);
			setKeyPressed(keyIndex, true);
		}
	}

	function onPointerMove(e) {
		if (!activePointers.has(e.pointerId)) return;
		const prevKey = activePointers.get(e.pointerId);
		const newKey = getKeyAtCoordinates(e.clientX, e.clientY);

		if (newKey !== prevKey) {
			if (prevKey !== -1) setKeyPressed(prevKey, false);
			if (newKey !== -1) setKeyPressed(newKey, true);
			activePointers.set(e.pointerId, newKey);
		}
	}

	function onPointerUp(e) {
		if (activePointers.has(e.pointerId)) {
			const keyIndex = activePointers.get(e.pointerId);
			setKeyPressed(keyIndex, false);
			activePointers.delete(e.pointerId);
		}
	}

	window.addEventListener('pointerdown', onPointerDown);
	window.addEventListener('pointermove', onPointerMove);
	window.addEventListener('pointerup', onPointerUp);
	window.addEventListener('pointercancel', onPointerUp);

	// window.addEventListener('resize', () => {
	// 	updateKeyGeometry();
	// 	render();
	// });

	// // Initial setup
	updateKeyGeometry();
	render();


})();
