(function installArcanaAudio() {
  "use strict";

  const STORAGE_KEY = "arcana-audio-muted-v1";
  const ACTIVE_MASTER_GAIN = 0.36;
  const SILENCE = 0.0001;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const unlockEvents = ["pointerdown", "touchstart", "keydown"];

  let context = null;
  let masterGain = null;
  let ambienceBus = null;
  let confirmBus = null;
  let started = false;
  let destroyed = false;
  let unlockListening = false;
  let startPromise = null;
  let ambienceTimer = 0;
  let suspendTimer = 0;
  let muted = readStoredMute();

  const longLivedSources = new Set();
  const transientSources = new Set();

  // Reduced-motion is deliberately not used as an audio preference. The
  // module does no visual/RAF work and suspends itself when hidden or muted.
  const reducedMotionPreference = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  void reducedMotionPreference;

  function readStoredMute() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return value === "1" || value === "true";
    } catch {
      return false;
    }
  }

  function storeMute(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Private browsing and file:// previews can deny localStorage.
    }
  }

  function trackSource(source, collection) {
    collection.add(source);
    source.addEventListener("ended", () => collection.delete(source), { once: true });
    return source;
  }

  function stopSources(collection, when) {
    collection.forEach((source) => {
      try {
        source.stop(when);
      } catch {
        // A source may already have stopped naturally.
      }
    });
    collection.clear();
  }

  function holdAndRamp(parameter, target, duration) {
    if (!context || !parameter) return;

    const now = context.currentTime;
    if (typeof parameter.cancelAndHoldAtTime === "function") {
      parameter.cancelAndHoldAtTime(now);
    } else {
      const current = Math.max(0, Number(parameter.value) || 0);
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(current, now);
    }
    parameter.linearRampToValueAtTime(target, now + Math.max(0.01, duration));
  }

  function createNoiseBuffer() {
    const length = Math.max(1, Math.floor(context.sampleRate * 2));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;

    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.86 + white * 0.14;
      channel[index] = previous * 0.72;
    }
    return buffer;
  }

  function createDrone(destination, frequency, type, level, lfoRate, lfoDepth) {
    const oscillator = trackSource(context.createOscillator(), longLivedSources);
    const voiceGain = context.createGain();
    const lfo = trackSource(context.createOscillator(), longLivedSources);
    const lfoGain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    voiceGain.gain.value = level;
    lfo.type = "sine";
    lfo.frequency.value = lfoRate;
    lfoGain.gain.value = lfoDepth;

    lfo.connect(lfoGain).connect(voiceGain.gain);
    oscillator.connect(voiceGain).connect(destination);
    oscillator.start();
    lfo.start();
  }

  function buildGraph() {
    if (context || !AudioContextClass || destroyed) return Boolean(context);

    context = new AudioContextClass({ latencyHint: "playback" });
    masterGain = context.createGain();
    ambienceBus = context.createGain();
    confirmBus = context.createGain();

    const compressor = context.createDynamicsCompressor();
    const ambienceFilter = context.createBiquadFilter();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    const noise = trackSource(context.createBufferSource(), longLivedSources);

    masterGain.gain.value = SILENCE;
    ambienceBus.gain.value = 0.76;
    confirmBus.gain.value = 0.7;

    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.018;
    compressor.release.value = 0.48;

    ambienceFilter.type = "lowpass";
    ambienceFilter.frequency.value = 610;
    ambienceFilter.Q.value = 0.62;

    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 420;
    noiseFilter.Q.value = 0.72;
    noiseGain.gain.value = 0.018;

    ambienceBus.connect(masterGain);
    confirmBus.connect(masterGain);
    masterGain.connect(compressor).connect(context.destination);

    ambienceFilter.connect(ambienceBus);
    createDrone(ambienceFilter, 55, "sine", 0.038, 0.031, 0.006);
    createDrone(ambienceFilter, 82.41, "sine", 0.021, 0.023, 0.004);
    createDrone(ambienceFilter, 110, "triangle", 0.009, 0.017, 0.002);

    noise.buffer = createNoiseBuffer();
    noise.loop = true;
    noise.connect(noiseFilter).connect(noiseGain).connect(ambienceBus);
    noise.start();

    return true;
  }

  function createSoftTone(frequency, startAt, duration, peak, destination, options) {
    const settings = options || {};
    const oscillator = trackSource(context.createOscillator(), transientSources);
    const toneGain = context.createGain();
    const toneFilter = context.createBiquadFilter();

    oscillator.type = settings.type || "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (settings.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, settings.endFrequency),
        startAt + duration
      );
    }
    if (settings.detune) oscillator.detune.value = settings.detune;

    toneFilter.type = "lowpass";
    toneFilter.frequency.value = settings.cutoff || 2400;
    toneFilter.Q.value = 0.45;

    toneGain.gain.setValueAtTime(SILENCE, startAt);
    toneGain.gain.exponentialRampToValueAtTime(
      Math.max(SILENCE, peak),
      startAt + Math.min(0.18, duration * 0.18)
    );
    toneGain.gain.exponentialRampToValueAtTime(SILENCE, startAt + duration);

    oscillator.connect(toneFilter).connect(toneGain).connect(destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.04);
  }

  function clearAmbienceTimer() {
    if (!ambienceTimer) return;
    window.clearTimeout(ambienceTimer);
    ambienceTimer = 0;
  }

  function scheduleAmbientChime() {
    clearAmbienceTimer();
    if (
      destroyed ||
      muted ||
      document.hidden ||
      !context ||
      context.state !== "running"
    ) return;

    const delay = 15000 + Math.random() * 10000;
    ambienceTimer = window.setTimeout(() => {
      ambienceTimer = 0;
      if (!muted && !document.hidden && context && context.state === "running") {
        const roots = [174.61, 196, 220];
        const root = roots[Math.floor(Math.random() * roots.length)];
        const now = context.currentTime + 0.04;
        createSoftTone(root * 2, now, 4.6, 0.012, ambienceBus, {
          cutoff: 1650,
          detune: -4,
        });
        createSoftTone(root * 3, now + 0.16, 3.8, 0.006, ambienceBus, {
          cutoff: 2100,
          detune: 5,
        });
      }
      scheduleAmbientChime();
    }, delay);
  }

  function cancelPendingSuspend() {
    if (!suspendTimer) return;
    window.clearTimeout(suspendTimer);
    suspendTimer = 0;
  }

  function suspendAfterFade(delay) {
    cancelPendingSuspend();
    if (!context || context.state === "closed") return;

    suspendTimer = window.setTimeout(() => {
      suspendTimer = 0;
      if (context && context.state === "running" && (muted || document.hidden)) {
        context.suspend().catch(() => {});
      }
    }, delay);
  }

  function fadeOutAndSuspend() {
    clearAmbienceTimer();
    if (!context || context.state === "closed") return;
    holdAndRamp(masterGain.gain, SILENCE, 0.22);
    suspendAfterFade(280);
  }

  function removeUnlockListeners() {
    if (!unlockListening) return;
    unlockEvents.forEach((eventName) => {
      document.removeEventListener(eventName, onFirstInteraction, true);
    });
    unlockListening = false;
  }

  function installUnlockListeners() {
    if (unlockListening || destroyed) return;
    unlockEvents.forEach((eventName) => {
      document.addEventListener(eventName, onFirstInteraction, {
        capture: true,
        passive: true,
      });
    });
    unlockListening = true;
  }

  function activate() {
    if (destroyed || !AudioContextClass) return Promise.resolve(false);
    if (!buildGraph()) return Promise.resolve(false);

    started = true;
    cancelPendingSuspend();

    if (muted || document.hidden) {
      removeUnlockListeners();
      fadeOutAndSuspend();
      return Promise.resolve(true);
    }

    if (startPromise) return startPromise;
    startPromise = Promise.resolve(context.resume())
      .then(() => {
        if (destroyed) return false;
        if (muted || document.hidden) {
          fadeOutAndSuspend();
          return true;
        }
        removeUnlockListeners();
        holdAndRamp(masterGain.gain, ACTIVE_MASTER_GAIN, 1.35);
        scheduleAmbientChime();
        return true;
      })
      .catch(() => {
        installUnlockListeners();
        return false;
      })
      .finally(() => {
        startPromise = null;
      });

    return startPromise;
  }

  function onFirstInteraction() {
    activate();
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    storeMute(muted);

    if (destroyed) return muted;
    if (muted) {
      fadeOutAndSuspend();
    } else if (started || context) {
      activate();
    } else {
      installUnlockListeners();
    }
    return muted;
  }

  function toggleMuted() {
    return setMuted(!muted);
  }

  function isMuted() {
    return muted;
  }

  function playConfirm(orientation) {
    if (destroyed || muted || document.hidden) return Promise.resolve(false);

    return activate().then((ready) => {
      if (!ready || !context || context.state !== "running" || muted || document.hidden) {
        return false;
      }

      const reversed = String(orientation).toLowerCase() === "reversed";
      const now = context.currentTime + 0.025;
      const notes = reversed
        ? [392, 277.18, 196]
        : [220, 329.63, 493.88];
      const offsets = reversed ? [0, 0.1, 0.23] : [0, 0.11, 0.25];
      const peaks = reversed ? [0.085, 0.07, 0.055] : [0.075, 0.07, 0.065];

      notes.forEach((frequency, index) => {
        createSoftTone(
          frequency,
          now + offsets[index],
          reversed ? 1.38 + index * 0.12 : 1.28 + index * 0.18,
          peaks[index],
          confirmBus,
          {
            type: index === 0 ? "sine" : "triangle",
            cutoff: reversed ? 1450 : 2600,
            detune: reversed ? -7 - index * 2 : index * 3,
          }
        );
      });

      createSoftTone(reversed ? 92 : 110, now, reversed ? 0.92 : 0.68, 0.075, confirmBus, {
        cutoff: reversed ? 520 : 680,
        endFrequency: reversed ? 46 : 72,
      });

      return true;
    });
  }

  function onVisibilityChange() {
    if (!started || destroyed) return;
    if (document.hidden) {
      fadeOutAndSuspend();
    } else if (!muted) {
      activate();
    }
  }

  function onStorageChange(event) {
    if (event.key !== STORAGE_KEY || event.newValue === null) return;
    const nextMuted = event.newValue === "1" || event.newValue === "true";
    if (nextMuted !== muted) setMuted(nextMuted);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    removeUnlockListeners();
    clearAmbienceTimer();
    cancelPendingSuspend();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("storage", onStorageChange);

    if (!context || context.state === "closed") return;

    const closeContext = () => {
      if (!context || context.state === "closed") return;
      const stopAt = context.currentTime + 0.01;
      stopSources(transientSources, stopAt);
      stopSources(longLivedSources, stopAt);
      context.close().catch(() => {});
    };

    if (context.state === "running" && masterGain) {
      holdAndRamp(masterGain.gain, SILENCE, 0.07);
      window.setTimeout(closeContext, 90);
    } else {
      closeContext();
    }
  }

  if (window.ArcanaAudio && typeof window.ArcanaAudio.destroy === "function") {
    window.ArcanaAudio.destroy();
  }

  window.ArcanaAudio = Object.freeze({
    start: activate,
    resume: activate,
    toggleMuted,
    setMuted,
    isMuted,
    playConfirm,
    destroy,
  });

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("storage", onStorageChange);
  installUnlockListeners();
})();
