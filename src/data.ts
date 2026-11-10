import { Array } from "@nettleweb/core/intrinsics";

export const kbdVsSource: string = /*glsl*/ `#version 300 es
  precision mediump float;
  layout(location = 0) in vec2 a_pos;
  layout(location = 1) in vec2 a_uv;
  layout(location = 2) in float a_black;
  layout(location = 3) in float a_id;

  uniform vec2 u_resolution;
  uniform float u_pressed[88];

  out vec2 v_uv;
  out float v_isBlack;
  out float v_pressed;

  void main() {
    v_uv = a_uv;
    v_isBlack = a_black;
    v_pressed = u_pressed[int(a_id)];
    vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`;

export const kbdFsSource: string = /*glsl*/ `#version 300 es
  precision mediump float;
  in vec2 v_uv;
  in float v_isBlack;
  in float v_pressed;
  out vec4 fragColor;

  void main() {
    vec2 uv = v_uv;
    if (v_isBlack > 0.5) {
      float bevel = clamp(min(min(uv.x, 1.0 - uv.x) * 8.0, uv.y * 12.0), 0.0, 1.0);
      vec3 col = mix(vec3(0.04, 0.04, 0.05), vec3(0.15, 0.15, 0.18), uv.y) * (0.6 + 0.4 * bevel);
      if (uv.y > 0.96 && uv.x > 0.1 && uv.x < 0.9) col += vec3(0.15);
      if (v_pressed > 0.5) col = mix(col, vec3(0.95, 0.25, 0.65), 0.7); // Magenta glow on press
      fragColor = vec4(col, 1.0);
    } else {
      float edgeDist = min(uv.x, 1.0 - uv.x);
      float sideShadow = smoothstep(0.0, 0.06, edgeDist);
      float bottomLip = smoothstep(0.0, 0.035, uv.y);
      vec3 col = mix(vec3(0.90, 0.90, 0.92), vec3(0.99, 0.99, 1.0), uv.y);
      col *= (0.75 + 0.25 * sideShadow) * (0.65 + 0.35 * bottomLip);
      if (uv.x < 0.02 || uv.x > 0.98) col *= 0.6;
      if (v_pressed > 0.5) {
        col = mix(col, vec3(0.2, 0.65, 1.0), 0.55); // Cyan glow on press
        col *= (0.85 + 0.15 * uv.y);
      }
      fragColor = vec4(col, 1.0);
    }
  }
`;

export const notesVsSource: string = /*glsl*/ `#version 300 es
  precision mediump float;
  // World: x in [0..canvasW], y: 0 is strike line, z in [0..1] where 1 is horizon center
  layout(location = 0) in vec3 a_worldPos;
  layout(location = 1) in vec2 a_uv;
  layout(location = 2) in float a_isBlack;

  uniform vec2 u_resolution;
  uniform vec2 u_vanishingPoint; // Center of screen
  uniform float u_keyboardTopY;  // Screen Y of strike line

  out vec2 v_uv;
  out float v_depth;
  out float v_isBlack;

  void main() {
    v_uv = a_uv;
    v_isBlack = a_isBlack;
    float z = a_worldPos.z;
    v_depth = z;

    // Star Wars perspective interpolation towards vanishing point
    // z = 0 is directly at keyboard top; z = 1 is deep at the center
    float persp = 1.0 / (1.0 + z * 3.5);
    float screenX = mix(u_vanishingPoint.x, a_worldPos.x, persp);
    float screenY = mix(u_vanishingPoint.y, u_keyboardTopY, persp);

    vec2 clip = (vec2(screenX, screenY) / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`;

export const notesFsSource: string = /*glsl*/ `#version 300 es
  precision mediump float;
  in vec2 v_uv;
  in float v_depth;
  in float v_isBlack;
  out vec4 fragColor;

  void main() {
    // Elegant neon styling with glowing edges
    vec3 baseColor = (v_isBlack > 0.5) ? vec3(0.95, 0.2, 0.6) : vec3(0.0, 0.75, 1.0);

    float borderDist = min(v_uv.x, 1.0 - v_uv.x);
    float edgeGlow = smoothstep(0.0, 0.15, borderDist);
    vec3 col = mix(vec3(1.0), baseColor, edgeGlow * 0.8 + 0.2);

    // Fade into distance (vanishing point atmospheric haze)
    float distanceFade = clamp(1.0 - pow(v_depth, 1.5), 0.0, 1.0);
    float alpha = distanceFade * 0.92;

    fragColor = vec4(col, alpha);
  }
`;

export const keyMap: Record<string, number> = {
	"`": 27, "1": 28, "2": 29, "3": 30, "4": 31, "5": 32, "6": 33, "7": 34, "8": 35, "9": 36, "0": 37, "-": 38, "=": 39, "Backspace": 40,
	"Tab": 41, "q": 42, "w": 43, "e": 44, "r": 45, "t": 46, "y": 47, "u": 48, "i": 49, "o": 50, "p": 51, "[": 52, "]": 53, "\\": 54,
	"a": 55, "s": 56, "d": 57, "f": 58, "g": 59, "h": 60, "j": 61, "k": 62, "l": 63, ";": 64, "'": 65, "Enter": 66,
	"z": 67, "x": 68, "c": 69, "v": 70, "b": 71, "n": 72, "m": 73, ",": 74, ".": 75, "/": 76, "Shift": 77, " ": 78
};

export const keys: {
	readonly rect: [number, number, number, number]; // x, y, width, height
	readonly whiteIndex: number; // -1 if is black
}[] = new Array(88);

// initialize keys data
const is_black = [false, true, false, true, false, false, true, false, true, false, true, false];
let white_idx = 0;

for (let i = 0; i < 88; i++) {
	const semitone = (i + 9) % 12; // key 0 is A0
	keys[i] = {
		rect: [0, 0, 0, 0],
		whiteIndex: is_black[semitone] ? -1 : white_idx++
	};
}

const { log, error } = console;
export {
	log as _log,
	error as _error
};
