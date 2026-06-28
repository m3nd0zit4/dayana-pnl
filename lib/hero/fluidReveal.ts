/**
 * WebGL fluid-reveal effect for the hero.
 *
 * Ported faithfully from the hand-coded vanilla build on mohamedshehata.net
 * (adapted, in turn, from "three-skull" by cullenwebber). Browser-only — call
 * from a client component inside `useEffect`. Returns a teardown function.
 *
 * Mechanic: a warm BASE image is mixed with a B&W REVEAL image by a fluid "ink"
 * mask. The mask is a 512² ping-pong simulation: each frame an FBM-displaced
 * neighbour `min()` spreads the ink, the pointer paints fresh ink via a 2D trail
 * canvas, and everything fades back toward white (= base fully visible).
 */

export type FluidRevealOptions = {
  baseSrc: string;
  /** One or more B&W frames; cycled ~3fps for a subtle "living portrait". */
  seqSrcs: string[];
  maxDpr?: number;
  /** Fired once the base texture is ready and the first frame can render. */
  onReady?: () => void;
};

type Img = { tex: WebGLTexture; w: number; h: number };

const VS = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main(){
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

// Fluid simulation step. White = base visible, black = reveal visible.
const SIM_FS = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_prev;
  uniform sampler2D u_trail;
  uniform vec2 u_res;
  uniform float u_time;

  float hash(vec2 p){
    p = fract(p * vec2(234.34,435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }
  float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(
      mix(hash(i),           hash(i+vec2(1.0,0.0)), f.x),
      mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p){
    float v=0.0; float a=0.5;
    for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.0; a*=0.5; }
    return v;
  }

  void main(){
    vec2 px = 1.0 / u_res;
    float disp = fbm(v_uv * 3.5 + u_time * 0.12) * 2.0 - 1.0;
    vec2 off = vec2(disp) * px * 4.5;

    float c  = texture2D(u_prev, v_uv + off).r;
    float cN = texture2D(u_prev, v_uv + vec2(0.0, px.y) + off).r;
    float cS = texture2D(u_prev, v_uv - vec2(0.0, px.y) + off).r;
    float cE = texture2D(u_prev, v_uv + vec2(px.x, 0.0) + off).r;
    float cW = texture2D(u_prev, v_uv - vec2(px.x, 0.0) + off).r;

    float blended = min(c, min(min(cN,cS), min(cE,cW)));

    float ink = 1.0 - texture2D(u_trail, v_uv).r;
    blended = min(blended, 1.0 - ink * 0.96);

    blended += 0.005;
    gl_FragColor = vec4(vec3(clamp(blended,0.0,1.0)), 1.0);
  }
`;

// Final composite: warm base × B&W reveal, mixed by fluid mask + bottom vignette.
const COMP_FS = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_base;
  uniform sampler2D u_reveal;
  uniform sampler2D u_reveal2;
  uniform float u_revMix;
  uniform sampler2D u_fluid;
  uniform vec2 u_baseSize;
  uniform vec2 u_revealSize;
  uniform vec2 u_canvas;

  vec2 coverUV(vec2 uv, vec2 img, vec2 cvs){
    float ia = img.x / img.y;
    float ca = cvs.x / cvs.y;
    vec2 s = (ia > ca) ? vec2(ca/ia, 1.0) : vec2(1.0, ia/ca);
    vec2 fuv = vec2(uv.x, 1.0 - uv.y);
    return (fuv - 0.5) * s + 0.5;
  }

  void main(){
    vec2 baseUV   = coverUV(v_uv, u_baseSize, u_canvas);
    vec2 revealUV = coverUV(v_uv, u_revealSize, u_canvas);

    vec3 base = texture2D(u_base, baseUV).rgb;

    vec3 rev = mix(texture2D(u_reveal, revealUV).rgb, texture2D(u_reveal2, revealUV).rgb, u_revMix);
    float lum = dot(rev, vec3(0.299, 0.587, 0.114));
    lum = clamp((lum - 0.5) * 1.18 + 0.5, 0.0, 1.0);
    // Lighter, clearer terracotta duotone — lifted shadows keep detail legible;
    // still warm/saturated enough to read against the cream base.
    vec3 duoLow  = vec3(0.18, 0.11, 0.085);
    vec3 duoHigh = vec3(0.98, 0.68, 0.5);
    rev = mix(duoLow, duoHigh, lum);

    float mask = texture2D(u_fluid, v_uv).r;
    vec3 color = mix(rev, base, mask);

    float vf = max(0.0, 1.0 - v_uv.y / 0.65);
    float va = vf * vf * 0.76;
    color = mix(color, vec3(17.0/255.0), va);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const SIM_W = 512;
const SIM_H = 512;

export function initFluidReveal(
  canvas: HTMLCanvasElement,
  heroEl: HTMLElement,
  { baseSrc, seqSrcs, maxDpr = 1.5, onReady }: FluidRevealOptions
): () => void {
  const noop = () => {};

  // Size the drawing buffer BEFORE creating GL objects (resizing the canvas
  // after context creation resets all GL state).
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  canvas.width = Math.round((heroEl.clientWidth || window.innerWidth) * dpr);
  canvas.height = Math.round((heroEl.clientHeight || window.innerHeight) * dpr);

  const ctxOpts: WebGLContextAttributes = { alpha: true, antialias: false, depth: false };
  const gl =
    (canvas.getContext("webgl", ctxOpts) as WebGLRenderingContext | null) ??
    (canvas.getContext("experimental-webgl", ctxOpts) as WebGLRenderingContext | null);
  if (!gl) return noop;

  // ── Offscreen 2D trail canvas (sim resolution) ──
  const trailCanvas = document.createElement("canvas");
  trailCanvas.width = SIM_W;
  trailCanvas.height = SIM_H;
  const tc = trailCanvas.getContext("2d");
  if (!tc) return noop;

  const LWIDTH = SIM_W * 0.2;

  let trailX = -1;
  let trailY = -1;
  let rawX = -1;
  let rawY = -1;
  let hasPos = false;

  // ── Shader helpers ──
  function compile(type: number, src: string): WebGLShader | null {
    const s = gl!.createShader(type);
    if (!s) return null;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
      console.error("[fluid] shader:", gl!.getShaderInfoLog(s));
      gl!.deleteShader(s);
      return null;
    }
    return s;
  }
  function linkProg(vsSrc: string, fsSrc: string): WebGLProgram | null {
    const vs = compile(gl!.VERTEX_SHADER, vsSrc);
    const fs = compile(gl!.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl!.createProgram();
    if (!p) return null;
    gl!.attachShader(p, vs);
    gl!.attachShader(p, fs);
    gl!.linkProgram(p);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) {
      console.error("[fluid] program:", gl!.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  const simProg = linkProg(VS, SIM_FS);
  const compProg = linkProg(VS, COMP_FS);
  if (!simProg || !compProg) return noop;

  // ── Fullscreen quad ──
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  function bindQuad(prog: WebGLProgram) {
    const loc = gl!.getAttribLocation(prog, "a_pos");
    gl!.bindBuffer(gl!.ARRAY_BUFFER, quadBuf);
    gl!.enableVertexAttribArray(loc);
    gl!.vertexAttribPointer(loc, 2, gl!.FLOAT, false, 0, 0);
  }

  // ── FBO helpers ──
  function makeFBO(w: number, h: number) {
    const tex = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    const fbo = gl!.createFramebuffer();
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  let fboA = makeFBO(SIM_W, SIM_H);
  let fboB = makeFBO(SIM_W, SIM_H);
  function clearFBO(fbo: { fbo: WebGLFramebuffer | null }) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo.fbo);
    gl!.clearColor(1, 1, 1, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  }
  clearFBO(fboA);
  clearFBO(fboB);

  const trailTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, trailTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIM_W, SIM_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // ── Image texture loader (reuse an already-decoded DOM <img> when present) ──
  function uploadTex(tex: WebGLTexture, img: TexImageSource) {
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, img);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
  }
  function loadTex(src: string): Promise<Img | null> {
    return new Promise((resolve) => {
      const tex = gl!.createTexture();
      if (!tex) return resolve(null);
      const file = src.split("/").pop() ?? src;
      const domImg = document.querySelector<HTMLImageElement>(`img[src*="${file}"]`);
      if (domImg && domImg.complete && domImg.naturalWidth) {
        try {
          uploadTex(tex, domImg);
          return resolve({ tex, w: domImg.naturalWidth, h: domImg.naturalHeight });
        } catch {
          /* fall through */
        }
      }
      const img = new Image();
      img.onload = () => {
        try {
          uploadTex(tex, img);
          resolve({ tex, w: img.naturalWidth, h: img.naturalHeight });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // ── Pointer tracking ──
  const onMove = (e: MouseEvent) => {
    const r = heroEl.getBoundingClientRect();
    rawX = (e.clientX - r.left) / r.width;
    rawY = (e.clientY - r.top) / r.height;
    hasPos = true;
  };
  const onLeave = () => {
    hasPos = false;
    trailX = -1;
    trailY = -1;
  };
  heroEl.addEventListener("mousemove", onMove);
  heroEl.addEventListener("mouseleave", onLeave);

  // ── Uniform locations ──
  const simU = {
    prev: gl.getUniformLocation(simProg, "u_prev"),
    trail: gl.getUniformLocation(simProg, "u_trail"),
    res: gl.getUniformLocation(simProg, "u_res"),
    time: gl.getUniformLocation(simProg, "u_time"),
  };
  const compU = {
    base: gl.getUniformLocation(compProg, "u_base"),
    reveal: gl.getUniformLocation(compProg, "u_reveal"),
    reveal2: gl.getUniformLocation(compProg, "u_reveal2"),
    revMix: gl.getUniformLocation(compProg, "u_revMix"),
    fluid: gl.getUniformLocation(compProg, "u_fluid"),
    baseSize: gl.getUniformLocation(compProg, "u_baseSize"),
    revealSize: gl.getUniformLocation(compProg, "u_revealSize"),
    canvas: gl.getUniformLocation(compProg, "u_canvas"),
  };

  // ── State + lifecycle ──
  let base: Img | null = null;
  let seqFrames: Img[] = [];
  // Hover gallery: crossfade through the reveal frames, advancing only while the
  // pointer is over the hero (hold → fade → next).
  let gCur = 0;
  let gMix = 0;
  let gTimer = 0;
  let lastTs = 0;
  const G_HOLD = 0.32;
  const G_FADE = 0.26;
  let t0: number | null = null;
  let rafId = 0;
  let running = false;
  let disposed = false;

  function step(ts: number) {
    if (disposed) return;
    rafId = requestAnimationFrame(step);
    if (!base) return;
    if (t0 === null) t0 = ts;
    const t = (ts - t0) * 0.001;

    const frames = seqFrames.length ? seqFrames : [base];
    if (hasPos && frames.length > 1) {
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
      gTimer += dt;
      if (gTimer <= G_HOLD) gMix = 0;
      else if (gTimer <= G_HOLD + G_FADE) gMix = (gTimer - G_HOLD) / G_FADE;
      else {
        gCur = (gCur + 1) % frames.length;
        gMix = 0;
        gTimer = 0;
      }
    }
    lastTs = ts;
    const revealCur = frames[gCur % frames.length];
    const revealNext = frames[(gCur + 1) % frames.length];

    // 1 · trail canvas
    tc!.fillStyle = "#ffffff";
    tc!.fillRect(0, 0, SIM_W, SIM_H);
    if (hasPos) {
      const LERP = 0.2;
      if (trailX < 0) {
        trailX = rawX;
        trailY = rawY;
      } else {
        trailX += (rawX - trailX) * LERP;
        trailY += (rawY - trailY) * LERP;
      }
      const sx = trailX * SIM_W;
      const sy = (1 - trailY) * SIM_H;
      const rx = rawX * SIM_W;
      const ry = (1 - rawY) * SIM_H;
      tc!.strokeStyle = "#000000";
      tc!.lineWidth = LWIDTH;
      tc!.lineCap = "round";
      tc!.lineJoin = "round";
      tc!.beginPath();
      tc!.moveTo(sx, sy);
      tc!.lineTo(rx, ry);
      tc!.stroke();
      tc!.fillStyle = "#000000";
      tc!.beginPath();
      tc!.arc(rx, ry, LWIDTH * 0.55, 0, Math.PI * 2);
      tc!.fill();
    } else {
      // Ambient drift — two slow, soft ink blobs keep the portrait breathing
      // even with no pointer, so the fluid "runs in the background" on load.
      const a1x = (0.5 + 0.26 * Math.sin(t * 0.26)) * SIM_W;
      const a1y = (0.5 + 0.20 * Math.cos(t * 0.31)) * SIM_H;
      const a2x = (0.5 + 0.30 * Math.sin(t * 0.17 + 2.1)) * SIM_W;
      const a2y = (0.5 + 0.24 * Math.cos(t * 0.21 + 1.0)) * SIM_H;
      tc!.fillStyle = "rgba(0,0,0,0.34)";
      tc!.beginPath();
      tc!.arc(a1x, a1y, LWIDTH * 0.46, 0, Math.PI * 2);
      tc!.fill();
      tc!.beginPath();
      tc!.arc(a2x, a2y, LWIDTH * 0.36, 0, Math.PI * 2);
      tc!.fill();
    }
    gl!.bindTexture(gl!.TEXTURE_2D, trailTex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, trailCanvas);

    // 2 · sim step (read fboA → write fboB)
    gl!.useProgram(simProg);
    bindQuad(simProg!);
    gl!.viewport(0, 0, SIM_W, SIM_H);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fboB.fbo);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, fboA.tex);
    gl!.uniform1i(simU.prev, 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, trailTex);
    gl!.uniform1i(simU.trail, 1);
    gl!.uniform2f(simU.res, SIM_W, SIM_H);
    gl!.uniform1f(simU.time, t);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    const tmp = fboA;
    fboA = fboB;
    fboB = tmp;

    // 3 · composite to screen
    gl!.useProgram(compProg);
    bindQuad(compProg!);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, base.tex);
    gl!.uniform1i(compU.base, 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, revealCur.tex);
    gl!.uniform1i(compU.reveal, 1);
    gl!.activeTexture(gl!.TEXTURE3);
    gl!.bindTexture(gl!.TEXTURE_2D, revealNext.tex);
    gl!.uniform1i(compU.reveal2, 3);
    gl!.uniform1f(compU.revMix, gMix);
    gl!.activeTexture(gl!.TEXTURE2);
    gl!.bindTexture(gl!.TEXTURE_2D, fboA.tex);
    gl!.uniform1i(compU.fluid, 2);
    gl!.uniform2f(compU.baseSize, base.w, base.h);
    gl!.uniform2f(compU.revealSize, revealCur.w, revealCur.h);
    gl!.uniform2f(compU.canvas, canvas.width, canvas.height);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }

  function start() {
    if (running || disposed || !base) return;
    running = true;
    rafId = requestAnimationFrame(step);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  // Pause the loop while the hero is scrolled out of view (battery / GPU).
  const io = new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting) start();
      else stop();
    },
    { threshold: 0 }
  );
  io.observe(heroEl);

  // Load reveal frames in the background; they do NOT gate first paint.
  seqSrcs.forEach((p) =>
    loadTex(p).then((tex) => {
      if (tex && !disposed) seqFrames.push(tex);
    })
  );

  // Base load unlocks rendering.
  loadTex(baseSrc).then((loaded) => {
    if (disposed) return;
    base = loaded;
    if (!base) {
      console.warn("[fluid] base image failed — static fallback active.");
      return;
    }
    if (seqFrames.length === 0) seqFrames = [base];
    onReady?.();
    start();
  });

  return function destroy() {
    disposed = true;
    stop();
    io.disconnect();
    heroEl.removeEventListener("mousemove", onMove);
    heroEl.removeEventListener("mouseleave", onLeave);
    const lose = gl!.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  };
}
