/* Gravity Theatre — a small, dependency-free instrument for imaginary galaxies. */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const SCENES = ['spiral', 'collision', 'blackhole', 'nebula', 'supernova'];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;

  function randomGenerator(seed) {
    let n = seed >>> 0;
    return function () {
      n += 0x6D2B79F5;
      let t = n;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  class GravityEngine {
    constructor(canvas, options) {
      if (!canvas || typeof canvas.getContext !== 'function') throw new Error('A canvas is required.');
      this.canvas = canvas;
      this.options = options || {};
      this.scene = 'spiral';
      this.parameters = { gravity: 1, speed: 0.65, glow: 1 };
      this.camera = { yaw: -0.12, pitch: 0.91, roll: -0.39, distance: 9.3 };
      this.seed = 740281;
      this.time = 0;
      this.paused = false;
      this.autoRotate = true;
      this.tool = 'attract';
      this.pointer = { down: false, x: 0, y: 0, px: 0, py: 0, id: null };
      this.destroyed = false;
      this.contextLost = false;
      this.frameCount = 0;
      this.frameTime = 0;
      this.stats = { fps: 60, count: 0, energy: 0 };
      this.listeners = [];
      this.lastTime = 0;
      this.dpr = 1;
      this.width = 1;
      this.height = 1;
      this.canvas.style.touchAction = 'none';
      this._initRenderer();
      this._bindEvents();
      this._resize();
      this._generate();
      this._frame = this._frame.bind(this);
      this.raf = requestAnimationFrame(this._frame);
    }

    _error(message) {
      if (typeof this.options.onError === 'function') this.options.onError(message);
    }

    _initRenderer() {
      const settings = { alpha: false, antialias: false, depth: false, stencil: false,
        preserveDrawingBuffer: true, powerPreference: 'high-performance' };
      let gl;
      try { gl = this.canvas.getContext('webgl', settings); } catch (_) { gl = null; }
      if (!gl) {
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        if (!this.ctx) throw new Error('This browser cannot initialize a canvas renderer.');
        this.renderer = 'canvas';
        this._makeSprites();
        return;
      }
      this.gl = gl;
      this.renderer = 'webgl';
      const vertex = `
        precision highp float;
        attribute vec3 aPosition;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform vec2 uResolution;
        uniform vec2 uCenter;
        uniform vec3 uCamera;
        uniform float uDistance;
        uniform float uDpr;
        uniform float uGlow;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float cy = cos(uCamera.x), sy = sin(uCamera.x);
          float cx = cos(uCamera.y), sx = sin(uCamera.y);
          float cr = cos(uCamera.z), sr = sin(uCamera.z);
          vec3 p = aPosition;
          p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
          p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
          p.xy = vec2(p.x * cr - p.y * sr, p.x * sr + p.y * cr);
          float depth = max(1.0, uDistance - p.z);
          float scale = min(uResolution.x, uResolution.y) * 1.19 / depth;
          vec2 pixel = uCenter + vec2(p.x, -p.y) * scale;
          gl_Position = vec4(pixel.x / uResolution.x * 2.0 - 1.0,
            1.0 - pixel.y / uResolution.y * 2.0, 0.0, 1.0);
          gl_PointSize = clamp(aSize * uDpr * 9.0 / depth * (0.83 + uGlow * 0.17), 0.7, 180.0 * uDpr);
          vColor = aColor;
          vAlpha = aAlpha * uGlow;
        }
      `;
      const fragment = `
        precision mediump float;
        varying vec3 vColor;
        varying float vAlpha;
        uniform vec2 uHoleCenter;
        uniform float uHoleRadius;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p,p);
          if (r2 > 1.0) discard;
          float halo = exp(-r2 * 4.7) * 0.38;
          float core = exp(-r2 * 24.0) * 0.76;
          float edge = 1.0 - smoothstep(0.72, 1.0, r2);
          float hole = uHoleRadius > 0.0 ? smoothstep(uHoleRadius - 1.0, uHoleRadius + 2.0,
            distance(gl_FragCoord.xy, uHoleCenter)) : 1.0;
          gl_FragColor = vec4(vColor * (halo + core) * edge * vAlpha * hole, 1.0);
        }
      `;
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const message = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error(message || 'Particle shader failed.');
        }
        return shader;
      };
      const vs = compile(gl.VERTEX_SHADER, vertex);
      const fs = compile(gl.FRAGMENT_SHADER, fragment);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vs);
      gl.attachShader(this.program, fs);
      gl.linkProgram(this.program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Particle renderer could not start.');
      gl.useProgram(this.program);
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      const attributes = [['aPosition', 3, 0], ['aColor', 3, 12], ['aSize', 1, 24], ['aAlpha', 1, 28]];
      attributes.forEach(([name, size, offset]) => {
        const loc = gl.getAttribLocation(this.program, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, offset);
      });
      this.uniforms = {};
      ['uResolution', 'uCenter', 'uCamera', 'uDistance', 'uDpr', 'uGlow', 'uHoleCenter', 'uHoleRadius'].forEach(name => {
        this.uniforms[name] = gl.getUniformLocation(this.program, name);
      });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0.012, 0.019, 0.027, 1);
    }

    _makeSprites() {
      this.sprites = [];
      const colors = [[255, 223, 182], [255, 144, 80], [111, 207, 230], [163, 183, 255], [245, 246, 231], [119, 176, 152]];
      colors.forEach(color => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, `rgba(${color},1)`);
        g.addColorStop(0.13, `rgba(${color},0.72)`);
        g.addColorStop(0.38, `rgba(${color},0.19)`);
        g.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        this.sprites.push(c);
      });
    }

    _listen(target, event, callback, opts) {
      target.addEventListener(event, callback, opts);
      this.listeners.push(() => target.removeEventListener(event, callback, opts));
    }

    _bindEvents() {
      this._listen(window, 'resize', () => this._resize());
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => this._resize());
        this.observer.observe(this.canvas);
      }
      const location = event => {
        const rect = this.canvas.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
      };
      this._listen(this.canvas, 'pointerdown', event => {
        if (event.button !== 0 || this.pointer.down) return;
        const [x, y] = location(event);
        Object.assign(this.pointer, { down: true, x, y, px: x, py: y, id: event.pointerId });
        try { this.canvas.setPointerCapture(event.pointerId); } catch (_) { /* detached canvas */ }
      });
      this._listen(this.canvas, 'pointermove', event => {
        if (this.pointer.down && event.pointerId !== this.pointer.id) return;
        const [x, y] = location(event);
        if (this.pointer.down && this.tool === 'orbit') {
          this.camera.yaw += (x - this.pointer.x) * 0.006;
          this.camera.pitch = clamp(this.camera.pitch + (y - this.pointer.y) * 0.006, -1.48, 1.48);
        }
        this.pointer.px = this.pointer.x;
        this.pointer.py = this.pointer.y;
        this.pointer.x = x;
        this.pointer.y = y;
      });
      const release = event => {
        if (event.pointerId !== this.pointer.id) return;
        this.pointer.down = false;
        try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) { /* already released */ }
        this.pointer.id = null;
      };
      this._listen(this.canvas, 'pointerup', release);
      this._listen(this.canvas, 'pointercancel', release);
      this._listen(this.canvas, 'lostpointercapture', () => { this.pointer.down = false; this.pointer.id = null; });
      this._listen(this.canvas, 'wheel', event => {
        event.preventDefault();
        this.camera.distance = clamp(this.camera.distance * Math.exp(clamp(event.deltaY, -200, 200) * 0.0009), 5.5, 17);
      }, { passive: false });
      this._listen(this.canvas, 'webglcontextlost', event => {
        event.preventDefault();
        this.contextLost = true;
        this._error('图形上下文暂时中断，正在等待浏览器恢复。');
      });
      this._listen(this.canvas, 'webglcontextrestored', () => {
        if (this.destroyed) return;
        try {
          this._initRenderer();
          this.contextLost = false;
          this._resize();
        } catch (error) { this._error(error.message); }
      });
    }

    _resize() {
      if (this.destroyed) return;
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, rect.width || window.innerWidth);
      this.height = Math.max(1, rect.height || window.innerHeight);
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const w = Math.round(this.width * this.dpr);
      const h = Math.round(this.height * this.dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.centerX = this.width * (this.width <= 900 ? 0.5 : 0.60);
      this.centerY = this.height * (this.width <= 900 ? 0.53 : 0.48);
      if (this.gl && !this.contextLost) this.gl.viewport(0, 0, w, h);
    }

    _generate() {
      const rand = randomGenerator(this.seed);
      const normal = () => Math.sqrt(-2 * Math.log(Math.max(0.00001, rand()))) * Math.cos(TAU * rand());
      const particles = [];
      const add = (x, y, z, color, size, alpha, speed, group) => {
        particles.push({ x, y, z, color, size, alpha, speed, group: group || 0,
          ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0, phase: rand() * TAU });
      };
      // A fixed far-field canopy gives depth without distracting from the formation.
      for (let i = 0; i < 1100; i++) {
        add((rand() - 0.5) * 32, (rand() - 0.5) * 22, -9 - rand() * 9,
          rand() < 0.68 ? [0.68, 0.77, 0.80] : [0.98, 0.72, 0.45],
          1.2 + Math.pow(rand(), 8) * 4.5, 0.2 + rand() * 0.6, 0, -1);
      }
      this.backgroundCount = particles.length;
      const count = this.renderer === 'canvas' ? 9000 : 16500;
      if (this.scene === 'spiral' || this.scene === 'collision') {
        const collision = this.scene === 'collision';
        for (let i = 0; i < count; i++) {
          const group = collision ? (i % 2 === 0 ? 1 : 2) : 0;
          const core = rand() < 0.23;
          const radius = core ? Math.pow(rand(), 1.5) * 1.28 : Math.pow(rand(), 0.62) * 4.55 + 0.16;
          const arm = Math.floor(rand() * 2);
          const angle = core ? rand() * TAU : radius * 1.38 + arm * Math.PI + normal() * (0.13 + 0.22 / (radius + 0.2));
          const branch = !core && rand() < 0.16 ? Math.sin(radius * 2.8) * 0.26 : 0;
          const radiusJitter = radius + normal() * 0.065;
          let x = Math.cos(angle + branch) * radiusJitter;
          let y = Math.sin(angle + branch) * radiusJitter;
          let z = normal() * (core ? 0.20 : 0.055 + radius * 0.011);
          if (collision) { x *= 0.65; y *= 0.65; z *= 0.65; }
          const t = clamp(radius / 4.8, 0, 1);
          let color = core ? [1, 0.86 + rand() * 0.11, 0.65 + rand() * 0.2]
            : rand() < t * 0.85 ? [0.30 + rand() * 0.22, 0.66 + rand() * 0.25, 0.86 + rand() * 0.14]
            : [1, mix(0.59, 0.82, t), mix(0.31, 0.62, t)];
          if (collision && group === 2) color = [color[2] * 0.8, color[1], Math.max(0.7, color[0])];
          const rare = rand();
          add(x, y, z, color, rare > 0.993 ? 7 + rand() * 5 : 1.1 + rand() * 2.35,
            core ? 0.45 + rand() * 0.3 : 0.38 + rand() * 0.5, (0.048 + 0.14 / (radius + 1)), group);
        }
        // Large, quiet particles make the dust luminous while keeping individual stars sharp.
        for (let i = 0; i < 380; i++) {
          const r = Math.pow(rand(), 0.7) * 4.2;
          const angle = r * 1.38 + (i % 2) * Math.PI + normal() * 0.14;
          const group = collision ? (i % 2 ? 1 : 2) : 0;
          const s = collision ? 0.65 : 1;
          add(Math.cos(angle) * r * s, Math.sin(angle) * r * s, normal() * 0.07,
            r < 1.6 ? [1, 0.68, 0.35] : [0.26, 0.61, 0.72],
            36 + rand() * 62, 0.027 + rand() * 0.027, 0.048 + 0.14 / (r + 1), group);
        }
        for (let i = 0; i < (collision ? 36 : 24); i++) {
          add(normal() * 0.11, normal() * 0.11, normal() * 0.04,
            [1, 0.77, 0.44], 70 + rand() * 100, 0.045,
            0.08, collision ? (i % 2 ? 1 : 2) : 0);
        }
      } else if (this.scene === 'blackhole') {
        for (let i = 0; i < count; i++) {
          const r = 1.02 + Math.pow(rand(), 1.55) * 3.9;
          const a = rand() * TAU + r * 2;
          const hot = Math.exp(-(r - 1.25) * (r - 1.25) * 3);
          const color = [1, 0.25 + hot * 0.64 + rand() * 0.12, 0.08 + hot * 0.51];
          add(Math.cos(a) * r, Math.sin(a) * r, normal() * (0.025 + r * 0.008), color,
            1.2 + rand() * 2.3, 0.30 + hot * 0.55, 0.12 + 0.7 / (r * r + 0.5));
        }
        for (let i = 0; i < 260; i++) {
          const r = 1.15 + rand() * 2.8, a = rand() * TAU;
          add(Math.cos(a) * r, Math.sin(a) * r, 0, [1, 0.32, 0.07],
            35 + rand() * 65, 0.055, 0.12 + 0.7 / (r * r + 0.5));
        }
        // The lensed photon ring stays in the camera plane and encloses absolute darkness.
        for (let i = 0; i < 850; i++) {
          const a = rand() * TAU, r = 0.67 + Math.abs(normal()) * 0.026;
          add(Math.cos(a) * r, Math.sin(a) * r, 0, [1, 0.79, 0.48],
            1.5 + rand() * 2, 0.6, 0, 3);
        }
      } else if (this.scene === 'nebula') {
        for (let i = 0; i < count; i++) {
          const t = rand() * TAU;
          const ribbon = i % 3;
          const radius = 2.3 + 0.8 * Math.sin(t * 3 + ribbon);
          const x = Math.cos(t) * radius + normal() * 0.57;
          const y = Math.sin(t) * radius * 0.8 + normal() * 0.55;
          const z = Math.sin(t * 2 + ribbon * 1.1) * 1.3 + normal() * 0.4;
          const cool = Math.sin(t + ribbon) > 0;
          add(x, y, z, cool ? [0.27, 0.67 + rand() * 0.20, 0.76] : [0.9, 0.44 + rand() * 0.22, 0.31],
            i % 11 === 0 ? 22 + rand() * 55 : 1 + rand() * 2,
            i % 11 === 0 ? 0.10 : 0.4 + rand() * 0.5, 0.023, 4);
        }
      } else {
        for (let i = 0; i < count; i++) {
          const a = rand() * TAU, v = rand() * 2 - 1;
          const shell = rand() < 0.7;
          const r = shell ? 2.5 + normal() * 0.32 : Math.pow(rand(), 0.6) * 3.2;
          const flat = Math.sqrt(1 - v * v);
          const color = shell ? [0.32 + rand() * 0.23, 0.67 + rand() * 0.2, 1]
            : [1, 0.45 + (1 - r / 3.2) * 0.5, 0.25 + (1 - r / 3.2) * 0.55];
          add(Math.cos(a) * flat * r, Math.sin(a) * flat * r, v * r, color,
            i % 19 === 0 ? 15 + rand() * 30 : 1.3 + rand() * 2.7,
            i % 19 === 0 ? 0.035 : 0.35 + rand() * 0.4, 0.018, 5);
        }
        for (let i = 0; i < 18; i++) add(normal() * 0.035, normal() * 0.035, normal() * 0.035,
          [0.74, 0.87, 1], 65 + rand() * 100, 0.06, 0, 0);
      }
      this.particles = particles;
      this.data = new Float32Array(particles.length * 8);
      this.stats.count = particles.length;
      this.burstEnergy = 0;
      this._update(0);
    }

    _cameraValues() {
      return { cy: Math.cos(this.camera.yaw), sy: Math.sin(this.camera.yaw),
        cx: Math.cos(this.camera.pitch), sx: Math.sin(this.camera.pitch),
        cr: Math.cos(this.camera.roll), sr: Math.sin(this.camera.roll) };
    }

    _inverseView(x, y, z, c) {
      const a = x * c.cr + y * c.sr;
      const b = -x * c.sr + y * c.cr;
      const d = b * c.cx + z * c.sx;
      const e = -b * c.sx + z * c.cx;
      return [a * c.cy - e * c.sy, d, a * c.sy + e * c.cy];
    }

    _update(dt) {
      const p = this.particles;
      if (!p) return;
      const c = this._cameraValues();
      const step = dt * 60;
      const hasForce = this.pointer.down && this.tool !== 'orbit';
      const focal = Math.min(this.width, this.height) * 1.19 / this.camera.distance;
      const target = hasForce ? this._inverseView((this.pointer.x - this.centerX) / focal,
        -(this.pointer.y - this.centerY) / focal, 0, c) : [0, 0, 0];
      let energy = 0;
      const damping = Math.pow(0.945, step);
      const spring = 0.0018 * step;
      const gravity = this.parameters.gravity;
      const twist = Math.sqrt(gravity);
      const t = this.time;
      for (let i = 0; i < p.length; i++) {
        const s = p[i];
        const a = t * s.speed * twist;
        const co = Math.cos(a), si = Math.sin(a);
        let x = s.x * co - s.y * si;
        let y = s.x * si + s.y * co;
        let z = s.z;
        if (s.group === -1) {
          const world = this._inverseView(s.x, s.y, s.z, c);
          x = world[0]; y = world[1]; z = world[2];
        }
        if (s.group === 1 || s.group === 2) {
          const sign = s.group === 1 ? -1 : 1;
          const roll = sign * 0.27;
          const tx = x * Math.cos(roll) - y * Math.sin(roll);
          y = x * Math.sin(roll) + y * Math.cos(roll);
          x = tx + sign * (1.65 + Math.sin(t * 0.05) * 0.22);
          y += sign * 0.49;
          z += sign * 0.32;
        } else if (s.group === 3) {
          const world = this._inverseView(s.x, s.y, 0.03, c);
          x = world[0]; y = world[1]; z = world[2];
        } else if (s.group === 4) {
          z += Math.sin(t * 0.16 + s.phase) * 0.12;
          y += Math.cos(t * 0.12 + s.x) * 0.12;
        } else if (s.group === 5) {
          const scale = 0.9 + 0.17 * Math.sin(t * 0.22 + s.phase * 0.13);
          x *= scale; y *= scale; z *= scale;
        }
        if (s.group !== -1 && s.group !== 3 && step > 0) {
          if (hasForce) {
            const dx = target[0] - (x + s.ox), dy = target[1] - (y + s.oy), dz = target[2] - (z + s.oz);
            const d2 = dx * dx + dy * dy + dz * dz + 0.36;
            const strength = (this.tool === 'repel' ? -1 : 1) * gravity * 0.025 * step / (d2 * Math.sqrt(d2));
            s.vx += dx * strength;
            s.vy += dy * strength;
            s.vz += dz * strength;
          }
          s.vx = clamp((s.vx - s.ox * spring) * damping, -0.16, 0.16);
          s.vy = clamp((s.vy - s.oy * spring) * damping, -0.16, 0.16);
          s.vz = clamp((s.vz - s.oz * spring) * damping, -0.16, 0.16);
          s.ox = clamp(s.ox + s.vx * step, -7, 7);
          s.oy = clamp(s.oy + s.vy * step, -7, 7);
          s.oz = clamp(s.oz + s.vz * step, -7, 7);
          energy += s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
        }
        const j = i * 8;
        this.data[j] = x + s.ox;
        this.data[j + 1] = y + s.oy;
        this.data[j + 2] = z + s.oz;
        this.data[j + 3] = s.color[0];
        this.data[j + 4] = s.color[1];
        this.data[j + 5] = s.color[2];
        this.data[j + 6] = s.size;
        this.data[j + 7] = s.alpha * (s.group === -1 ? 0.85 + 0.15 * Math.sin(t * 0.3 + s.phase) : 1);
      }
      if (step > 0) this.stats.energy = clamp(Math.sqrt(energy / Math.max(1, p.length)) * 340, 0, 100);
    }

    _draw() {
      if (this.contextLost || this.destroyed) return;
      if (!this.gl) { this._drawCanvas(); return; }
      const gl = this.gl, u = this.uniforms;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW);
      gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
      gl.uniform2f(u.uCenter, this.centerX * this.dpr, this.centerY * this.dpr);
      gl.uniform3f(u.uCamera, this.camera.yaw, this.camera.pitch, this.camera.roll);
      gl.uniform1f(u.uDistance, this.camera.distance);
      gl.uniform1f(u.uDpr, this.dpr);
      gl.uniform1f(u.uGlow, this.parameters.glow);
      gl.uniform2f(u.uHoleCenter, this.centerX * this.dpr, (this.height - this.centerY) * this.dpr);
      const hole = this.scene === 'blackhole' ? Math.min(this.width, this.height) * 1.19 / this.camera.distance * 0.647 * this.dpr : 0;
      gl.uniform1f(u.uHoleRadius, hole);
      gl.drawArrays(gl.POINTS, 0, this.particles.length);
    }

    _drawCanvas() {
      const ctx = this.ctx, d = this.data, c = this._cameraValues();
      const w = this.canvas.width, h = this.canvas.height;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#030507';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const focal = Math.min(w, h) * 1.19;
      for (let i = 0; i < this.particles.length; i++) {
        const j = i * 8;
        const a = d[j] * c.cy + d[j + 2] * c.sy;
        const z = -d[j] * c.sy + d[j + 2] * c.cy;
        const b = d[j + 1] * c.cx - z * c.sx;
        const depth = Math.max(1, this.camera.distance - (d[j + 1] * c.sx + z * c.cx));
        const px = this.centerX * this.dpr + (a * c.cr - b * c.sr) * focal / depth;
        const py = this.centerY * this.dpr - (a * c.sr + b * c.cr) * focal / depth;
        if (px < -100 || px > w + 100 || py < -100 || py > h + 100) continue;
        const size = clamp(d[j + 6] * this.dpr * 9 / depth, 0.8, 180 * this.dpr);
        ctx.globalAlpha = Math.min(1, d[j + 7] * this.parameters.glow * 0.8);
        const color = d[j + 3] > 0.8 ? (d[j + 4] < 0.65 ? 1 : 0) : (d[j + 5] > 0.8 ? 3 : 2);
        ctx.drawImage(this.sprites[color], px - size / 2, py - size / 2, size, size);
      }
      if (this.scene === 'blackhole') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#030507';
        ctx.beginPath();
        ctx.arc(this.centerX * this.dpr, this.centerY * this.dpr, focal / this.camera.distance * 0.647, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    _frame(timestamp) {
      if (this.destroyed) return;
      const elapsed = this.lastTime ? Math.max(0, (timestamp - this.lastTime) / 1000) : 1 / 60;
      this.lastTime = timestamp;
      const dt = Math.min(0.04, elapsed);
      if (!this.paused) {
        this.time += dt * this.parameters.speed;
        if (this.autoRotate && !(this.pointer.down && this.tool === 'orbit')) {
          this.camera.yaw += dt * this.parameters.speed * 0.015;
        }
      }
      this._update(this.paused ? 0 : dt * this.parameters.speed);
      this._draw();
      this.frameCount++;
      this.frameTime += elapsed;
      if (this.frameTime >= 0.65) {
        this.stats.fps = Math.round(this.frameCount / this.frameTime);
        this.frameCount = this.frameTime = 0;
        if (typeof this.options.onStats === 'function') this.options.onStats(this.getStats());
      }
      this.raf = requestAnimationFrame(this._frame);
    }

    setScene(id) {
      if (!SCENES.includes(id) || this.destroyed) return false;
      this.scene = id;
      this.time = 0;
      const views = {
        spiral: [0.91, -0.39, 9.3], collision: [0.65, -0.29, 10.5],
        blackhole: [1.15, -0.24, 9.5], nebula: [0.23, -0.24, 9.4], supernova: [0.25, -0.15, 8.9]
      };
      const v = views[id];
      this.camera = { yaw: -0.12, pitch: v[0], roll: v[1], distance: v[2] };
      this._generate();
      this._draw();
      return true;
    }

    setParameter(key, value) {
      const ranges = { gravity: [0.2, 2], speed: [0, 2], glow: [0.3, 2] };
      if (!ranges[key] || typeof value !== 'number' || !Number.isFinite(value)) return false;
      this.parameters[key] = clamp(value, ranges[key][0], ranges[key][1]);
      return true;
    }

    setTool(id) {
      if (!['attract', 'repel', 'orbit'].includes(id)) return false;
      this.tool = id;
      this.pointer.down = false;
      this.canvas.style.cursor = id === 'orbit' ? 'grab' : 'crosshair';
      return true;
    }

    setPaused(value) { this.paused = Boolean(value); }
    setAutoRotate(value) { this.autoRotate = Boolean(value); }

    burst() {
      if (this.destroyed) return;
      const rand = randomGenerator(this.seed + Math.round(this.time * 1000));
      for (let i = this.backgroundCount; i < this.particles.length; i++) {
        const s = this.particles[i];
        if (s.group === 3) continue;
        const j = i * 8;
        const x = this.data[j], y = this.data[j + 1], z = this.data[j + 2];
        const len = Math.sqrt(x * x + y * y + z * z) + 0.3;
        const force = 0.055 + rand() * 0.085;
        s.vx += x / len * force;
        s.vy += y / len * force;
        s.vz += z / len * force + (rand() - 0.5) * 0.045;
      }
      this.stats.energy = 90;
    }

    reset() {
      this.parameters = { gravity: 1, speed: 0.65, glow: 1 };
      this.autoRotate = true;
      this.pointer.down = false;
      this.setScene(this.scene);
    }

    getStats() { return { fps: this.stats.fps, count: this.stats.count, energy: Math.round(this.stats.energy) }; }

    getSnapshot() {
      return { version: 1, scene: this.scene, seed: this.seed, time: this.time,
        parameters: { ...this.parameters }, camera: { ...this.camera },
        paused: this.paused, autoRotate: this.autoRotate, tool: this.tool };
    }

    restoreSnapshot(data) {
      if (this.destroyed || !data || typeof data !== 'object' || Array.isArray(data) || !SCENES.includes(data.scene)) return false;
      this.seed = Math.floor(clamp(finite(data.seed, 740281), 0, 4294967295));
      this.setScene(data.scene);
      if (data.parameters && typeof data.parameters === 'object') {
        ['gravity', 'speed', 'glow'].forEach(key => this.setParameter(key, data.parameters[key]));
      }
      if (data.camera && typeof data.camera === 'object') {
        this.camera.yaw = clamp(finite(data.camera.yaw, this.camera.yaw), -100, 100);
        this.camera.pitch = clamp(finite(data.camera.pitch, this.camera.pitch), -1.48, 1.48);
        this.camera.roll = clamp(finite(data.camera.roll, this.camera.roll), -Math.PI, Math.PI);
        this.camera.distance = clamp(finite(data.camera.distance, this.camera.distance), 5.5, 17);
      }
      this.time = clamp(finite(data.time, 0), 0, 1000000);
      if (typeof data.paused === 'boolean') this.paused = data.paused;
      if (typeof data.autoRotate === 'boolean') this.autoRotate = data.autoRotate;
      if (data.tool) this.setTool(data.tool);
      this._update(0);
      this._draw();
      return true;
    }

    capture() {
      if (this.destroyed || this.contextLost) throw new Error('The artwork is not ready to export.');
      this._draw();
      return this.canvas.toDataURL('image/png');
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      cancelAnimationFrame(this.raf);
      this.listeners.forEach(remove => remove());
      this.listeners.length = 0;
      if (this.observer) this.observer.disconnect();
      if (this.gl && !this.contextLost) {
        this.gl.deleteBuffer(this.buffer);
        this.gl.deleteProgram(this.program);
      }
      this.particles = [];
      this.data = null;
    }
  }

  window.GravityEngine = GravityEngine;
})();
