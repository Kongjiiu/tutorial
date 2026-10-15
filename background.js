(function () {
  "use strict";

  const CANVAS_ATTRIBUTE = "data-arcana-background";
  const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
  const DARK_QUERY = "(prefers-color-scheme: dark)";
  const DESKTOP_FRAME_INTERVAL = 1000 / 30;
  const MOBILE_FRAME_INTERVAL = 1000 / 24;

  function start() {
    if (!document.body || document.querySelector(`[${CANVAS_ATTRIBUTE}]`)) return;

    const body = document.body;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    canvas.setAttribute(CANVAS_ATTRIBUTE, "");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = [
      "position:fixed",
      "inset:0",
      "width:100vw",
      "height:100vh",
      "z-index:0",
      "pointer-events:none",
      "user-select:none",
      "opacity:.98",
    ].join(";");

    const previousIsolation = body.style.isolation;
    body.style.isolation = "isolate";
    body.insertBefore(canvas, body.firstChild);

    const reducedMotion = window.matchMedia(REDUCED_QUERY);
    const darkScheme = window.matchMedia(DARK_QUERY);
    const sceneTarget = document.getElementById("ritual-orbit") || document.documentElement;
    const state = {
      width: 1,
      height: 1,
      dpr: 1,
      frame: 0,
      lastFrame: 0,
      lastInteraction: 0,
      elapsed: 0,
      running: false,
      destroyed: false,
      reduced: reducedMotion.matches,
      dark: darkScheme.matches,
      frameInterval: DESKTOP_FRAME_INTERVAL,
      pointer: { x: 0, y: 0 },
      pointerTarget: { x: 0, y: 0 },
      input: { x: 0, y: 0, time: 0, source: "", valid: false },
      motionEnergy: 0,
      wobble: { x: 0, y: 0, z: 0 },
      wobbleVelocity: { x: 0, y: 0, z: 0 },
      particles: [],
      palette: readPalette(),
    };

    let randomSeed = 0x2f6e2b1;

    function random() {
      randomSeed |= 0;
      randomSeed = (randomSeed + 0x6d2b79f5) | 0;
      let value = Math.imul(randomSeed ^ (randomSeed >>> 15), 1 | randomSeed);
      value = value + Math.imul(value ^ (value >>> 7), 61 | value) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }

    function readPalette() {
      const styles = getComputedStyle(document.documentElement);
      return {
        ink: styles.getPropertyValue("--ink").trim() || "#201f1a",
        accent: styles.getPropertyValue("--accent").trim() || "#8c3e29",
        brass: styles.getPropertyValue("--brass").trim() || "#8f6e34",
      };
    }

    function makeParticle() {
      const depth = Math.pow(random(), 1.45);
      return {
        x: random(),
        y: random(),
        depth,
        driftX: (random() - 0.5) * (0.0014 + depth * 0.0022),
        driftY: -(0.001 + random() * 0.0026) * (0.45 + depth),
        phase: random() * Math.PI * 2,
        secondaryPhase: random() * Math.PI * 2,
        twinkleSpeed: 0.72 + random() * 3.1,
        twinkleSharpness: 5.5 + random() * 4.5,
        size: 0.38 + Math.pow(random(), 2.4) * 1.18 + depth * 0.44,
        tone: random(),
        spark: random() > 0.82,
      };
    }

    function syncParticleCount() {
      const mobile = state.width <= 720;
      const areaTarget = Math.round(
        (state.width * state.height) / (mobile ? 12000 : 8500),
      );
      const desired = mobile
        ? Math.min(110, Math.max(60, areaTarget))
        : Math.min(230, Math.max(125, areaTarget));
      while (state.particles.length < desired) state.particles.push(makeParticle());
      if (state.particles.length > desired) state.particles.length = desired;
    }

    function resize() {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const maxDpr = width <= 720 ? 1.25 : 1.5;
      const dpr = Math.min(maxDpr, Math.max(1, window.devicePixelRatio || 1));
      if (width === state.width && height === state.height && dpr === state.dpr) return;

      state.width = width;
      state.height = height;
      state.dpr = dpr;
      state.frameInterval = width <= 720 ? MOBILE_FRAME_INTERVAL : DESKTOP_FRAME_INTERVAL;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      syncParticleCount();
      if (state.reduced || document.hidden) draw();
    }

    function setPointer(clientX, clientY, strength, impulseGainX, impulseGainY, source) {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      if (state.reduced) return;
      const x = (clientX / state.width - 0.5) * 2;
      const y = (clientY / state.height - 0.5) * 2;
      let normalizedX = clamp(x, -1, 1);
      let normalizedY = clamp(y, -1, 1);
      const now = performance.now();
      let impulseX = 0;
      let impulseY = 0;
      const inputGap = now - state.input.time;
      const sameSource = state.input.valid && state.input.source === source;

      if (sameSource && source === "gesture") {
        if (Math.abs(normalizedX - state.input.x) < 0.014) normalizedX = state.input.x;
        if (Math.abs(normalizedY - state.input.y) < 0.014) normalizedY = state.input.y;
      }

      if (
        state.input.valid &&
        state.input.source === "gesture" &&
        source !== "gesture" &&
        inputGap < 350
      ) return;

      if (sameSource && inputGap <= 120) {
        const deltaTime = clamp(inputGap / 1000, 1 / 120, 0.12);
        const deltaX = normalizedX - state.input.x;
        const deltaY = normalizedY - state.input.y;
        impulseX = clamp((deltaX / deltaTime) * impulseGainX, -0.28, 0.28);
        impulseY = clamp((deltaY / deltaTime) * impulseGainY, -0.22, 0.22);
        state.motionEnergy = Math.max(
          state.motionEnergy,
          clamp(Math.hypot(deltaX, deltaY) * 4 + Math.hypot(impulseX, impulseY) * 1.8, 0, 1),
        );
        const wobbleGain = source === "gesture" ? 5.4 : 3.5;
        state.wobbleVelocity.x = clamp(
          state.wobbleVelocity.x - impulseY * wobbleGain,
          -1.35,
          1.35,
        );
        state.wobbleVelocity.y = clamp(
          state.wobbleVelocity.y + impulseX * wobbleGain,
          -1.55,
          1.55,
        );
        state.wobbleVelocity.z = clamp(
          state.wobbleVelocity.z + impulseX * wobbleGain * 0.42,
          -0.72,
          0.72,
        );
      }

      state.input = { x: normalizedX, y: normalizedY, time: now, source, valid: true };
      state.lastInteraction = now;
      state.pointerTarget.x = clamp(normalizedX * strength + impulseX, -1.15, 1.15);
      state.pointerTarget.y = clamp(normalizedY * strength + impulseY, -1.15, 1.15);
    }

    function onPointerMove(event) {
      if (event.isPrimary === false) return;
      if (event.pointerType === "touch") {
        setPointer(event.clientX, event.clientY, 1.05, 0.016, 0.013, "touch");
      } else {
        setPointer(event.clientX, event.clientY, 1, 0.02, 0.016, "mouse");
      }
    }

    function onTouchMove(event) {
      if (window.PointerEvent) return;
      const touch = event.touches && event.touches[0];
      if (touch) setPointer(touch.clientX, touch.clientY, 1.05, 0.016, 0.013, "touch");
    }

    function onGesturePointer(event) {
      const detail = event.detail || {};
      const source = detail.pointer || detail.position || detail;
      const normalizedX = firstFinite(source.normalizedX, source.nx, detail.normalizedX, detail.nx);
      const normalizedY = firstFinite(source.normalizedY, source.ny, detail.normalizedY, detail.ny);
      let x = firstFinite(source.clientX, detail.clientX);
      let y = firstFinite(source.clientY, detail.clientY);

      if ((!Number.isFinite(x) || !Number.isFinite(y)) && Number.isFinite(normalizedX) && Number.isFinite(normalizedY)) {
        x = normalizedX >= 0 && normalizedX <= 1 ? normalizedX * state.width : (normalizedX * 0.5 + 0.5) * state.width;
        y = normalizedY >= 0 && normalizedY <= 1 ? normalizedY * state.height : (normalizedY * 0.5 + 0.5) * state.height;
      }

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        x = firstFinite(source.x, detail.x);
        y = firstFinite(source.y, detail.y);
        if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 1 && Math.abs(y) <= 1) {
          x = x >= 0 ? x * state.width : (x * 0.5 + 0.5) * state.width;
          y = y >= 0 ? y * state.height : (y * 0.5 + 0.5) * state.height;
        }
      }

      setPointer(x, y, 1.2, 0.018, 0.014, "gesture");
    }

    function resetPointerTarget() {
      state.pointerTarget.x = 0;
      state.pointerTarget.y = 0;
      state.input.valid = false;
    }

    function onPointerLeave() {
      resetPointerTarget();
    }

    function onPointerEnd(event) {
      if (!event.pointerType || event.pointerType === "touch" || event.pointerType === "pen") resetPointerTarget();
    }

    function onVisibilityChange() {
      if (document.hidden) stopLoop();
      else startLoop();
    }

    function onReducedMotionChange(event) {
      state.reduced = event.matches;
      if (state.reduced) {
        stopLoop();
        state.pointer.x = 0;
        state.pointer.y = 0;
        state.pointerTarget.x = 0;
        state.pointerTarget.y = 0;
        state.motionEnergy = 0;
        state.wobble.x = 0;
        state.wobble.y = 0;
        state.wobble.z = 0;
        state.wobbleVelocity.x = 0;
        state.wobbleVelocity.y = 0;
        state.wobbleVelocity.z = 0;
        state.input.valid = false;
        syncCssParallax();
        draw();
      } else {
        startLoop();
      }
    }

    function onThemeChange() {
      state.dark = darkScheme.matches;
      state.palette = readPalette();
      if (state.reduced || !state.running) draw();
    }

    function onPageHide(event) {
      stopLoop();
      if (!event.persisted) destroy();
    }

    function onPageShow(event) {
      if (event.persisted && !state.destroyed) {
        resize();
        startLoop();
      }
    }

    function startLoop() {
      if (state.destroyed || state.running || state.reduced || document.hidden) return;
      state.running = true;
      state.lastFrame = 0;
      state.frame = requestAnimationFrame(frame);
    }

    function stopLoop() {
      state.running = false;
      cancelAnimationFrame(state.frame);
      state.frame = 0;
    }

    function frame(timestamp) {
      if (!state.running) return;
      state.frame = requestAnimationFrame(frame);
      const elapsedMs = state.lastFrame ? timestamp - state.lastFrame : state.frameInterval;
      if (state.lastFrame && elapsedMs < state.frameInterval - 1) return;

      const delta = Math.min(0.05, elapsedMs / 1000);
      state.lastFrame = elapsedMs >= state.frameInterval
        ? timestamp - (elapsedMs % state.frameInterval)
        : timestamp;
      state.elapsed += delta;

      if (timestamp - state.lastInteraction > 800) {
        const returnEase = 1 - Math.exp(-delta * 1.8);
        state.pointerTarget.x += (0 - state.pointerTarget.x) * returnEase;
        state.pointerTarget.y += (0 - state.pointerTarget.y) * returnEase;
      }

      state.motionEnergy *= Math.exp(-delta * 2.2);
      const ease = 1 - Math.exp(-delta * 5.4);
      state.pointer.x += (state.pointerTarget.x - state.pointer.x) * ease;
      state.pointer.y += (state.pointerTarget.y - state.pointer.y) * ease;

      updateWobble(delta);
      syncCssParallax();
      updateParticles(delta);
      draw();
    }

    function updateWobble(delta) {
      const spring = 6.8;
      const damping = Math.exp(-delta * 3.15);
      for (const axis of ["x", "y", "z"]) {
        state.wobbleVelocity[axis] += -state.wobble[axis] * spring * delta;
        state.wobbleVelocity[axis] *= damping;
        state.wobble[axis] += state.wobbleVelocity[axis] * delta;
      }
      state.wobble.x = clamp(state.wobble.x, -0.2, 0.2);
      state.wobble.y = clamp(state.wobble.y, -0.24, 0.24);
      state.wobble.z = clamp(state.wobble.z, -0.12, 0.12);
    }

    function syncCssParallax() {
      const energyScale = 1 + state.motionEnergy * 0.42;
      const radiansToDegrees = 180 / Math.PI;
      const tiltX = -state.pointer.y * 4.5 * energyScale + state.wobble.x * radiansToDegrees * 0.62;
      const tiltZ = state.pointer.x * 7.2 * energyScale + state.wobble.z * radiansToDegrees * 0.76;
      const shiftX = state.pointer.x * 16 * energyScale + state.wobble.y * 18;
      const shiftY = state.pointer.y * 11 * energyScale + state.wobble.x * 12;
      sceneTarget.style.setProperty("--scene-tilt-x", `${clamp(tiltX, -10, 10).toFixed(3)}deg`);
      sceneTarget.style.setProperty("--scene-tilt-z", `${clamp(tiltZ, -11, 11).toFixed(3)}deg`);
      sceneTarget.style.setProperty("--scene-shift-x", `${clamp(shiftX, -24, 24).toFixed(2)}px`);
      sceneTarget.style.setProperty("--scene-shift-y", `${clamp(shiftY, -18, 18).toFixed(2)}px`);
    }

    function updateParticles(delta) {
      for (const particle of state.particles) {
        particle.x += particle.driftX * delta * 30;
        particle.y += particle.driftY * delta * 30;
        if (particle.x < -0.03) particle.x = 1.03;
        if (particle.x > 1.03) particle.x = -0.03;
        if (particle.y < -0.04) {
          particle.y = 1.04;
          particle.x = random();
        }
      }
    }

    function draw() {
      context.clearRect(0, 0, state.width, state.height);
      drawParticles(0, 0.56);
      drawSpatialGrid();
      drawParticles(0.56, 1.01);
    }

    function drawParticles(minDepth, maxDepth) {
      const activity = 1 + state.motionEnergy * 0.32;
      const parallaxX = state.pointer.x * Math.min(34, state.width * 0.026) * activity;
      const parallaxY = state.pointer.y * Math.min(24, state.height * 0.024) * activity;

      for (const particle of state.particles) {
        if (particle.depth < minDepth || particle.depth >= maxDepth) continue;
        const wave = Math.max(0, Math.sin(state.elapsed * particle.twinkleSpeed + particle.phase));
        const slowWave = 0.72 + Math.sin(state.elapsed * particle.twinkleSpeed * 0.31 + particle.secondaryPhase) * 0.28;
        const sparkle = Math.pow(wave, particle.twinkleSharpness) * slowWave;
        const pulse = 0.22 + sparkle * 0.78;
        const depthParallax = 0.2 + particle.depth * 0.8;
        const x = particle.x * state.width + parallaxX * depthParallax;
        const y = particle.y * state.height + parallaxY * depthParallax;
        const color = particle.tone > 0.9
          ? state.palette.accent
          : particle.tone > 0.72
            ? state.palette.brass
            : state.palette.ink;
        const baseAlpha = state.dark
          ? 0.11 + particle.depth * 0.23
          : 0.07 + particle.depth * 0.16;
        const alpha = clamp(baseAlpha * pulse * activity, 0, particle.spark ? 0.58 : 0.4);
        const radius = particle.size * (0.86 + sparkle * 0.34 + state.motionEnergy * particle.depth * 0.1);

        if (particle.spark && sparkle > 0.58) {
          context.globalAlpha = clamp(alpha * 0.18, 0, 0.09);
          context.fillStyle = color;
          context.beginPath();
          context.arc(x, y, radius * (3.2 + sparkle * 1.8), 0, Math.PI * 2);
          context.fill();
        }

        context.globalAlpha = alpha;
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();

        if (particle.spark && sparkle > 0.66) {
          const arm = radius * (1.7 + sparkle * 2.4);
          context.globalAlpha = clamp(alpha * (sparkle - 0.48) * 2.2, 0, 0.48);
          context.strokeStyle = color;
          context.lineWidth = 0.42 + particle.depth * 0.32;
          context.beginPath();
          context.moveTo(x - arm, y);
          context.lineTo(x + arm, y);
          context.moveTo(x, y - arm);
          context.lineTo(x, y + arm);
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    }

    function drawSpatialGrid() {
      const idleRotation = state.reduced ? 0 : state.elapsed * 0.019;
      const idlePitch = state.reduced ? 0 : Math.sin(state.elapsed * 0.21) * 0.038;
      const idleRoll = state.reduced ? 0 : Math.sin(state.elapsed * 0.16 + 1.2) * 0.026;
      const activity = 1 + state.motionEnergy * 0.52;
      const rotation = {
        x: -0.61 + idlePitch + state.pointer.y * 0.28 * activity + state.wobble.x,
        y: 0.16 + idleRotation + state.pointer.x * 0.44 * activity + state.wobble.y,
        z: -0.32 + idleRoll + state.pointer.x * 0.145 * activity + state.wobble.z,
      };
      const centerX = state.width * 0.51 + state.pointer.x * 20 * activity + state.wobble.y * 22;
      const centerY = state.height * 0.59 + state.pointer.y * 14 * activity + state.wobble.x * 16;
      const radius = Math.min(state.width * 0.49, state.height * 0.66);
      const projection = { centerX, centerY, radius, camera: 2.95, rotation };
      const compact = state.width <= 720 || elementsCameraActive();
      const curveSegments = compact ? 42 : 64;
      const gridPaths = projectedPathBuckets();
      const axisPaths = projectedPathBuckets();
      const accentPaths = projectedPathBuckets();
      const brassPaths = projectedPathBuckets();

      context.lineCap = "round";

      const latitudes = compact
        ? [-1.05, -0.7, -0.35, 0, 0.35, 0.7, 1.05]
        : [-1.12, -0.84, -0.56, -0.28, 0, 0.28, 0.56, 0.84, 1.12];
      for (const latitude of latitudes) {
        const y = Math.sin(latitude);
        const ringRadius = Math.cos(latitude);
        addProjectedCurve(
          (t) => ({ x: Math.cos(t) * ringRadius, y, z: Math.sin(t) * ringRadius }),
          curveSegments,
          projection,
          latitude === 0 ? axisPaths : gridPaths,
        );
      }

      const longitudeCount = compact ? 6 : 8;
      for (let index = 0; index < longitudeCount; index += 1) {
        const longitude = (index * Math.PI) / longitudeCount;
        addProjectedCurve(
          (t) => {
            const ringRadius = Math.cos(t);
            return {
              x: Math.cos(longitude) * ringRadius,
              y: Math.sin(t),
              z: Math.sin(longitude) * ringRadius,
            };
          },
          curveSegments,
          projection,
          gridPaths,
          -Math.PI / 2,
          Math.PI * 1.5,
        );
      }

      addProjectedCurve(
        (t) => rotatePoint({ x: Math.cos(t) * 1.22, y: Math.sin(t) * 1.22, z: 0 }, 0.93, 0, 0.52),
        compact ? 60 : 84,
        projection,
        accentPaths,
      );

      addProjectedCurve(
        (t) => rotatePoint({ x: Math.cos(t) * 1.38, y: Math.sin(t) * 1.38, z: 0 }, -0.32, 0.18, -0.78),
        compact ? 62 : 88,
        projection,
        brassPaths,
      );

      strokeProjectedLayer(gridPaths, state.palette.ink, 0.105, 0.56);
      strokeProjectedLayer(axisPaths, state.palette.ink, 0.155, 0.72);
      strokeProjectedLayer(accentPaths, state.palette.accent, 0.14, 0.72);
      strokeProjectedLayer(brassPaths, state.palette.brass, 0.105, 0.64);
      context.globalAlpha = 1;
    }

    function projectedPathBuckets() {
      return [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    }

    function addProjectedCurve(factory, segments, projection, paths, start, end) {
      const from = Number.isFinite(start) ? start : 0;
      const to = Number.isFinite(end) ? end : Math.PI * 2;
      let previous = project(factory(from), projection);

      for (let index = 1; index <= segments; index += 1) {
        const t = from + ((to - from) * index) / segments;
        const current = project(factory(t), projection);
        const depth = clamp((previous.depth + current.depth) * 0.25 + 0.5, 0, 1);
        const bucket = Math.min(paths.length - 1, Math.floor(depth * paths.length));
        paths[bucket].moveTo(previous.x, previous.y);
        paths[bucket].lineTo(current.x, current.y);
        previous = current;
      }
    }

    function strokeProjectedLayer(paths, color, baseAlpha, baseWidth) {
      const alphaByDepth = [0.16, 0.34, 0.72, 1.22];
      const widthByDepth = [0.52, 0.68, 0.92, 1.2];
      context.strokeStyle = color;
      for (let index = 0; index < paths.length; index += 1) {
        context.globalAlpha = baseAlpha * alphaByDepth[index];
        context.lineWidth = baseWidth * widthByDepth[index];
        context.stroke(paths[index]);
      }
    }

    function elementsCameraActive() {
      return document.body.dataset.cameraState === "active";
    }

    function project(point, projection) {
      const rotated = rotatePoint(point, projection.rotation.x, projection.rotation.y, projection.rotation.z);
      const scale = projection.camera / (projection.camera - rotated.z);
      return {
        x: projection.centerX + rotated.x * projection.radius * scale,
        y: projection.centerY + rotated.y * projection.radius * scale,
        depth: rotated.z,
      };
    }

    function rotatePoint(point, rotateX, rotateY, rotateZ) {
      const cosX = Math.cos(rotateX);
      const sinX = Math.sin(rotateX);
      const cosY = Math.cos(rotateY);
      const sinY = Math.sin(rotateY);
      const cosZ = Math.cos(rotateZ);
      const sinZ = Math.sin(rotateZ);

      const y1 = point.y * cosX - point.z * sinX;
      const z1 = point.y * sinX + point.z * cosX;
      const x2 = point.x * cosY + z1 * sinY;
      const z2 = -point.x * sinY + z1 * cosY;
      return {
        x: x2 * cosZ - y1 * sinZ,
        y: x2 * sinZ + y1 * cosZ,
        z: z2,
      };
    }

    function firstFinite() {
      for (let index = 0; index < arguments.length; index += 1) {
        if (Number.isFinite(arguments[index])) return arguments[index];
      }
      return NaN;
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function addMediaListener(media, listener) {
      if (media.addEventListener) media.addEventListener("change", listener);
      else media.addListener(listener);
    }

    function removeMediaListener(media, listener) {
      if (media.removeEventListener) media.removeEventListener("change", listener);
      else media.removeListener(listener);
    }

    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      stopLoop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", resetPointerTarget);
      window.removeEventListener("touchcancel", resetPointerTarget);
      window.removeEventListener("arcana:gesturepointer", onGesturePointer);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      removeMediaListener(reducedMotion, onReducedMotionChange);
      removeMediaListener(darkScheme, onThemeChange);
      canvas.remove();
      sceneTarget.style.removeProperty("--scene-tilt-x");
      sceneTarget.style.removeProperty("--scene-tilt-z");
      sceneTarget.style.removeProperty("--scene-shift-x");
      sceneTarget.style.removeProperty("--scene-shift-y");
      if (body.style.isolation === "isolate") body.style.isolation = previousIsolation;
    }

    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", resetPointerTarget, { passive: true });
    window.addEventListener("touchcancel", resetPointerTarget, { passive: true });
    window.addEventListener("arcana:gesturepointer", onGesturePointer);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    addMediaListener(reducedMotion, onReducedMotionChange);
    addMediaListener(darkScheme, onThemeChange);

    resize();
    syncCssParallax();
    draw();
    startLoop();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
