(function startTarotExperience() {
  "use strict";

  if (!window.TarotDeck || !window.AshParticleSystem) {
    console.error("Tarot bootstrap failed: deck.js or ash.js is missing.");
    return;
  }

  const MEDIAPIPE_VERSION = "0.10.35";
  const MEDIAPIPE_SOURCES = [
    {
      label: "local",
      module: new URL("./vendor/mediapipe/vision_bundle.js", document.baseURI).href,
      wasm: new URL("./vendor/mediapipe/wasm", document.baseURI).href,
      model: new URL("./vendor/mediapipe/hand_landmarker.task", document.baseURI).href,
    },
    {
      label: "cdn",
      module: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`,
      wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
      model: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    },
  ];

  const POSITIONS = [
    { label: "来处", en: "PAST", prompt: "什么仍在影响你" },
    { label: "此刻", en: "PRESENT", prompt: "注意力应该落在哪里" },
    { label: "去向", en: "NEXT", prompt: "什么正在成为可能" },
  ];
  const FAN_TARGET_COUNT = 12;
  const FAN_SUCTION_INTERVAL = 1000 / 30;
  const FAN_PAUSE_PHASES = new Set(["pulling", "preview", "returning", "committing", "ashing"]);
  const GESTURE_AIM = Object.freeze({
    inputYStart: 0.25,
    inputYSpan: 0.55,
    laneYStart: 0.34,
    laneYSpan: 0.38,
    smoothingY: 0.18,
  });
  const RAY_HIT_SLOP = 12;
  const RAY_HIT_STICKY_SLOP = 34;
  const GESTURE_AIM_GRACE_MS = 520;
  const GESTURE_FRAME_GAP_RESET_MS = 280;
  const RAY_STABLE_MS = 80;
  const FIST_CONFIRM_MS = 360;
  const FIST_DROPOUT_GRACE_MS = 160;
  const FIST_RESET_MS = 450;
  const FIST_FRAME_CREDIT_MS = 80;
  const PREVIEW_FIST_ARM_MS = 120;
  const GESTURE_HOLD_MS = Object.freeze({ open: 180, pinch: 140 });
  const GESTURE_COOLDOWN_MS = Object.freeze({ open: 140, pinch: 220, fist: 350 });
  const READING_ARCHIVE_KEY = "arcana-reading-history-v1";
  const READING_ARCHIVE_VERSION = 1;

  const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const catalog = window.TarotDeck.cards;
  const catalogById = new Map(catalog.map((card) => [card.id, card]));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const elements = {
    body: document.body,
    spread: $("#spread"),
    fan: $("#card-fan"),
    fanZone: $("#fan-zone"),
    fanCaption: $("#fan-caption"),
    fanVanishLine: $(".fan-vanish-line"),
    orbit: $("#ritual-orbit"),
    selectionCount: $("#selection-count"),
    selectionDots: $("#selection-dots"),
    stageInstruction: $("#stage-instruction"),
    drawController: $("#draw-controller"),
    drawStateIndex: $("#draw-state-index"),
    drawStateTitle: $("#draw-state-title"),
    drawStateDetail: $("#draw-state-detail"),
    stateActionButton: $("#state-action-button"),
    cancelHeldButton: $("#cancel-held-button"),
    heldPortal: $("#held-card-portal"),
    heldVisual: $("#held-card-visual"),
    heldState: $("#held-card-state"),
    heldName: $("#held-card-name"),
    heldKeywords: $("#held-card-keywords"),
    heldMeaning: $("#held-card-meaning"),
    ashLayer: $("#ash-layer"),
    readingResult: $("#reading-result"),
    readingSummary: $("#reading-summary"),
    readingNotes: $("#reading-notes"),
    restartButton: $("#restart-button"),
    resetButton: $("#shuffle-button"),
    undoButton: $("#undo-button"),
    steps: $("#ritual-steps"),
    questionInput: $("#question-input"),
    historyList: $("#history-list"),
    historyCount: $("#history-count"),
    previousReadingList: $("#previous-reading-list"),
    previousReadingTime: $("#previous-reading-time"),
    previousReadingQuestion: $("#previous-reading-question"),
    imageSourceMode: $("#image-source-mode"),
    cameraButton: $("#camera-button"),
    cameraButtonLabel: $("#camera-button span"),
    cameraVideo: $("#camera-video"),
    handCanvas: $("#hand-canvas"),
    cameraStatus: $("#camera-status"),
    gestureStatus: $("#gesture-status"),
    confidence: $("#status-confidence"),
    gestureCursor: $("#gesture-cursor"),
    gestureRay: $("#gesture-ray"),
    cursorLabel: $(".gesture-cursor__label"),
    soundButton: $("#sound-button"),
    helpButton: $("#help-button"),
    helpDialog: $("#help-dialog"),
    announcer: $("#announcer"),
    localDate: $("#local-date"),
  };

  function safeStorageGet(key, fallback) {
    try {
      return window.localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Some file:// contexts disallow localStorage; the session still works.
    }
  }

  function safeStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage is optional; the current reading still works without it.
    }
  }

  function createReadingSessionId() {
    const randomPart = window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    return `reading-${Date.now().toString(36)}-${randomPart}`.slice(0, 88);
  }

  function sanitizeArchivedReading(record) {
    if (!record || typeof record !== "object") return null;
    const id = typeof record.id === "string" ? record.id : "";
    const completedAt = Number(record.completedAt);
    if (
      !id ||
      id.length > 96 ||
      !Number.isFinite(completedAt) ||
      completedAt <= 0 ||
      completedAt > 8.64e15
    ) return null;
    if (!Array.isArray(record.cards) || record.cards.length !== 3) return null;

    const cards = record.cards.map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const cardId = typeof entry.cardId === "string" ? entry.cardId : "";
      const orientation = entry.orientation;
      const confirmedAt = Number(entry.confirmedAt);
      if (
        !catalogById.has(cardId) ||
        !["upright", "reversed"].includes(orientation) ||
        !Number.isFinite(confirmedAt) ||
        confirmedAt <= 0 ||
        confirmedAt > 8.64e15
      ) return null;
      return { cardId, orientation, confirmedAt };
    });
    if (cards.some((card) => !card) || new Set(cards.map((card) => card.cardId)).size !== 3) return null;

    return {
      id,
      completedAt,
      question: typeof record.question === "string" ? record.question.slice(0, 120) : "",
      cards,
    };
  }

  function parseReadingArchive(raw, { repair = false } = {}) {
    if (!raw) return [];
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      if (repair) safeStorageRemove(READING_ARCHIVE_KEY);
      return [];
    }
    if (!payload || payload.version !== READING_ARCHIVE_VERSION) return [];

    const ids = new Set();
    const records = (Array.isArray(payload.records) ? payload.records : [])
      .slice(0, 12)
      .map(sanitizeArchivedReading)
      .filter((record) => {
        if (!record || ids.has(record.id)) return false;
        ids.add(record.id);
        return true;
      })
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, 2);

    if (repair) {
      if (records.length) safeStorageSet(READING_ARCHIVE_KEY, JSON.stringify({ version: READING_ARCHIVE_VERSION, records }));
      else safeStorageRemove(READING_ARCHIVE_KEY);
    }
    return records;
  }

  function loadReadingArchive() {
    return parseReadingArchive(safeStorageGet(READING_ARCHIVE_KEY, ""), { repair: true });
  }

  function saveReadingArchive(records) {
    if (!records.length) {
      safeStorageRemove(READING_ARCHIVE_KEY);
      return;
    }
    safeStorageSet(READING_ARCHIVE_KEY, JSON.stringify({ version: READING_ARCHIVE_VERSION, records }));
  }

  const reading = {
    remaining: new Set(catalog.map((card) => card.id)),
    history: [],
    sessionId: createReadingSessionId(),
    savedReadings: loadReadingArchive(),
    phase: "idle",
    selectedTarget: null,
    rayHitTarget: null,
    rayHitSince: 0,
    gestureAimGraceUntil: 0,
    pending: null,
    drawToken: 0,
    busy: false,
    imageMode: safeStorageGet("arcana-image-source-v2", "auto"),
    pointer: null,
    suppressClickUntil: 0,
    armedUntil: 0,
    fanInitialized: false,
    gestureMotionHold: false,
    pointerMotionHold: false,
  };

  if (!["auto", "url", "local"].includes(reading.imageMode)) reading.imageMode = "auto";

  const camera = {
    tracker: null,
    trackerPromise: null,
    stream: null,
    frameId: 0,
    startToken: 0,
    lastVideoTime: -1,
    lastInferenceAt: 0,
    lastFrameAt: 0,
    lastHandAt: 0,
    smoothX: 0.5,
    smoothY: 0.62,
    pinchLatched: false,
    candidate: "neutral",
    candidateSince: 0,
    candidateCommitted: false,
    cooldownUntil: 0,
    requiresRelease: false,
    fistEvidenceMs: 0,
    fistLastStrongAt: 0,
    fistLastFrameAt: 0,
    fistPreviousFrameStrong: false,
  };

  const fanSuction = {
    frameId: 0,
    lastFrameAt: 0,
    targets: [],
  };

  const ashParticles = new window.AshParticleSystem(elements.ashLayer);
  const audio = window.ArcanaAudio || null;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function wait(duration) {
    const adjusted = prefersReducedMotion.matches ? Math.min(duration, 24) : duration;
    return new Promise((resolve) => window.setTimeout(resolve, adjusted));
  }

  function withTimeout(promise, duration, message) {
    let timer = 0;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), duration);
      }),
    ]).finally(() => window.clearTimeout(timer));
  }

  function announce(message) {
    if (!message) return;
    elements.announcer.textContent = "";
    window.setTimeout(() => {
      elements.announcer.textContent = message;
    }, 20);
  }

  function syncSoundButton() {
    if (!elements.soundButton) return;
    const enabled = audio ? !audio.isMuted() : false;
    elements.soundButton.disabled = !audio;
    elements.soundButton.setAttribute("aria-pressed", String(enabled));
    elements.soundButton.setAttribute(
      "aria-label",
      enabled ? "关闭背景音乐与确认音效" : "开启背景音乐与确认音效",
    );
    elements.soundButton.title = enabled ? "关闭声音" : "开启声音";
  }

  function orientationLabel(orientation) {
    return orientation === "reversed" ? "逆位" : "正位";
  }

  function cardBackMarkup() {
    return `
      <div class="card-side card-back" aria-hidden="true">
        <div class="card-back-design"><span class="card-back-sun"></span></div>
        <img class="card-back-image" src="./assets/cards/back.svg" alt="" />
      </div>`;
  }

  function cardImageMarkup(card, orientation, context = "card") {
    const name = escapeHtml(card.name);
    const priority = context === "held"
      ? 'loading="eager" decoding="async" fetchpriority="high"'
      : 'loading="lazy" decoding="async"';
    return `
      <div class="rws-image-frame rws-image-frame--${context}" data-orientation="${orientation}">
        <div class="rws-image-placeholder" aria-hidden="true">
          <span>${escapeHtml(card.roman)}</span>
          <strong>${name}</strong>
          <small>图像不可用</small>
        </div>
        <img class="rws-card-image" data-card-id="${card.id}" data-source-index="-1" ${priority}
          alt="${name}，Rider–Waite–Smith 经典牌面" />
      </div>`;
  }

  function cardShellMarkup(instance, options = {}) {
    const card = catalogById.get(instance.cardId);
    const orientation = instance.orientation;
    const flipped = options.flipped !== false;
    const placed = options.placed ? " placed-card" : "";
    const label = `${card.name}，${orientationLabel(orientation)}，${card.meaning[orientation].keywords}`;
    return `
      <div class="tarot-card-shell${placed}${flipped ? " is-flipped" : ""}" role="img"
        aria-label="${escapeHtml(label)}">
        <div class="tarot-card-inner">
          ${cardBackMarkup()}
          <div class="card-side card-face card-face--rws">
            ${cardImageMarkup(card, orientation, options.context || "card")}
            <span class="rws-orientation-badge">${orientationLabel(orientation)}</span>
            <span class="rws-card-name">${escapeHtml(card.name)}</span>
          </div>
        </div>
      </div>`;
  }

  function imageCandidatesFor(card) {
    return window.TarotDeck.imageCandidates(card, reading.imageMode);
  }

  function setImageCandidate(image, index) {
    const card = catalogById.get(image.dataset.cardId);
    if (!card) return;
    const candidates = imageCandidatesFor(card);
    const frame = image.closest(".rws-image-frame");
    frame?.classList.remove("is-loaded", "is-failed");
    if (index >= candidates.length) {
      image.removeAttribute("src");
      image.dataset.sourceIndex = String(index);
      frame?.classList.add("is-failed");
      return;
    }
    image.dataset.sourceIndex = String(index);
    image.src = candidates[index];
  }

  function hydrateImages(root = document) {
    $$(".rws-card-image", root).forEach((image) => {
      if (image.dataset.hydrated === "true") return;
      image.dataset.hydrated = "true";
      setImageCandidate(image, 0);
    });
  }

  document.addEventListener(
    "load",
    (event) => {
      if (!event.target.matches?.(".rws-card-image")) return;
      event.target.closest(".rws-image-frame")?.classList.add("is-loaded");
    },
    true,
  );

  document.addEventListener(
    "error",
    (event) => {
      if (!event.target.matches?.(".rws-card-image")) return;
      const current = Number(event.target.dataset.sourceIndex || 0);
      setImageCandidate(event.target, current + 1);
    },
    true,
  );

  function fanTargetMarkup(index, group) {
    const clone = group === "b";
    const key = `${group}-${index}`;
    const tilt = ((index % 5) - 2) * 0.65;
    const semantics = clone
      ? 'aria-hidden="true"'
      : `id="fan-option-${key}" role="option" aria-selected="false" aria-label="流动牌背 ${index + 1}"`;
    return `
      <div class="fan-card${clone ? " is-loop-clone" : ""}" data-target-key="${key}"
        data-loop-index="${index}" ${semantics} style="--float-tilt:${tilt}deg">
        <div class="fan-card-suction">
          <div class="tarot-card-shell"><div class="tarot-card-inner">${cardBackMarkup()}</div></div>
        </div>
      </div>`;
  }

  function clearFanSuctionTarget(entry) {
    if (!entry?.target || !entry.layer) return;
    if (!entry.target.classList.contains("is-being-absorbed")) return;
    entry.target.classList.remove("is-being-absorbed");
    [
      "--suction-x",
      "--suction-y",
      "--suction-z",
      "--suction-yaw",
      "--suction-roll",
      "--suction-scale-x",
      "--suction-scale-y",
      "--suction-blur",
      "--suction-opacity",
    ].forEach((property) => entry.layer.style.removeProperty(property));
  }

  function resetFanSuction() {
    fanSuction.targets.forEach(clearFanSuctionTarget);
    elements.fanVanishLine?.classList.remove("is-feeding");
  }

  function refreshFanSuctionTargets() {
    fanSuction.targets = $$(".fan-card", elements.fan).map((target) => ({
      target,
      layer: $(".fan-card-suction", target),
    }));
  }

  function updateFanSuction(now) {
    fanSuction.frameId = window.requestAnimationFrame(updateFanSuction);
    if (now - fanSuction.lastFrameAt < FAN_SUCTION_INTERVAL) return;
    fanSuction.lastFrameAt = now;

    const canAnimate =
      !document.hidden &&
      !prefersReducedMotion.matches &&
      ["idle", "armed"].includes(reading.phase) &&
      elements.fanVanishLine &&
      fanSuction.targets.length;
    if (!canAnimate) {
      resetFanSuction();
      return;
    }

    const lineRect = elements.fanVanishLine.getBoundingClientRect();
    const holeX = lineRect.left + lineRect.width / 2;
    const holeY = lineRect.top + lineRect.height / 2;
    const measurements = fanSuction.targets.map((entry, index) => ({
      ...entry,
      index,
      rect: entry.target.getBoundingClientRect(),
      excluded: entry.target.matches(".is-selected, .is-aimed, .is-held"),
    }));
    let strongestPull = 0;

    measurements.forEach(({ target, layer, rect, index, excluded }) => {
      if (!layer || excluded || rect.right < holeX - 10) {
        clearFanSuctionTarget({ target, layer });
        return;
      }
      const captureDistance = rect.width * 1.35 + 12;
      const distanceToHorizon = rect.left - holeX;
      const progress = clamp(1 - distanceToHorizon / captureDistance, 0, 1);
      if (progress <= 0.015) {
        clearFanSuctionTarget({ target, layer });
        return;
      }

      const pull = progress * progress;
      const depthPull = pull * (3 - 2 * progress);
      const cardCenterY = rect.top + rect.height / 2;
      const verticalPull = (holeY - cardCenterY) * depthPull;
      const rollDirection = index % 2 === 0 ? -1 : 1;
      const finalFade = clamp((progress - 0.9) / 0.1, 0, 1);

      layer.style.setProperty("--suction-x", `${(-38 * pull).toFixed(2)}px`);
      layer.style.setProperty("--suction-y", `${verticalPull.toFixed(2)}px`);
      layer.style.setProperty("--suction-z", `${(-118 * depthPull).toFixed(2)}px`);
      layer.style.setProperty("--suction-yaw", `${(-72 * depthPull).toFixed(2)}deg`);
      layer.style.setProperty("--suction-roll", `${(rollDirection * 5.5 * pull).toFixed(2)}deg`);
      layer.style.setProperty("--suction-scale-x", (1 - 0.7 * depthPull).toFixed(3));
      layer.style.setProperty("--suction-scale-y", (1 - 0.16 * depthPull).toFixed(3));
      layer.style.setProperty("--suction-blur", `${(0.72 * finalFade).toFixed(2)}px`);
      layer.style.setProperty("--suction-opacity", (1 - 0.5 * finalFade).toFixed(3));
      target.classList.add("is-being-absorbed");
      strongestPull = Math.max(strongestPull, progress);
    });

    elements.fanVanishLine.classList.toggle("is-feeding", strongestPull > 0.72);
  }

  function renderFan({ force = false } = {}) {
    if (reading.fanInitialized && !force) return;
    const group = (name) => Array.from({ length: FAN_TARGET_COUNT }, (_, index) => fanTargetMarkup(index, name)).join("");
    elements.fan.innerHTML = `
      <div class="card-track" id="card-track">
        <div class="card-loop card-loop--primary">${group("a")}</div>
        <div class="card-loop card-loop--clone" aria-hidden="true">${group("b")}</div>
      </div>`;
    reading.fanInitialized = true;
    refreshFanSuctionTargets();
    reading.selectedTarget = null;
    reading.rayHitTarget = null;
    reading.rayHitSince = 0;
    reading.gestureAimGraceUntil = 0;
    updateFanSelection();
    syncCarouselMotion();
  }

  function fanTargetByKey(key) {
    return key ? $(`.fan-card[data-target-key="${key}"]`, elements.fan) : null;
  }

  function isFanTargetVisible(target) {
    if (!target || !elements.fan.contains(target)) return false;
    const viewport = elements.fan.getBoundingClientRect();
    const line = elements.fanVanishLine?.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const vanishEdge = line ? line.right + 4 : viewport.left + 36;
    return centerX > vanishEdge && rect.left < viewport.right - 6 && rect.bottom > viewport.top && rect.top < viewport.bottom;
  }

  function visibleFanTargets({ primaryOnly = false } = {}) {
    return $$(primaryOnly ? ".fan-card:not(.is-loop-clone)" : ".fan-card", elements.fan)
      .filter(isFanTargetVisible)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }

  function nearestVisibleTarget(preferredRatio = 0.62) {
    const targets = visibleFanTargets();
    if (!targets.length) return null;
    const viewport = elements.fan.getBoundingClientRect();
    const preferredX = viewport.left + viewport.width * preferredRatio;
    return targets.reduce((nearest, target) => {
      const center = target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
      const nearestCenter = nearest.getBoundingClientRect().left + nearest.getBoundingClientRect().width / 2;
      return Math.abs(center - preferredX) < Math.abs(nearestCenter - preferredX) ? target : nearest;
    });
  }

  function syncCarouselMotion() {
    const phasePaused = FAN_PAUSE_PHASES.has(reading.phase);
    const interactionPaused = reading.gestureMotionHold || reading.pointerMotionHold;
    const paused = phasePaused || interactionPaused;
    elements.fan.classList.toggle("is-paused", paused);
    elements.fan.classList.toggle("is-selection-paused", phasePaused || interactionPaused);
    elements.fan.dataset.motion = paused ? "paused" : "running";
  }

  function updateFanSelection({ focus = false } = {}) {
    let activeDescendant = "";
    $$(".fan-card", elements.fan).forEach((target) => {
      const selected = target.dataset.targetKey === reading.selectedTarget;
      const held = target.dataset.targetKey === reading.pending?.targetKey;
      const aimed = selected && (reading.gestureMotionHold || reading.pointerMotionHold);
      target.classList.toggle("is-selected", selected);
      target.classList.toggle("is-aimed", aimed);
      target.classList.toggle("is-held", held);
      if (!target.classList.contains("is-loop-clone")) {
        target.setAttribute("aria-selected", String(selected));
        target.setAttribute("aria-label", `流动牌背 ${Number(target.dataset.loopIndex) + 1}${selected ? "，当前目标" : ""}`);
        if (selected) activeDescendant = target.id;
      }
    });
    if (activeDescendant) elements.fan.setAttribute("aria-activedescendant", activeDescendant);
    else elements.fan.removeAttribute("aria-activedescendant");
    if (focus && ["idle", "armed"].includes(reading.phase)) elements.fan.focus({ preventScroll: true });
  }

  function setSelectedTarget(key, options = {}) {
    if (["pulling", "preview", "returning", "committing", "ashing", "complete", "depleted"].includes(reading.phase)) return;
    if (key === null) {
      reading.selectedTarget = null;
      updateFanSelection(options);
      return;
    }
    const target = fanTargetByKey(key);
    if (!target || (!options.allowOffscreen && !isFanTargetVisible(target))) return;
    if (key === reading.selectedTarget && !options.focus) return;
    reading.selectedTarget = key;
    updateFanSelection(options);
  }

  function selectAdjacentTarget(direction, options = {}) {
    const targets = visibleFanTargets();
    if (!targets.length) return;
    const currentIndex = targets.findIndex((target) => target.dataset.targetKey === reading.selectedTarget);
    const nextIndex = currentIndex < 0
      ? Math.floor((targets.length - 1) / 2)
      : clamp(currentIndex + direction, 0, targets.length - 1);
    setSelectedTarget(targets[nextIndex].dataset.targetKey, options);
  }

  function renderSpread() {
    elements.spread.innerHTML = POSITIONS.map((position, index) => {
      const instance = reading.history[index];
      if (!instance) {
        return `
          <div class="spread-slot" data-slot="${index}" aria-label="${position.label}位置，尚未锁定">
            <span class="slot-index">0${index + 1} / ${position.en}</span>
            <span class="slot-meta"><strong>${position.label}</strong><span>${position.prompt}</span></span>
          </div>`;
      }
      const card = catalogById.get(instance.cardId);
      return `
        <article class="spread-slot is-filled" data-slot="${index}"
          aria-label="${position.label}位置，${escapeHtml(card.name)}${orientationLabel(instance.orientation)}">
          <span class="slot-index">0${index + 1} / ${position.en}</span>
          ${cardShellMarkup(instance, { placed: true, context: "spread" })}
          <span class="slot-meta"><strong>${position.label}</strong><span>${escapeHtml(card.name)} · ${orientationLabel(instance.orientation)}</span></span>
        </article>`;
    }).join("");
    hydrateImages(elements.spread);
  }

  function renderHeldCard() {
    const instance = reading.pending;
    if (!instance) {
      elements.heldPortal.hidden = true;
      elements.heldVisual.innerHTML = "";
      delete elements.heldVisual.dataset.renderKey;
      return;
    }
    const card = catalogById.get(instance.cardId);
    const meaning = card.meaning[instance.orientation];
    elements.heldPortal.hidden = false;
    elements.heldPortal.classList.toggle("is-pulling", reading.phase === "pulling");
    elements.heldPortal.classList.toggle("is-preview", reading.phase === "preview");
    elements.heldPortal.classList.toggle("is-returning", reading.phase === "returning");
    elements.heldPortal.classList.toggle("is-ashing", reading.phase === "ashing");
    const revealFace = ["preview", "committing", "ashing"].includes(reading.phase);
    const renderKey = `${instance.token}:${reading.imageMode}`;
    if (elements.heldVisual.dataset.renderKey !== renderKey || !elements.heldVisual.firstElementChild) {
      elements.heldVisual.innerHTML = cardShellMarkup(instance, { context: "held", flipped: revealFace });
      elements.heldVisual.dataset.renderKey = renderKey;
      hydrateImages(elements.heldVisual);
    }
    $(".tarot-card-shell", elements.heldVisual)?.classList.toggle("is-flipped", revealFace);
    elements.heldState.textContent = `${reading.phase === "preview" ? "PREVIEW" : "HOLD"} / ${orientationLabel(instance.orientation)}`;
    elements.heldName.textContent = `${card.name} · ${card.en}`;
    elements.heldKeywords.textContent = meaning.keywords;
    elements.heldMeaning.textContent = meaning.text;
  }

  function waitForHeldImage(token, timeout = 1800) {
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const inspect = () => {
        if (!reading.pending || reading.pending.token !== token) {
          resolve(false);
          return;
        }
        const image = $(".rws-card-image", elements.heldVisual);
        const frame = image?.closest(".rws-image-frame");
        if (image?.complete && image.naturalWidth > 0) {
          resolve(true);
          return;
        }
        if (frame?.classList.contains("is-failed") || performance.now() - startedAt >= timeout) {
          resolve(false);
          return;
        }
        window.setTimeout(inspect, 32);
      };
      inspect();
    });
  }

  function renderHistory() {
    elements.historyCount.textContent = `${String(reading.history.length).padStart(2, "0")} / 78`;
    if (!reading.history.length) {
      elements.historyList.innerHTML = '<li class="history-empty">尚未锁定结果。第一张牌会记录在这里。</li>';
      return;
    }
    elements.historyList.innerHTML = [...reading.history].reverse().map((instance, reverseIndex) => {
      const card = catalogById.get(instance.cardId);
      const positionIndex = reading.history.length - reverseIndex - 1;
      const meaning = card.meaning[instance.orientation];
      return `
        <li class="history-item" tabindex="-1" data-history-index="${positionIndex}">
          <div class="history-thumb">${cardImageMarkup(card, instance.orientation, "history")}</div>
          <div class="history-copy">
            <span>0${positionIndex + 1} · ${POSITIONS[positionIndex]?.label || "记录"} · ${orientationLabel(instance.orientation)}</span>
            <strong>${escapeHtml(card.name)}</strong>
            <small>${escapeHtml(meaning.keywords)}</small>
          </div>
        </li>`;
    }).join("");
    hydrateImages(elements.historyList);
  }

  const previousReadingDate = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  function visiblePreviousReading() {
    return reading.savedReadings.find((record) => record.id !== reading.sessionId) || null;
  }

  function renderPreviousReading() {
    const record = visiblePreviousReading();
    if (!record) {
      elements.previousReadingTime.textContent = "—";
      elements.previousReadingTime.removeAttribute("datetime");
      elements.previousReadingQuestion.hidden = true;
      elements.previousReadingQuestion.textContent = "";
      elements.previousReadingList.innerHTML =
        '<li class="history-empty">还没有上一轮完整牌阵。完成三张牌后会保存在此设备。</li>';
      return;
    }

    const completedDate = new Date(record.completedAt);
    elements.previousReadingTime.textContent = previousReadingDate.format(completedDate);
    elements.previousReadingTime.dateTime = completedDate.toISOString();
    elements.previousReadingQuestion.hidden = !record.question;
    elements.previousReadingQuestion.textContent = record.question ? `“${record.question}”` : "";
    elements.previousReadingList.innerHTML = record.cards.map((instance, index) => {
      const card = catalogById.get(instance.cardId);
      return `
        <li class="history-item previous-reading__item">
          <div class="history-thumb">${cardImageMarkup(card, instance.orientation, "previous")}</div>
          <div class="history-copy">
            <span>0${index + 1} · ${POSITIONS[index].label} · ${orientationLabel(instance.orientation)}</span>
            <strong>${escapeHtml(card.name)}</strong>
            <small>${escapeHtml(card.en)}</small>
          </div>
        </li>`;
    }).join("");
    hydrateImages(elements.previousReadingList);
  }

  function archiveCompletedReading() {
    if (reading.history.length !== 3) return;
    const record = {
      id: reading.sessionId,
      completedAt: Date.now(),
      question: elements.questionInput.value.trim().slice(0, 120),
      cards: reading.history.map((instance) => ({
        cardId: instance.cardId,
        orientation: instance.orientation,
        confirmedAt: instance.confirmedAt,
      })),
    };
    reading.savedReadings = [
      record,
      ...reading.savedReadings.filter((saved) => saved.id !== reading.sessionId),
    ].slice(0, 2);
    saveReadingArchive(reading.savedReadings);
    renderPreviousReading();
  }

  function removeCurrentReadingArchive() {
    const next = reading.savedReadings.filter((record) => record.id !== reading.sessionId);
    if (next.length === reading.savedReadings.length) return;
    reading.savedReadings = next;
    saveReadingArchive(reading.savedReadings);
    renderPreviousReading();
  }

  function renderReading() {
    if (reading.history.length !== 3) return;
    const cards = reading.history.map((instance) => ({
      instance,
      card: catalogById.get(instance.cardId),
    }));
    elements.readingSummary.textContent =
      `从「${cards[0].card.name}」走向「${cards[2].card.name}」，「${cards[1].card.name}」是此刻的转轴。` +
      "三张牌已经锁定；把它们作为观察问题的三个角度，而不是唯一答案。";
    elements.readingNotes.innerHTML = cards.map(({ instance, card }, index) => {
      const meaning = card.meaning[instance.orientation];
      return `
        <article class="reading-note">
          <span>0${index + 1} · ${POSITIONS[index].label} · ${orientationLabel(instance.orientation)}</span>
          <h3>${escapeHtml(card.name)}｜${escapeHtml(meaning.keywords)}</h3>
          <p>${escapeHtml(meaning.text)}</p>
        </article>`;
    }).join("");
  }

  function updateSteps() {
    const items = $$("li", elements.steps);
    items.forEach((item) => item.classList.remove("is-current", "is-done"));
    if (reading.phase === "complete") {
      items.forEach((item) => item.classList.add("is-done"));
      items[2]?.classList.add("is-current");
    } else if (["pulling", "preview"].includes(reading.phase)) {
      items[0]?.classList.add("is-done");
      items[1]?.classList.add("is-current");
    } else if (["committing", "ashing"].includes(reading.phase)) {
      items[0]?.classList.add("is-done");
      items[1]?.classList.add("is-done");
      items[2]?.classList.add("is-current");
    } else {
      items[0]?.classList.add("is-current");
    }
  }

  function actionButtonLabel(label) {
    elements.stateActionButton.innerHTML = `${label}<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 7 7-7 7"></path></svg>`;
  }

  function updateInterface() {
    elements.body.dataset.drawPhase = reading.phase;
    elements.selectionCount.textContent = `${String(reading.history.length).padStart(2, "0")} / 03`;
    $$("i", elements.selectionDots).forEach((dot, index) => {
      dot.classList.toggle("is-filled", index < reading.history.length);
    });

    const controller = {
      idle: ["OPEN / 01", "牌库正在休眠", "张开手掌，或点击按钮允许下一次抽取。", "进入待抽牌", false],
      armed: ["ARMED / 02", "牌库已允许抽取", "让射线命中一张牌背，再以 PINCH 捏合抓取。", "抓取高亮牌", false],
      pulling: ["PULL / 03", "正在拉近牌面", "牌面与正逆位已经冻结，不会因重绘改变。", "拉近中…", true],
      preview: ["FIST / 04", "牌面尚未锁定", "核对牌名、正逆位和含义；握拳或点击确认。", "确认并锁定", false],
      returning: ["RETURN / 04", "正在放回牌库", "牌带保持静止，卡牌返回原来的轨道。", "放回中…", true],
      committing: ["LOCK / 05", "正在锁定结果", "牌库与历史记录正在进行原子更新。", "锁定中…", true],
      ashing: ["ASH / 06", "结果已经写入历史", "牌面正在化为灰烬，下一张牌背即将生成。", "生成下一张…", true],
      complete: ["DONE / 03", "三张结果均已锁定", "阅读牌面手记，或开始一轮新的三张牌阵。", "开始新牌局", false],
      depleted: ["EMPTY / 78", "牌库已经抽空", "重置牌库后才能继续。", "重置牌库", false],
    }[reading.phase];

    elements.drawStateIndex.textContent = controller[0];
    elements.drawStateTitle.textContent = controller[1];
    elements.drawStateDetail.textContent = controller[2];
    actionButtonLabel(controller[3]);
    elements.stateActionButton.disabled = controller[4] || reading.busy;
    elements.cancelHeldButton.hidden = !["pulling", "preview"].includes(reading.phase);
    elements.fanZone.hidden = reading.phase === "complete" || reading.phase === "depleted";
    elements.readingResult.hidden = reading.phase !== "complete";
    elements.undoButton.hidden = !reading.history.length || Boolean(reading.pending);
    elements.undoButton.disabled = reading.busy;
    elements.resetButton.disabled = reading.busy;
    elements.imageSourceMode.disabled = ["committing", "ashing"].includes(reading.phase);

    const fanIsInteractive = ["idle", "armed"].includes(reading.phase);
    elements.fanZone.toggleAttribute("inert", !fanIsInteractive);
    elements.fanZone.setAttribute("aria-disabled", String(!fanIsInteractive));
    elements.fan.setAttribute("aria-disabled", String(!fanIsInteractive));

    const instructions = {
      idle: "张开手掌，进入待抽牌状态",
      armed: "射线对准牌背后捏合，随机牌面才会生成",
      pulling: "牌面正在被拉到镜头前",
      preview: "握拳确认；确认前可放回牌库",
      returning: "卡牌正在返回牌带",
      committing: "正在锁定牌名、正逆位与含义",
      ashing: "灰烬上飘，下一张牌正在准备",
      complete: "三张牌已锁定，请阅读牌面手记",
      depleted: "牌库已空，请重置",
    };
    elements.stageInstruction.textContent = instructions[reading.phase];
    updateSteps();
    updateFanSelection();
    syncCarouselMotion();
    if (reading.phase === "complete") renderReading();
  }

  function renderAll({ rebuildFan = false } = {}) {
    renderSpread();
    renderFan({ force: rebuildFan });
    renderHeldCard();
    renderHistory();
    renderPreviousReading();
    updateInterface();
  }

  function focusStateAction() {
    window.requestAnimationFrame(() => {
      if (!elements.helpDialog.open && !elements.stateActionButton.disabled) {
        elements.stateActionButton.focus({ preventScroll: true });
      }
    });
  }

  function armDraw(origin = "manual", silent = false) {
    if (reading.busy || reading.pending || reading.history.length >= 3 || reading.remaining.size === 0) return false;
    reading.phase = "armed";
    reading.armedUntil = origin === "gesture" ? performance.now() + 5000 : Number.POSITIVE_INFINITY;
    updateInterface();
    if (!silent) announce("牌库已允许抽取。请让准星命中一张牌背后捏合。");
    return true;
  }

  function randomRemainingCard() {
    const ids = [...reading.remaining];
    if (!ids.length) return null;
    return catalogById.get(ids[Math.floor(Math.random() * ids.length)]);
  }

  async function grabTarget(targetKey = reading.selectedTarget, origin = "manual") {
    if (reading.busy || reading.pending || reading.history.length >= 3) return;
    if (reading.phase === "idle" && origin !== "gesture") armDraw("manual", true);
    if (reading.phase !== "armed") return;
    let sourceTarget = fanTargetByKey(targetKey);
    if (!isFanTargetVisible(sourceTarget)) {
      sourceTarget = nearestVisibleTarget();
      targetKey = sourceTarget?.dataset.targetKey || null;
    }
    if (origin === "gesture" && targetKey === null) {
      setGestureReadout("射线尚未命中", "把准星移到任意牌背上再捏合");
      return;
    }
    if (!sourceTarget || targetKey === null) return;

    const card = randomRemainingCard();
    if (!card) {
      reading.phase = "depleted";
      updateInterface();
      return;
    }

    const token = ++reading.drawToken;
    const orientation = Math.random() < 0.5 ? "reversed" : "upright";
    const sourceRect = sourceTarget.getBoundingClientRect();
    const orbitRect = elements.orbit.getBoundingClientRect();
    const pullFromX = sourceRect.left + sourceRect.width / 2 - (orbitRect.left + orbitRect.width / 2);
    const pullFromY = sourceRect.top + sourceRect.height / 2 - (orbitRect.top + orbitRect.height * 0.4);
    elements.heldPortal.style.setProperty("--pull-from-x", `${pullFromX}px`);
    elements.heldPortal.style.setProperty("--pull-from-y", `${pullFromY}px`);
    elements.heldPortal.style.setProperty("--pull-from-rotate", `${sourceTarget.style.getPropertyValue("--float-tilt") || "0deg"}`);
    reading.pending = {
      token,
      cardId: card.id,
      orientation,
      targetKey,
      sourceRect: {
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
      },
      committed: false,
    };
    reading.gestureAimGraceUntil = 0;
    reading.phase = "pulling";
    renderHeldCard();
    updateInterface();
    announce(`已抓取一张随机牌，${orientationLabel(orientation)}，正在拉近展示。`);
    await Promise.all([wait(420), waitForHeldImage(token)]);
    if (!reading.pending || reading.pending.token !== token || reading.pending.committed) return;
    reading.phase = "preview";
    reading.pending.previewSince = performance.now();
    camera.pinchLatched = false;
    // A brief landmark loss during the pull animation must not force the user
    // to reopen their hand before the preview-only FIST action can begin.
    camera.requiresRelease = false;
    resetGestureCandidate();
    renderHeldCard();
    updateInterface();
    const cardName = catalogById.get(reading.pending.cardId).name;
    announce(`${cardName}，${orientationLabel(orientation)}。握拳或点击确认抽牌。`);
    focusStateAction();
  }

  async function cancelPending() {
    if (!reading.pending || reading.pending.committed || reading.busy) return;
    const pending = reading.pending;
    const card = catalogById.get(pending.cardId);
    reading.busy = true;
    reading.phase = "returning";
    renderHeldCard();
    updateInterface();
    await wait(280);
    if (!reading.pending || reading.pending.token !== pending.token) return;
    reading.drawToken += 1;
    reading.pending = null;
    reading.selectedTarget = null;
    reading.pointerMotionHold = false;
    reading.busy = false;
    reading.phase = "idle";
    renderHeldCard();
    updateInterface();
    resetGestureTracking();
    announce(`${card.name}已放回牌库，没有消耗抽牌机会。`);
    focusStateAction();
  }

  function confirmedSnapshot(pending) {
    const card = catalogById.get(pending.cardId);
    return Object.freeze({
      cardId: card.id,
      name: card.name,
      orientation: pending.orientation,
      orientationLabel: orientationLabel(pending.orientation),
      meaning: card.meaning[pending.orientation],
      confirmedAt: Date.now(),
    });
  }

  async function confirmPending(origin = "manual") {
    if (reading.phase !== "preview" || !reading.pending || reading.pending.committed || reading.busy) return;
    const pending = reading.pending;
    pending.committed = true;
    reading.busy = true;
    reading.phase = "committing";
    updateInterface();
    void audio?.playConfirm(pending.orientation);

    const heldElement = $(".tarot-card-shell", elements.heldVisual);
    const ashColor = pending.orientation === "reversed" ? "#76584d" : "#a96c48";
    const ashPromise = ashParticles.disintegrate(heldElement, { color: ashColor }).catch(() => ({ mode: "fallback" }));

    const snapshot = confirmedSnapshot(pending);
    reading.remaining.delete(pending.cardId);
    reading.history.push(snapshot);
    if (reading.history.length === 3) archiveCompletedReading();
    reading.phase = "ashing";
    elements.heldPortal.classList.remove("is-preview", "is-pulling");
    elements.heldPortal.classList.add("is-ashing");
    reading.busy = false;
    renderSpread();
    renderHistory();
    updateInterface();
    announce(`${snapshot.name}${snapshot.orientationLabel}已锁定并写入历史记录。`);

    const token = pending.token;
    await wait(460);
    if (!reading.pending || reading.pending.token !== token) return;
    reading.pending = null;
    reading.selectedTarget = null;
    reading.pointerMotionHold = false;
    reading.phase = reading.history.length >= 3 ? "complete" : reading.remaining.size ? "idle" : "depleted";
    renderAll();
    resetGestureTracking();
    camera.cooldownUntil = performance.now() + 850;
    void ashPromise;

    if (reading.phase === "complete") {
      announce("三张牌已全部锁定，牌面手记已经展开。");
      elements.readingResult.scrollIntoView({
        behavior: prefersReducedMotion.matches ? "auto" : "smooth",
        block: "nearest",
      });
    } else {
      announce("下一张待抽牌已经生成。再次张开手掌即可允许抽取。");
      if (origin === "keyboard") focusStateAction();
    }
  }

  function undoLast() {
    if (reading.busy || reading.pending || !reading.history.length) return;
    const restoreFocus = document.activeElement === elements.undoButton;
    const wasComplete = reading.history.length === 3;
    const instance = reading.history.pop();
    if (wasComplete) removeCurrentReadingArchive();
    reading.remaining.add(instance.cardId);
    reading.phase = "idle";
    renderAll();
    announce(`${instance.name}${instance.orientationLabel}已从历史撤回并放回牌库。`);
    if (restoreFocus && elements.undoButton.hidden) focusStateAction();
  }

  function resetReading() {
    if (reading.busy) return;
    const restoreFocus = [elements.restartButton, elements.cancelHeldButton, elements.resetButton]
      .includes(document.activeElement);
    ashParticles.finishAll("reset");
    reading.drawToken += 1;
    reading.remaining = new Set(catalog.map((card) => card.id));
    reading.history = [];
    reading.sessionId = createReadingSessionId();
    reading.pending = null;
    reading.phase = "idle";
    reading.selectedTarget = null;
    reading.rayHitTarget = null;
    reading.rayHitSince = 0;
    reading.gestureAimGraceUntil = 0;
    reading.busy = false;
    reading.gestureMotionHold = false;
    reading.pointerMotionHold = false;
    renderAll({ rebuildFan: true });
    resetGestureTracking();
    announce("完整 78 张牌库已经重置。");
    if (restoreFocus) focusStateAction();
  }

  function handleStateAction() {
    if (reading.phase === "idle") armDraw("manual");
    else if (reading.phase === "armed") void grabTarget(reading.selectedTarget || nearestVisibleTarget()?.dataset.targetKey, "manual");
    else if (reading.phase === "preview") void confirmPending("manual");
    else if (["complete", "depleted"].includes(reading.phase)) resetReading();
  }

  function setGestureReadout(status, detail, confidence = null) {
    elements.cameraStatus.textContent = status;
    elements.gestureStatus.textContent = detail;
    if (confidence !== null) elements.confidence.textContent = `${Math.round(confidence * 100)}%`;
  }

  function setCameraState(state, status, detail) {
    elements.body.dataset.cameraState = state;
    elements.cameraButton.disabled = state === "loading";
    elements.cameraButtonLabel.textContent =
      state === "active" ? "关闭手势" : state === "loading" ? "正在加载" : state === "error" ? "重试手势" : "启用手势";
    setGestureReadout(status, detail, state === "active" ? 0 : null);
    if (state !== "active") {
      elements.confidence.textContent = "—";
      elements.gestureCursor.classList.remove("is-visible");
      elements.gestureRay.classList.remove("is-visible");
    }
  }

  async function ensureHandTracker() {
    if (camera.tracker) return camera.tracker;
    if (camera.trackerPromise) return camera.trackerPromise;
    camera.trackerPromise = (async () => {
      let lastError;
      for (const source of MEDIAPIPE_SOURCES) {
        try {
          const { FilesetResolver, HandLandmarker } = await withTimeout(
            import(source.module),
            source.label === "local" ? 15_000 : 30_000,
            `${source.label} MediaPipe module timed out.`,
          );
          const vision = await withTimeout(
            FilesetResolver.forVisionTasks(source.wasm),
            source.label === "local" ? 30_000 : 45_000,
            `${source.label} MediaPipe WASM timed out.`,
          );
          const options = (delegate) => ({
            baseOptions: { modelAssetPath: source.model, delegate },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.5,
          });
          try {
            return await HandLandmarker.createFromOptions(vision, options("GPU"));
          } catch (gpuError) {
            console.warn(`${source.label} GPU hand tracking unavailable; using CPU.`, gpuError);
            return await HandLandmarker.createFromOptions(vision, options("CPU"));
          }
        } catch (error) {
          lastError = error;
          console.warn(`${source.label} MediaPipe runtime unavailable.`, error);
        }
      }
      throw lastError || new Error("MediaPipe hand tracking could not be loaded.");
    })();
    try {
      camera.tracker = await camera.trackerPromise;
      return camera.tracker;
    } catch (error) {
      camera.trackerPromise = null;
      throw error;
    }
  }

  function cameraErrorMessage(error) {
    switch (error?.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "未获得摄像头权限，手动操作仍然可用";
      case "NotFoundError":
        return "没有找到可用摄像头，手动操作仍然可用";
      case "NotReadableError":
        return "摄像头正被占用，手动操作仍然可用";
      case "OverconstrainedError":
        return "摄像头不支持所需画面，手动操作仍然可用";
      default:
        return "手势模型未能启动，手动操作仍然可用";
    }
  }

  async function startCamera() {
    if (["active", "loading"].includes(elements.body.dataset.cameraState)) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("error", "手势不可用", "请通过 HTTPS 或 localhost 打开页面");
      announce("当前环境无法访问摄像头，鼠标、触摸与键盘仍可完成全部流程。");
      return;
    }
    const token = ++camera.startToken;
    setCameraState("loading", "等待摄像头授权", "允许后会在本机加载手部识别模型");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      if (token !== camera.startToken) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      camera.stream = stream;
      elements.cameraVideo.srcObject = stream;
      await elements.cameraVideo.play();
      setGestureReadout("正在加载识别模型", "首次使用需要联网下载模型");
      await withTimeout(ensureHandTracker(), 90_000, "Hand tracking model timed out.");
      if (token !== camera.startToken) return;
      camera.lastVideoTime = -1;
      camera.lastInferenceAt = 0;
      camera.lastFrameAt = 0;
      camera.lastHandAt = performance.now();
      camera.smoothX = 0.5;
      camera.smoothY = 0.62;
      resetGestureTracking({ hideCursor: true, requireRelease: true });
      setCameraState("active", "摄像头已开启", "OPEN 张掌允许抽取");
      camera.stream.getVideoTracks()[0]?.addEventListener("ended", handleCameraEnded, { once: true });
      camera.frameId = requestAnimationFrame(detectHandsLoop);
      announce("手势控制已开启。张开手掌允许抽牌。");
    } catch (error) {
      console.error("Unable to start gesture control.", error);
      if (token !== camera.startToken) return;
      stopCameraTracks();
      const message = cameraErrorMessage(error);
      setCameraState("error", "无法开启手势", message);
      announce(message);
    }
  }

  function stopCameraTracks() {
    camera.stream?.getTracks().forEach((track) => track.stop());
    camera.stream = null;
    elements.cameraVideo.srcObject = null;
  }

  function stopCamera(options = {}) {
    camera.startToken += 1;
    if (camera.frameId) cancelAnimationFrame(camera.frameId);
    camera.frameId = 0;
    stopCameraTracks();
    clearHandCanvas();
    resetGestureTracking({ hideCursor: true });
    if (options.errorDetail) setCameraState("error", "摄像头已中断", options.errorDetail);
    else setCameraState("off", "摄像头关闭", "鼠标、触摸与键盘仍可完成全部流程");
    if (options.announceChange !== false) announce(options.errorDetail || "手势控制已经关闭。");
  }

  function handleCameraEnded() {
    if (elements.body.dataset.cameraState === "active") {
      stopCamera({ errorDetail: "设备停止画面，待确认牌与历史均已保留" });
    }
  }

  function toggleCamera() {
    if (elements.body.dataset.cameraState === "active") stopCamera();
    else void startCamera();
  }

  function clearHandCanvas() {
    const context = elements.handCanvas.getContext("2d");
    context?.clearRect(0, 0, elements.handCanvas.width, elements.handCanvas.height);
  }

  function drawHandLandmarks(landmarks) {
    const canvas = elements.handCanvas;
    const video = elements.cameraVideo;
    if (!video.videoWidth || !video.videoHeight) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const context = canvas.getContext("2d");
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#8c3e29";
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = Math.max(1.5, canvas.width / 340);
    context.strokeStyle = accent;
    context.fillStyle = "rgba(255,249,239,.86)";
    for (const [from, to] of HAND_CONNECTIONS) {
      context.beginPath();
      context.moveTo((1 - landmarks[from].x) * canvas.width, landmarks[from].y * canvas.height);
      context.lineTo((1 - landmarks[to].x) * canvas.width, landmarks[to].y * canvas.height);
      context.stroke();
    }
    for (const landmark of landmarks) {
      context.beginPath();
      context.arc((1 - landmark.x) * canvas.width, landmark.y * canvas.height, Math.max(2.1, canvas.width / 180), 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  function distance3(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  }

  function distanceImage(a, b, aspectRatio) {
    return Math.hypot((a.x - b.x) * aspectRatio, a.y - b.y);
  }

  function angleAt(a, b, c) {
    const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
    const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
    const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
    const magnitude = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z);
    return Math.acos(clamp(dot / Math.max(magnitude, 1e-6), -1, 1)) * (180 / Math.PI);
  }

  function classifyHandGesture(landmarks, worldLandmarks) {
    const worldIndices = [0, 4, 5, 8, 9, 17];
    const hasWorldLandmarks =
      Array.isArray(worldLandmarks) &&
      worldLandmarks.length >= 21 &&
      worldIndices.every((index) => {
        const point = worldLandmarks[index];
        return Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.z);
      });
    const points = hasWorldLandmarks ? worldLandmarks : landmarks;
    const videoWidth = elements.cameraVideo.videoWidth;
    const videoHeight = elements.cameraVideo.videoHeight;
    const imageAspect = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 4 / 3;
    const imagePalmScale = Math.max(
      distanceImage(landmarks[5], landmarks[17], imageAspect),
      distanceImage(landmarks[0], landmarks[9], imageAspect),
      1e-6,
    );
    const imagePinchRatio = distanceImage(landmarks[4], landmarks[8], imageAspect) / imagePalmScale;
    let spatialPinchRatio = Number.POSITIVE_INFINITY;
    if (hasWorldLandmarks) {
      const spatialPalmScale = Math.max(
        distance3(points[5], points[17]),
        distance3(points[0], points[9]),
        1e-6,
      );
      spatialPinchRatio = distance3(points[4], points[8]) / spatialPalmScale;
    }
    const enterPinch = imagePinchRatio < 0.3 || (imagePinchRatio < 0.42 && spatialPinchRatio < 0.34);
    const keepPinch = imagePinchRatio < 0.46 || (imagePinchRatio < 0.54 && spatialPinchRatio < 0.46);
    camera.pinchLatched = camera.pinchLatched ? keepPinch : enterPinch;
    const pinchRatio = imagePinchRatio;
    const fingers = [
      [5, 6, 8],
      [9, 10, 12],
      [13, 14, 16],
      [17, 18, 20],
    ];
    const extended = fingers.map(([mcp, pip, tip]) => {
      const straight = angleAt(points[mcp], points[pip], points[tip]) > 150;
      const away = distance3(points[tip], points[0]) > distance3(points[pip], points[0]) * 1.06;
      return straight && away;
    });
    const extendedCount = extended.filter(Boolean).length;
    const curled = fingers.map(([mcp, pip, tip]) => {
      const bentAtPip = angleAt(points[mcp], points[pip], points[tip]) < 145;
      const foldedTowardPalm =
        distance3(points[tip], points[0]) <= distance3(points[pip], points[0]) * 1.08;
      return bentAtPip || foldedTowardPalm;
    });
    const curledCount = curled.filter(Boolean).length;
    const coreCurledCount = curled.slice(1).filter(Boolean).length;
    const strongFist = curledCount >= 3 && curled[0] && coreCurledCount >= 2 && extendedCount <= 1;
    const details = {
      pinchRatio,
      imagePinchRatio,
      spatialPinchRatio,
      extended,
      curled,
      extendedCount,
      strongFist,
    };
    // A closed fist also brings thumb and index together. Once a card is in preview,
    // strong curl evidence must outrank the PINCH latch or confirmation will flicker.
    if (reading.phase === "preview" && strongFist) {
      camera.pinchLatched = false;
      return { name: "fist", ...details };
    }
    if (camera.pinchLatched) {
      return { name: "pinch", ...details };
    }
    if (strongFist || extendedCount === 0) return { name: "fist", ...details };
    if (extendedCount >= 3 && imagePinchRatio > 0.5) return { name: "open", ...details };
    return { name: "neutral", ...details };
  }

  function resetFistEvidence() {
    camera.fistEvidenceMs = 0;
    camera.fistLastStrongAt = 0;
    camera.fistLastFrameAt = 0;
    camera.fistPreviousFrameStrong = false;
  }

  function resetGestureCandidate() {
    camera.candidate = "neutral";
    camera.candidateSince = 0;
    camera.candidateCommitted = false;
    resetFistEvidence();
    elements.gestureCursor.style.setProperty("--gesture-progress", "0deg");
    elements.cursorLabel.textContent = "追踪";
  }

  function resetGestureTracking({ hideCursor = false, requireRelease = false } = {}) {
    resetGestureCandidate();
    camera.pinchLatched = false;
    camera.lastFrameAt = 0;
    if (requireRelease) camera.requiresRelease = true;
    reading.rayHitTarget = null;
    reading.rayHitSince = 0;
    reading.gestureAimGraceUntil = 0;
    reading.gestureMotionHold = false;
    if (!reading.pending && !reading.pointerMotionHold) reading.selectedTarget = null;
    elements.gestureRay.classList.remove("is-visible");
    if (hideCursor) elements.gestureCursor.classList.remove("is-visible");
    updateFanSelection();
    syncCarouselMotion();
  }

  function expireGestureArm(now) {
    if (
      reading.phase === "armed" &&
      Number.isFinite(reading.armedUntil) &&
      now > reading.armedUntil
    ) {
      reading.phase = "idle";
      reading.armedUntil = 0;
      resetGestureTracking();
      updateInterface();
      return true;
    }
    return false;
  }

  function fanTargetFromPoint(clientX, clientY) {
    const stack = document.elementsFromPoint?.(clientX, clientY) || [];
    for (const element of stack) {
      const target = element.closest?.(".fan-card");
      if (target && elements.fan.contains(target) && isFanTargetVisible(target)) return target;
    }
    return null;
  }

  function targetContainsPoint(target, clientX, clientY, slop) {
    if (!target || !isFanTargetVisible(target)) return false;
    const rect = target.getBoundingClientRect();
    return clientX >= rect.left - slop && clientX <= rect.right + slop &&
      clientY >= rect.top - slop && clientY <= rect.bottom + slop;
  }

  function findRayHit(clientX, clientY, { retainCurrent = false } = {}) {
    const currentTarget = fanTargetByKey(reading.rayHitTarget);
    if (retainCurrent && targetContainsPoint(currentTarget, clientX, clientY, RAY_HIT_STICKY_SLOP)) {
      return currentTarget.dataset.targetKey;
    }

    const directTarget = fanTargetFromPoint(clientX, clientY);
    if (directTarget) return directTarget.dataset.targetKey;

    const candidates = currentTarget && isFanTargetVisible(currentTarget)
      ? [currentTarget, ...visibleFanTargets().filter((target) => target !== currentTarget)]
      : visibleFanTargets();
    let nearest = null;
    let nearestDistance = Infinity;
    for (const target of candidates) {
      const rect = target.getBoundingClientRect();
      if (clientY < rect.top - RAY_HIT_SLOP || clientY > rect.bottom + RAY_HIT_SLOP) continue;
      const distanceX = clientX < rect.left
        ? rect.left - clientX
        : clientX > rect.right
          ? clientX - rect.right
          : 0;
      if (distanceX <= RAY_HIT_SLOP && distanceX < nearestDistance) {
        nearest = target;
        nearestDistance = distanceX;
      }
    }
    return nearest?.dataset.targetKey || null;
  }

  function updateGestureRay(clientX, clientY, targetKey) {
    if (targetKey === null || ["pulling", "preview", "returning", "committing", "ashing", "complete"].includes(reading.phase)) {
      elements.gestureRay.classList.remove("is-visible");
      return;
    }
    const target = fanTargetByKey(targetKey);
    if (!isFanTargetVisible(target)) {
      elements.gestureRay.classList.remove("is-visible");
      return;
    }
    const rect = target.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.top + rect.height * 0.46;
    const dx = targetX - clientX;
    const dy = targetY - clientY;
    const distance = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    elements.gestureRay.style.width = `${distance}px`;
    elements.gestureRay.style.transform = `translateY(-50%) rotate(${angle}deg)`;
    elements.gestureRay.classList.add("is-visible");
  }

  function updateRayTarget(clientX, clientY, now, options = {}) {
    const observedHit = findRayHit(clientX, clientY, options);
    const canPreserveCurrent =
      options.preserveOnMiss &&
      observedHit === null &&
      reading.rayHitTarget !== null &&
      now <= reading.gestureAimGraceUntil &&
      isFanTargetVisible(fanTargetByKey(reading.rayHitTarget));
    const hit = canPreserveCurrent ? reading.rayHitTarget : observedHit;
    if (hit !== reading.rayHitTarget) {
      reading.rayHitTarget = hit;
      reading.rayHitSince = now;
    }
    if (hit !== null) {
      setSelectedTarget(hit);
    } else if (!reading.pending && !reading.pointerMotionHold) {
      setSelectedTarget(null);
    }
    updateGestureRay(clientX, clientY, hit);
    return { targetKey: hit, observed: observedHit !== null };
  }

  function updateFistEvidence(gesture, now) {
    if (reading.phase !== "preview") {
      resetFistEvidence();
      return { strong: false, tracking: false, withinGrace: false, progress: 0 };
    }

    const strong = gesture.strongFist === true;
    const previousFrameStrong = camera.fistPreviousFrameStrong;
    const frameDelta = camera.fistLastFrameAt
      ? clamp(now - camera.fistLastFrameAt, 0, FIST_FRAME_CREDIT_MS)
      : 0;
    camera.fistLastFrameAt = now;

    if (gesture.name === "open") {
      resetFistEvidence();
      return { strong: false, tracking: false, withinGrace: false, progress: 0 };
    }

    const previousStrongGap = camera.fistLastStrongAt
      ? now - camera.fistLastStrongAt
      : Number.POSITIVE_INFINITY;
    if (!strong && previousStrongGap > FIST_RESET_MS) {
      resetFistEvidence();
      camera.fistLastFrameAt = now;
      return { strong: false, tracking: false, withinGrace: false, progress: 0 };
    }

    if (strong && previousFrameStrong) {
      camera.fistEvidenceMs = Math.min(FIST_CONFIRM_MS, camera.fistEvidenceMs + frameDelta);
    }
    if (strong) {
      camera.fistLastStrongAt = now;
    }
    camera.fistPreviousFrameStrong = strong;

    const strongGap = camera.fistLastStrongAt
      ? now - camera.fistLastStrongAt
      : Number.POSITIVE_INFINITY;
    return {
      strong,
      tracking: camera.fistLastStrongAt > 0 && strongGap <= FIST_RESET_MS,
      withinGrace: strongGap <= FIST_DROPOUT_GRACE_MS,
      progress: clamp(camera.fistEvidenceMs / FIST_CONFIRM_MS, 0, 1),
    };
  }

  function updateGestureCandidate(gestureResult, now, confidence) {
    expireGestureArm(now);
    camera.lastFrameAt = now;
    const gesture = gestureResult.name;
    const fistState = updateFistEvidence(gestureResult, now);

    if (reading.phase === "preview" && fistState.tracking) {
      if (camera.candidate !== "fist") {
        camera.candidate = "fist";
        camera.candidateSince = now;
        camera.candidateCommitted = false;
      }
      if (reading.gestureMotionHold) {
        reading.gestureMotionHold = false;
        updateFanSelection();
        syncCarouselMotion();
      }
      const percent = Math.round(fistState.progress * 100);
      elements.gestureCursor.style.setProperty("--gesture-progress", `${fistState.progress * 360}deg`);
      elements.gestureCursor.dataset.gesture = "fist";
      elements.cursorLabel.textContent = `FIST ${percent}%`;
      setGestureReadout(
        fistState.strong ? `识别到 FIST · ${percent}%` : `FIST 确认已暂停 · ${percent}%`,
        fistState.strong
          ? "有效握拳正在累计，保持到锁定"
          : fistState.withinGrace
            ? "短暂识别抖动已容错，继续握拳"
            : "进度暂时保留，请继续收紧四指",
        confidence,
      );

      const previewReady =
        reading.pending?.previewSince && now - reading.pending.previewSince >= PREVIEW_FIST_ARM_MS;
      if (
        !fistState.strong ||
        !previewReady ||
        fistState.progress < 1 ||
        camera.candidateCommitted ||
        reading.pending?.committed
      ) return;
      camera.candidateCommitted = true;
      camera.cooldownUntil = now + GESTURE_COOLDOWN_MS.fist;
      void confirmPending("gesture");
      return;
    }

    if (gesture !== camera.candidate) {
      camera.candidate = gesture;
      camera.candidateSince = now;
      camera.candidateCommitted = false;
    }

    if (gesture === "open" && reading.phase === "armed") reading.armedUntil = now + 5000;
    const aimGraceActive =
      reading.phase === "armed" &&
      reading.rayHitTarget !== null &&
      now <= reading.gestureAimGraceUntil;
    const gestureMotionHold =
      (["open", "pinch"].includes(gesture) || aimGraceActive) &&
      reading.rayHitTarget !== null &&
      ["idle", "armed"].includes(reading.phase);
    if (gestureMotionHold !== reading.gestureMotionHold) {
      reading.gestureMotionHold = gestureMotionHold;
      updateFanSelection();
      syncCarouselMotion();
    }
    const stableHit = reading.rayHitTarget !== null && now - reading.rayHitSince >= RAY_STABLE_MS;
    const eligible =
      (gesture === "open" && reading.phase === "idle") ||
      (gesture === "pinch" && reading.phase === "armed" && stableHit);
    const threshold = eligible ? GESTURE_HOLD_MS[gesture] || 0 : 0;
    const progress = threshold ? clamp((now - camera.candidateSince) / threshold, 0, 1) : 0;
    elements.gestureCursor.style.setProperty("--gesture-progress", `${progress * 360}deg`);
    elements.gestureCursor.dataset.gesture = gesture;

    if (gesture === "open") {
      elements.cursorLabel.textContent = reading.phase === "armed" ? "已允许" : `OPEN ${Math.round(progress * 100)}%`;
      setGestureReadout("识别到 OPEN", reading.phase === "armed" ? "牌库已允许抽取" : "保持张掌以允许抽取", confidence);
    } else if (gesture === "pinch") {
      elements.cursorLabel.textContent = stableHit ? `PINCH ${Math.round(progress * 100)}%` : "未命中";
      setGestureReadout("识别到 PINCH", stableHit ? "保持捏合，抓取随机牌" : "射线需要先命中牌背", confidence);
    } else if (aimGraceActive) {
      elements.cursorLabel.textContent = "目标锁定";
      setGestureReadout("正在保持目标", "继续完成捏合即可抓取", confidence);
    } else if (gesture === "fist") {
      elements.cursorLabel.textContent = "FIST";
      setGestureReadout(
        "检测到握拳轮廓",
        reading.phase === "preview" ? "请收紧食指及其余手指以开始确认" : "只有预览阶段可以确认",
        confidence,
      );
    } else {
      elements.cursorLabel.textContent = "追踪";
      setGestureReadout("手部已定位", "张掌允许 · 捏合抓取 · 握拳确认", confidence);
    }

    if (!eligible || progress < 1 || camera.candidateCommitted || now < camera.cooldownUntil) return;
    camera.candidateCommitted = true;
    camera.cooldownUntil = now + (GESTURE_COOLDOWN_MS[gesture] || 0);
    if (gesture === "open" && reading.phase === "idle") armDraw("gesture");
    else if (gesture === "pinch") void grabTarget(reading.rayHitTarget, "gesture");
  }

  function processNoHand(now) {
    clearHandCanvas();
    const missingFor = now - camera.lastHandAt;
    if (reading.phase === "preview") {
      // A fist can briefly hide its own landmarks. Pause confirmation instead of
      // forcing an OPEN release, and never credit time while no hand is visible.
      camera.fistLastFrameAt = now;
      camera.fistPreviousFrameStrong = false;
      if (missingFor > FIST_RESET_MS) resetFistEvidence();
      if (missingFor > 300) elements.gestureCursor.classList.remove("is-visible");
      if (missingFor > 1200) {
        setGestureReadout("正在寻找手掌", "待确认牌和历史不会丢失");
        elements.confidence.textContent = "—";
      }
      return;
    }
    const preserveLockedAim =
      reading.phase === "armed" &&
      reading.rayHitTarget !== null &&
      now <= reading.gestureAimGraceUntil;
    if (missingFor > 300 && !preserveLockedAim) {
      resetGestureTracking({ hideCursor: true, requireRelease: true });
    }
    if (missingFor > 650 && reading.phase === "armed" && Number.isFinite(reading.armedUntil)) {
      reading.phase = "idle";
      reading.armedUntil = 0;
      updateInterface();
    }
    if (missingFor > 1200) {
      setGestureReadout("正在寻找手掌", "待确认牌和历史不会丢失");
      elements.confidence.textContent = "—";
    }
  }

  function processHandResult(result, now) {
    const landmarks = result?.landmarks?.[0];
    if (!landmarks) {
      processNoHand(now);
      return;
    }
    camera.lastHandAt = now;
    drawHandLandmarks(landmarks);
    if (elements.helpDialog.open) {
      resetGestureTracking({ hideCursor: true, requireRelease: true });
      return;
    }
    const preserveLockedAim =
      reading.phase === "armed" &&
      reading.rayHitTarget !== null &&
      now <= reading.gestureAimGraceUntil;
    const preserveFistEvidence =
      reading.phase === "preview" &&
      camera.fistLastStrongAt > 0 &&
      now - camera.fistLastStrongAt <= FIST_RESET_MS;
    if (
      camera.lastFrameAt &&
      now - camera.lastFrameAt > GESTURE_FRAME_GAP_RESET_MS &&
      !preserveLockedAim &&
      !preserveFistEvidence
    ) {
      if (reading.phase === "preview") resetFistEvidence();
      else resetGestureTracking();
    } else if (
      camera.lastFrameAt &&
      now - camera.lastFrameAt > GESTURE_FRAME_GAP_RESET_MS &&
      preserveFistEvidence
    ) {
      camera.fistLastFrameAt = now;
      camera.fistPreviousFrameStrong = false;
    }
    elements.gestureCursor.classList.add("is-visible");
    const worldLandmarks = result.worldLandmarks?.[0];
    const gesture = classifyHandGesture(landmarks, worldLandmarks);

    const palm = [landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17]];
    const palmAnchor = {
      x: palm.reduce((sum, point) => sum + point.x, 0) / palm.length,
      y: palm.reduce((sum, point) => sum + point.y, 0) / palm.length,
    };
    // Keep both aim axes anchored to the palm so OPEN -> PINCH cannot jump away from its target.
    const rawX = 1 - palmAnchor.x;
    const rawY = palmAnchor.y;
    camera.smoothX += (rawX - camera.smoothX) * 0.3;
    camera.smoothY += (rawY - camera.smoothY) * GESTURE_AIM.smoothingY;
    const cursorX = 4 + clamp(camera.smoothX, 0, 1) * 92;
    const orbitRect = elements.orbit.getBoundingClientRect();
    const fanRect = elements.fan.getBoundingClientRect();
    const palmTravel = clamp(
      (camera.smoothY - GESTURE_AIM.inputYStart) / GESTURE_AIM.inputYSpan,
      0,
      1,
    );
    const clientY = fanRect.top + fanRect.height * (
      GESTURE_AIM.laneYStart + GESTURE_AIM.laneYSpan * palmTravel
    );
    const cursorY = clamp(((clientY - orbitRect.top) / Math.max(orbitRect.height, 1)) * 100, 0, 100);
    elements.gestureCursor.style.setProperty("--cursor-x", `${cursorX}%`);
    elements.gestureCursor.style.setProperty("--cursor-y", `${cursorY}%`);

    const confidenceCategory = (result.handedness || result.handednesses)?.[0]?.[0];
    const confidence = confidenceCategory?.score ?? 0.8;
    const insideSafeArea = rawX > 0.06 && rawX < 0.94 && rawY > 0.04 && rawY < 0.96;
    if (!insideSafeArea) {
      resetGestureTracking({ requireRelease: reading.phase !== "preview" });
      setGestureReadout("手掌靠近边缘", "移回取景框中央再操作", confidence);
      return;
    }

    if (camera.requiresRelease) {
      if (gesture.name === "neutral" || gesture.name === "open") {
        camera.requiresRelease = false;
        resetGestureCandidate();
      } else {
        resetGestureCandidate();
        setGestureReadout("请先松开手势", "放松手指或张开手掌后再继续", confidence);
        return;
      }
    }

    const clientX = orbitRect.left + (cursorX / 100) * orbitRect.width;
    window.dispatchEvent(new CustomEvent("arcana:gesturepointer", {
      detail: { clientX, clientY, normalizedX: camera.smoothX, normalizedY: camera.smoothY },
    }));
    const isAimGesture = gesture.name === "open" || gesture.name === "pinch";
    if (isAimGesture) {
      const result = updateRayTarget(clientX, clientY, now, {
        retainCurrent: reading.phase === "armed",
        preserveOnMiss: reading.phase === "armed",
      });
      if (result.observed) reading.gestureAimGraceUntil = now + GESTURE_AIM_GRACE_MS;
    } else if (
      reading.phase === "armed" &&
      reading.rayHitTarget !== null &&
      now <= reading.gestureAimGraceUntil
    ) {
      updateGestureRay(clientX, clientY, reading.rayHitTarget);
    } else {
      reading.rayHitTarget = null;
      reading.rayHitSince = 0;
      reading.gestureAimGraceUntil = 0;
      elements.gestureRay.classList.remove("is-visible");
      if (!reading.pending && !reading.pointerMotionHold) setSelectedTarget(null);
    }
    updateGestureCandidate(gesture, now, confidence);
  }

  function detectHandsLoop(now) {
    if (elements.body.dataset.cameraState !== "active" || !camera.tracker || !camera.stream) return;
    expireGestureArm(now);
    if (!document.hidden && elements.cameraVideo.readyState >= 2) {
      const isNewFrame = elements.cameraVideo.currentTime !== camera.lastVideoTime;
      const inferenceDue = now - camera.lastInferenceAt >= 1000 / 22;
      if (isNewFrame && inferenceDue) {
        camera.lastVideoTime = elements.cameraVideo.currentTime;
        camera.lastInferenceAt = now;
        try {
          processHandResult(camera.tracker.detectForVideo(elements.cameraVideo, now), now);
        } catch (error) {
          console.error("Hand tracking frame failed.", error);
          stopCamera({ errorDetail: "识别过程已停止，待确认牌与历史均已保留" });
          return;
        }
      }
    }
    camera.frameId = requestAnimationFrame(detectHandsLoop);
  }

  function setPointerMotionHold(hold) {
    if (reading.pointerMotionHold === hold) return;
    reading.pointerMotionHold = hold;
    if (!hold && !reading.pending && !reading.gestureMotionHold) {
      reading.selectedTarget = null;
    }
    updateFanSelection();
    syncCarouselMotion();
  }

  function carouselTrackOffset(track) {
    const transform = window.getComputedStyle(track).transform;
    if (!transform || transform === "none") return 0;
    try {
      return new DOMMatrixReadOnly(transform).m41;
    } catch {
      const values = transform.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
      return transform.startsWith("matrix3d") ? values[12] || 0 : values[4] || 0;
    }
  }

  function wrapCarouselOffset(offset, loopWidth) {
    if (!Number.isFinite(loopWidth) || loopWidth <= 0) return offset;
    const wrapped = ((offset % loopWidth) + loopWidth) % loopWidth;
    return wrapped === 0 ? 0 : wrapped - loopWidth;
  }

  function finishFanPointer(event, { cancelled = false } = {}) {
    const pointer = reading.pointer;
    if (!pointer || (event && pointer.id !== event.pointerId)) return;
    if (!cancelled && pointer.dragging) reading.suppressClickUntil = performance.now() + 320;
    elements.fan.classList.remove("is-dragging");
    reading.pointer = null;
    setPointerMotionHold(false);
    if (event && pointer.captureTarget?.hasPointerCapture?.(event.pointerId)) {
      pointer.captureTarget.releasePointerCapture(event.pointerId);
    }
  }

  elements.fanZone.addEventListener("pointerdown", (event) => {
    if (!["idle", "armed"].includes(reading.phase)) return;
    if (event.button !== undefined && event.button !== 0) return;
    const track = $("#card-track", elements.fan);
    const loop = $(".card-loop--primary", elements.fan);
    if (!track || !loop) return;
    const target = fanTargetFromPoint(event.clientX, event.clientY);
    if (target) {
      setSelectedTarget(target.dataset.targetKey);
    }
    setPointerMotionHold(true);
    const loopWidth = loop.getBoundingClientRect().width;
    const startTrackX = wrapCarouselOffset(carouselTrackOffset(track), loopWidth);
    track.style.setProperty("--stream-offset-x", `${startTrackX}px`);
    elements.fan.classList.add("is-dragging");
    const captureTarget = target || elements.fanZone;
    reading.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTrackX,
      loopWidth,
      dragging: false,
      captureTarget,
      track,
    };
    try {
      captureTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; normal click handling still works.
    }
  });

  elements.fanZone.addEventListener("pointermove", (event) => {
    if (!["idle", "armed"].includes(reading.phase)) return;
    if (event.pointerType === "mouse" && !reading.pointer) {
      return;
    }
    if (!reading.pointer || reading.pointer.id !== event.pointerId) return;
    const deltaX = event.clientX - reading.pointer.startX;
    const deltaY = event.clientY - reading.pointer.startY;
    if (
      !reading.pointer.dragging &&
      Math.abs(deltaX) >= 9 &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.08
    ) {
      reading.pointer.dragging = true;
      setSelectedTarget(null);
    }
    if (reading.pointer.dragging) {
      event.preventDefault();
      const nextOffset = wrapCarouselOffset(
        reading.pointer.startTrackX + deltaX,
        reading.pointer.loopWidth,
      );
      reading.pointer.track.style.setProperty("--stream-offset-x", `${nextOffset}px`);
      return;
    }
    const target = fanTargetFromPoint(event.clientX, event.clientY);
    if (target) {
      setSelectedTarget(target.dataset.targetKey);
    } else if (!reading.pending && !reading.gestureMotionHold) {
      setSelectedTarget(null);
    }
  });

  elements.fanZone.addEventListener("pointerup", (event) => {
    finishFanPointer(event);
  });

  elements.fanZone.addEventListener("pointercancel", (event) => {
    finishFanPointer(event, { cancelled: true });
  });

  elements.fanZone.addEventListener("lostpointercapture", (event) => {
    finishFanPointer(event, { cancelled: true });
  });

  elements.fanZone.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && !reading.pointer) setPointerMotionHold(false);
  });

  elements.fan.addEventListener("focus", () => {
    const target = fanTargetByKey(reading.selectedTarget) || nearestVisibleTarget();
    if (target) setSelectedTarget(target.dataset.targetKey, { allowOffscreen: true });
    updateFanSelection();
  });

  elements.fan.addEventListener("blur", () => {
    if (!reading.pending && !reading.pointerMotionHold && !reading.gestureMotionHold) reading.selectedTarget = null;
    updateFanSelection();
  });

  elements.fan.addEventListener("click", (event) => {
    const target = event.target.closest(".fan-card");
    if (!target || performance.now() < reading.suppressClickUntil || !isFanTargetVisible(target)) return;
    const key = target.dataset.targetKey;
    setSelectedTarget(key);
    void grabTarget(key, event.detail === 0 ? "keyboard" : "manual");
  });

  elements.stateActionButton.addEventListener("click", handleStateAction);
  elements.cancelHeldButton.addEventListener("click", cancelPending);
  elements.restartButton.addEventListener("click", resetReading);
  elements.resetButton.addEventListener("click", resetReading);
  elements.undoButton.addEventListener("click", undoLast);
  elements.cameraButton.addEventListener("click", toggleCamera);
  elements.soundButton?.addEventListener("click", async () => {
    if (!audio) return;
    if (audio.isMuted()) {
      audio.setMuted(false);
      await audio.start();
      announce("背景音乐与确认音效已开启。");
    } else {
      audio.setMuted(true);
      announce("背景音乐与确认音效已关闭。");
    }
    syncSoundButton();
  });

  window.addEventListener("storage", (event) => {
    syncSoundButton();
    if (event.key === READING_ARCHIVE_KEY || event.key === null) {
      reading.savedReadings = parseReadingArchive(event.newValue || "");
      renderPreviousReading();
    }
  });

  elements.imageSourceMode.value = reading.imageMode;
  elements.imageSourceMode.addEventListener("change", () => {
    if (["committing", "ashing"].includes(reading.phase)) {
      elements.imageSourceMode.value = reading.imageMode;
      return;
    }
    reading.imageMode = elements.imageSourceMode.value;
    safeStorageSet("arcana-image-source-v2", reading.imageMode);
    renderSpread();
    renderHeldCard();
    renderHistory();
    renderPreviousReading();
    announce(`卡牌图源已切换为${elements.imageSourceMode.selectedOptions[0].textContent}。`);
  });

  elements.helpButton.addEventListener("click", () => {
    if (typeof elements.helpDialog.showModal === "function") elements.helpDialog.showModal();
    else elements.helpDialog.setAttribute("open", "");
    resetGestureTracking({ hideCursor: true, requireRelease: true });
    if (elements.body.dataset.cameraState === "active") {
      setGestureReadout("手势已暂停", "关闭帮助后可继续识别");
    }
  });

  elements.helpDialog.addEventListener("click", (event) => {
    if (event.target === elements.helpDialog) elements.helpDialog.close();
  });

  elements.helpDialog.addEventListener("close", () => {
    resetGestureTracking({ hideCursor: true, requireRelease: true });
    camera.lastHandAt = performance.now();
    camera.cooldownUntil = performance.now() + 350;
    if (elements.body.dataset.cameraState === "active") {
      setGestureReadout("手势追踪已恢复", "OPEN 张掌允许抽取");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (elements.helpDialog.open) return;
    const tag = event.target.tagName;
    const isTyping = tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || event.target.isContentEditable;
    if (isTyping || event.repeat) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoLast();
      return;
    }
    if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      toggleCamera();
      return;
    }
    if (event.key.toLowerCase() === "o" && reading.phase === "idle") {
      event.preventDefault();
      armDraw("manual");
      return;
    }
    if (event.key === "Escape" && reading.pending) {
      event.preventDefault();
      cancelPending();
      return;
    }
    if (
      event.key === "Enter" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.target.closest?.("button, a[href], summary")
    ) {
      if (reading.phase === "idle") {
        event.preventDefault();
        armDraw("manual");
        return;
      }
      if (reading.phase === "armed") {
        event.preventDefault();
        void grabTarget(reading.selectedTarget, "keyboard");
        return;
      }
      if (reading.phase === "preview") {
        event.preventDefault();
        void confirmPending("keyboard");
        return;
      }
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && ["idle", "armed"].includes(reading.phase)) {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      selectAdjacentTarget(direction, { focus: true });
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && elements.body.dataset.cameraState === "active") {
      resetGestureTracking({ hideCursor: true, requireRelease: true });
      if (reading.phase === "armed" && Number.isFinite(reading.armedUntil)) {
        reading.phase = "idle";
        reading.armedUntil = 0;
        updateInterface();
      }
      setGestureReadout("页面已暂停", "返回页面后请重新张掌允许抽取");
    } else if (!document.hidden && elements.body.dataset.cameraState === "active") {
      resetGestureTracking({ hideCursor: true, requireRelease: true });
      camera.lastHandAt = performance.now();
      camera.cooldownUntil = performance.now() + 350;
      setGestureReadout("手势追踪已恢复", "OPEN 张掌允许抽取");
    }
  });

  window.addEventListener("pagehide", (event) => {
    stopCamera({ announceChange: false });
    if (!event.persisted) {
      if (fanSuction.frameId) window.cancelAnimationFrame(fanSuction.frameId);
      fanSuction.frameId = 0;
      camera.tracker?.close?.();
      camera.tracker = null;
      camera.trackerPromise = null;
      ashParticles.destroy();
      audio?.destroy();
    }
  });

  elements.localDate.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  syncSoundButton();
  renderAll();
  fanSuction.frameId = window.requestAnimationFrame(updateFanSuction);
  document.body.dataset.appReady = "true";
})();
