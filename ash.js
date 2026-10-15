(function defineAshParticles() {
  "use strict";

  const THREE_CDN_URL =
    window.THREE_MODULE_URL || "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js";
  const IS_FILE_PROTOCOL = window.location.protocol === "file:";
  const THREE_MODULE_SOURCES = IS_FILE_PROTOCOL
    ? []
    : [new URL("./vendor/three.module.min.js", document.baseURI).href, THREE_CDN_URL];

  function importWithTimeout(url, timeout = 8000) {
    let timer = 0;
    return Promise.race([
      import(url),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`Three.js timeout: ${url}`)), timeout);
      }),
    ]).finally(() => window.clearTimeout(timer));
  }

  async function loadThree() {
    if (!THREE_MODULE_SOURCES.length) {
      throw new Error("Three.js modules require an HTTP origin; using the CSS fallback for file://.");
    }
    let lastError;
    for (const source of THREE_MODULE_SOURCES) {
      try {
        const module = await importWithTimeout(source, source === THREE_CDN_URL ? 30000 : 5000);
        if (module?.WebGLRenderer) return module;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Three.js could not be loaded.");
  }

  class AshParticleSystem {
    constructor(container, options = {}) {
      this.container = container;
      this.density = options.density || 0.032;
      this.minParticles = options.minParticles || 320;
      this.maxParticles = options.maxParticles || 1600;
      this.effects = [];
      this.raf = 0;
      this.loading = null;
      this.available = false;
      this.failed = false;
      this.destroyed = false;
      this.generation = 0;
      this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.onMotionChange = () => {
        if (this.destroyed) return;
        if (this.motionQuery.matches) this.finishAll("reduced-motion");
        else if (!IS_FILE_PROTOCOL) void this.init();
      };
      this.motionQuery.addEventListener?.("change", this.onMotionChange);
      if (!this.motionQuery.matches && !IS_FILE_PROTOCOL) void this.init();
    }

    init() {
      if (this.destroyed || IS_FILE_PROTOCOL) return Promise.resolve(false);
      if (this.available) return Promise.resolve(true);
      if (this.failed || this.motionQuery.matches || !this.container) return Promise.resolve(false);
      if (this.loading) return this.loading;
      this.loading = this.boot()
        .catch((error) => {
          console.warn("Ash particles unavailable; using CSS fallback.", error);
          this.failed = true;
          return false;
        })
        .finally(() => {
          this.loading = null;
        });
      return this.loading;
    }

    async boot() {
      const generation = this.generation;
      const THREE = await loadThree();
      if (
        !THREE?.WebGLRenderer ||
        this.destroyed ||
        generation !== this.generation ||
        !this.container?.isConnected
      ) {
        return false;
      }

      const canvas = document.createElement("canvas");
      canvas.className = "ash-particle-canvas";
      canvas.setAttribute("aria-hidden", "true");
      canvas.dataset.ashReady = "true";
      canvas.dataset.effectCount = "0";
      this.container.append(canvas);

      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: false,
          powerPreference: "low-power",
        });
      } catch (error) {
        canvas.remove();
        throw error;
      }

      this.THREE = THREE;
      this.canvas = canvas;
      this.renderer = renderer;
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 100);
      this.camera.position.z = 10;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));

      this.onResize = () => this.resize();
      this.onContextLost = (event) => {
        event.preventDefault();
        this.generation += 1;
        this.teardownRenderer("context-lost", true);
      };
      window.addEventListener("resize", this.onResize, { passive: true });
      canvas.addEventListener("webglcontextlost", this.onContextLost);
      this.resize();
      this.available = true;
      return true;
    }

    resize() {
      if (!this.renderer || !this.camera || !this.container) return;
      const rect = this.container.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      this.camera.left = 0;
      this.camera.right = width;
      this.camera.top = 0;
      this.camera.bottom = height;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
      this.renderer.setSize(width, height, false);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
      for (const effect of this.effects) {
        if (effect.material?.uniforms?.uPixelRatio) {
          effect.material.uniforms.uPixelRatio.value = pixelRatio;
        }
      }
    }

    async disintegrate(element, options = {}) {
      if (!element?.isConnected) return { mode: "none" };
      if (this.motionQuery.matches) return this.cssFallback(element, 0);
      if (!this.available) {
        if (!this.failed && !this.destroyed && !IS_FILE_PROTOCOL) void this.init();
        return this.cssFallback(element);
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return { mode: "none" };

      const containerRect = this.container.getBoundingClientRect();
      const localRect = {
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        width: rect.width,
        height: rect.height,
        color: options.color || "#9b6045",
      };

      if (element.isConnected) element.classList.add("is-burning");
      const effect = this.spawn(localRect);
      window.setTimeout(() => {
        if (element.isConnected) element.style.visibility = "hidden";
      }, 120);
      return effect;
    }

    spawn(rect) {
      const THREE = this.THREE;
      if (!THREE || !this.scene || !this.canvas || this.destroyed) {
        return Promise.resolve({ mode: "none" });
      }
      const count = Math.max(
        this.minParticles,
        Math.min(this.maxParticles, Math.round(rect.width * rect.height * this.density)),
      );
      const positions = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      const lives = new Float32Array(count);
      const delays = new Float32Array(count);
      const alphas = new Float32Array(count);
      const seeds = new Float32Array(count);
      const shades = new Float32Array(count);
      let maxEnd = 0;

      for (let index = 0; index < count; index += 1) {
        const offset = index * 3;
        const x = Math.random();
        const y = Math.random();
        const seed = Math.random();
        const life = 0.85 + Math.random() * 0.95;
        const delay = Math.random() * 0.22 + (1 - y) * 0.12;
        positions[offset] = rect.left + x * rect.width;
        positions[offset + 1] = rect.top + y * rect.height;
        positions[offset + 2] = (Math.random() - 0.5) * 0.5;
        velocities[offset] = (Math.random() - 0.5) * 34;
        velocities[offset + 1] = -(44 + Math.random() * 76);
        velocities[offset + 2] = (Math.random() - 0.5) * 2;
        sizes[index] = 1 + Math.pow(Math.random(), 1.55) * 4.4;
        lives[index] = life;
        delays[index] = delay;
        alphas[index] = 0.48 + Math.random() * 0.52;
        seeds[index] = seed;
        shades[index] = Math.random();
        maxEnd = Math.max(maxEnd, delay + life);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aVelocity", new THREE.BufferAttribute(velocities, 3));
      geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
      geometry.setAttribute("aLife", new THREE.BufferAttribute(lives, 1));
      geometry.setAttribute("aDelay", new THREE.BufferAttribute(delays, 1));
      geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
      geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      geometry.setAttribute("aShade", new THREE.BufferAttribute(shades, 1));

      let baseColor;
      try {
        baseColor = new THREE.Color(rect.color);
      } catch {
        baseColor = new THREE.Color("#9b6045");
      }

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.6) },
          uColorA: { value: baseColor.clone().lerp(new THREE.Color("#d7b27b"), 0.28) },
          uColorB: { value: baseColor.clone().lerp(new THREE.Color("#2d2925"), 0.72) },
        },
        vertexShader: `
          attribute vec3 aVelocity;
          attribute float aSize;
          attribute float aLife;
          attribute float aDelay;
          attribute float aAlpha;
          attribute float aSeed;
          attribute float aShade;
          uniform float uTime;
          uniform float uPixelRatio;
          varying float vAlpha;
          varying float vShade;

          void main() {
            float age = max(0.0, uTime - aDelay);
            float progress = clamp(age / aLife, 0.0, 1.0);
            float started = step(aDelay, uTime);
            float alive = 1.0 - step(aLife, age);
            float turbulence = sin(aSeed * 61.7 + age * (4.0 + aSeed * 3.0))
              + 0.45 * sin(aSeed * 127.1 - age * 7.2);
            vec3 transformed = position + aVelocity * age;
            transformed.x += turbulence * (2.0 + aSeed * 4.0) * progress;
            transformed.y -= age * age * (5.0 + aSeed * 5.0);
            transformed.z += turbulence * 0.08;
            float decay = 1.0 - smoothstep(0.08, 1.0, progress);
            vAlpha = aAlpha * started * alive * decay;
            vShade = aShade;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
            gl_PointSize = max(1.0, aSize * uPixelRatio * (1.0 - progress * 0.32));
          }
        `,
        fragmentShader: `
          precision mediump float;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying float vAlpha;
          varying float vShade;

          void main() {
            float radius = distance(gl_PointCoord, vec2(0.5));
            float edge = 1.0 - smoothstep(0.26, 0.5, radius);
            float alpha = edge * vAlpha;
            if (alpha < 0.005) discard;
            gl_FragColor = vec4(mix(uColorA, uColorB, vShade), alpha);
          }
        `,
      });

      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 999;
      this.scene.add(points);

      let resolveEffect;
      const finished = new Promise((resolve) => {
        resolveEffect = resolve;
      });
      this.effects.push({
        points,
        geometry,
        material,
        startedAt: performance.now(),
        duration: maxEnd + 0.08,
        resolve: resolveEffect,
      });
      this.canvas.dataset.effectCount = String(this.effects.length);
      this.startLoop();
      return finished;
    }

    startLoop() {
      if (this.raf) return;
      const frame = (now) => {
        this.raf = 0;
        if (!this.available) return;
        for (let index = this.effects.length - 1; index >= 0; index -= 1) {
          const effect = this.effects[index];
          const elapsed = (now - effect.startedAt) / 1000;
          effect.material.uniforms.uTime.value = elapsed;
          if (elapsed >= effect.duration) this.removeEffect(index, "completed");
        }
        this.renderer.render(this.scene, this.camera);
        if (this.effects.length) this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    }

    removeEffect(index, reason) {
      const effect = this.effects[index];
      if (!effect) return;
      this.scene.remove(effect.points);
      effect.geometry.dispose();
      effect.material.dispose();
      this.effects.splice(index, 1);
      if (this.canvas) this.canvas.dataset.effectCount = String(this.effects.length);
      effect.resolve({ mode: "webgl", reason });
    }

    finishAll(reason = "cancelled") {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      for (let index = this.effects.length - 1; index >= 0; index -= 1) {
        this.removeEffect(index, reason);
      }
      this.renderer?.clear();
    }

    teardownRenderer(reason = "cancelled", markFailed = false) {
      this.finishAll(reason);
      window.removeEventListener("resize", this.onResize);
      this.canvas?.removeEventListener("webglcontextlost", this.onContextLost);
      this.renderer?.dispose();
      this.canvas?.remove();
      this.available = false;
      this.failed = this.failed || markFailed;
      this.THREE = null;
      this.canvas = null;
      this.renderer = null;
      this.scene = null;
      this.camera = null;
      this.onResize = null;
      this.onContextLost = null;
    }

    cssFallback(element, duration = 280) {
      if (!element?.isConnected) return Promise.resolve({ mode: "none" });
      if (duration <= 0 || this.motionQuery.matches) {
        element.style.opacity = "0";
        element.style.visibility = "hidden";
        return Promise.resolve({ mode: "fallback", reason: "reduced-motion" });
      }
      if (!element.animate) {
        element.style.opacity = "0";
        return Promise.resolve({ mode: "fallback" });
      }
      const animation = element.animate(
        [
          { opacity: 1, filter: "none", transform: "translateY(0) scale(1)" },
          { opacity: 0, filter: "grayscale(1) blur(4px)", transform: "translateY(-18px) scale(.96)" },
        ],
        { duration, easing: "ease-out", fill: "forwards" },
      );
      return animation.finished.catch(() => {}).then(() => ({ mode: "fallback" }));
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.generation += 1;
      this.teardownRenderer("destroyed");
      this.motionQuery.removeEventListener?.("change", this.onMotionChange);
      this.loading = null;
    }
  }

  window.AshParticleSystem = AshParticleSystem;
})();
