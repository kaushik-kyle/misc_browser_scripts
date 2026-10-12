// ==UserScript==
// @name         Instagram Seek Bar (Reels + Feed)
// @namespace    ig-seekbar
// @version      1.1.0
// @description  Thin red progress line on the bottom edge of Instagram reels and feed videos. Click or drag it to seek.
// @match        https://www.instagram.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  if (window.__igSeekbarLoaded) return;
  window.__igSeekbarLoaded = true;

  /* ---------------- config ---------------- */
  const LINE_HEIGHT = 2;            // px, the visible progress line
  const ACTIVE_HEIGHT = 4;          // px, line height while hovering or dragging (set to 2 to keep it fixed)
  const HIT_HEIGHT = 12;            // px, invisible grab area along the bottom edge
  const MIN_VISIBLE = 120;          // px, skip thumbnails and tiny previews
  const OCCLUSION_CHECK_EVERY = 6;  // frames between "is something covering this video?" checks
  const CLIP_REFRESH_EVERY = 60;    // frames between re-reading overflow-clipping ancestors

  const HOST_ATTR = "data-ig-seekbar";
  const instances = new Map();
  let loopRunning = false;
  let scanQueued = false;
  let frame = 0;

  /* Nudge Instagram's own volume slider up so it doesn't sit on the grab area. */
  const volumeStyle = document.createElement("style");
  volumeStyle.setAttribute(HOST_ATTR, "style");
  volumeStyle.textContent = `
    input[type="range"][aria-label*="volume" i],
    [role="slider"][aria-label*="volume" i] {
      translate: 0 -${HIT_HEIGHT}px !important;
    }
  `;
  (document.head || document.documentElement).appendChild(volumeStyle);

  /* ---------------- helpers ---------------- */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const t = Math.floor(seconds);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = String(t % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }

  // End of the buffered range that contains the playhead.
  function bufferedEnd(video) {
    try {
      const b = video.buffered;
      const t = video.currentTime;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
      }
      return t;
    } catch {
      return 0;
    }
  }

  // Ancestors that clip the video, so the line sits on the part you can see
  // (e.g. cropped reels in the home feed).
  function findClipAncestors(video) {
    const list = [];
    let el = video.parentElement;
    for (let depth = 0; el && el !== document.body && depth < 20; depth++, el = el.parentElement) {
      const cs = getComputedStyle(el);
      const x = cs.overflowX !== "visible";
      const y = cs.overflowY !== "visible";
      if (x || y) list.push({ el, x, y });
    }
    return list;
  }

  function visibleRect(video, clips) {
    const r = video.getBoundingClientRect();
    let left = Math.max(r.left, 0);
    let top = Math.max(r.top, 0);
    let right = Math.min(r.right, window.innerWidth);
    let bottom = Math.min(r.bottom, window.innerHeight);
    for (const { el, x, y } of clips) {
      const c = el.getBoundingClientRect();
      if (x) { left = Math.max(left, c.left); right = Math.min(right, c.right); }
      if (y) { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  // Is something unrelated to this video (post dialog, comments sheet, nav) drawn
  // over the spot where the line would go?
  function isCovered(video, x, y) {
    let hit = null;
    for (const el of document.elementsFromPoint(x, y)) {
      if (!el.hasAttribute(HOST_ATTR)) { hit = el; break; }
    }
    if (!hit || hit === video || hit.contains(video)) return false;

    // Instagram's own overlays on the video share a wrapper about the size of the
    // video. A modal or nav only meets the video near the page root.
    let shared = hit.parentElement;
    while (shared && !shared.contains(video)) shared = shared.parentElement;
    if (!shared) return true;
    const a = shared.getBoundingClientRect();
    const v = video.getBoundingClientRect();
    return a.width > v.width * 1.6 + 40 || a.height > v.height * 1.6 + 40;
  }

  /* ---------------- seek line per video ---------------- */
  function createSeekBar(video) {
    const host = document.createElement("div");
    host.setAttribute(HOST_ATTR, "bar");
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "z-index: 2147483647",
      "box-sizing: border-box",
      "display: none",
      "left: 0",
      "top: 0",
      "width: 0",
      `height: ${HIT_HEIGHT}px`,
      "cursor: pointer",
      "touch-action: none",
      "user-select: none",
      "-webkit-user-select: none"
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .wrap { position: absolute; inset: 0; }
        .track {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: ${LINE_HEIGHT}px;
          background: rgba(255, 255, 255, .28);
          overflow: hidden;
          transition: height 100ms ease;
        }
        :host(:hover) .track,
        .wrap.dragging .track { height: ${ACTIVE_HEIGHT}px; }
        .buf, .fill {
          position: absolute;
          inset: 0;
          transform-origin: left center;
          transform: scaleX(0);
        }
        .buf { background: rgba(255, 255, 255, .45); }
        .fill { background: #ff3040; }
        .tip {
          position: absolute;
          bottom: ${HIT_HEIGHT + 8}px;
          left: 0;
          display: none;
          padding: 5px 8px;
          border-radius: 6px;
          background: rgba(0, 0, 0, .82);
          color: #fff;
          font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, .4);
        }
        .tip .dur { opacity: .65; font-weight: 500; }
        .wrap.dragging .tip { display: block; }
      </style>
      <div class="wrap">
        <div class="track"><div class="buf"></div><div class="fill"></div></div>
        <div class="tip"><span class="cur">0:00</span><span class="dur"> / 0:00</span></div>
      </div>
    `;

    const wrap = shadow.querySelector(".wrap");
    const fill = shadow.querySelector(".fill");
    const buf = shadow.querySelector(".buf");
    const tip = shadow.querySelector(".tip");
    const tipCur = shadow.querySelector(".cur");
    const tipDur = shadow.querySelector(".dur");

    let dragging = false;
    let dragFrac = 0;
    let shown = false;
    let covered = false;
    let clips = null;
    let lastBox = "";
    let lastFill = "";
    let lastBuf = "";

    const duration = () => {
      const d = video.duration;
      return Number.isFinite(d) && d > 0 ? d : 0;
    };

    function render() {
      const d = duration();
      const frac = dragging
        ? dragFrac
        : (d ? clamp(video.currentTime / d, 0, 1) : 0);
      const b = d ? clamp(bufferedEnd(video) / d, 0, 1) : 0;

      const f = `scaleX(${frac.toFixed(4)})`;
      if (f !== lastFill) { fill.style.transform = f; lastFill = f; }
      const bb = `scaleX(${b.toFixed(4)})`;
      if (bb !== lastBuf) { buf.style.transform = bb; lastBuf = bb; }
    }

    function setShown(v) {
      if (v === shown) return;
      shown = v;
      host.style.display = v ? "block" : "none";
    }

    function update() {
      if (!video.isConnected) { destroy(); return; }
      if (!clips || frame % CLIP_REFRESH_EVERY === 0) clips = findClipAncestors(video);

      const vis = visibleRect(video, clips);
      let show = vis.width >= MIN_VISIBLE && vis.height >= MIN_VISIBLE;

      if (show && !dragging && (!shown || frame % OCCLUSION_CHECK_EVERY === 0)) {
        covered = isCovered(video, vis.left + vis.width / 2, vis.bottom - HIT_HEIGHT / 2);
      }
      show = show && (dragging || !covered);
      setShown(show);
      if (!show) return;

      // Bottom of the grab area sits on the bottom edge of the visible video.
      const left = Math.round(vis.left);
      const top = Math.round(vis.bottom - HIT_HEIGHT);
      const width = Math.round(vis.width);
      const box = `${left},${top},${width}`;
      if (box !== lastBox) {
        lastBox = box;
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
        host.style.width = `${width}px`;
      }
      host.style.cursor = duration() ? "pointer" : "default";
      render();
    }

    function destroy() {
      host.remove();
      instances.delete(video);
    }

    /* ---- drag to seek, with a time popup over the pointer ---- */
    function moveTo(e) {
      const d = duration();
      if (!d) return;
      const r = host.getBoundingClientRect();
      const x = clamp(e.clientX - r.left, 0, r.width);
      dragFrac = r.width ? x / r.width : 0;
      try { video.currentTime = dragFrac * d; } catch { /* ignore */ }

      tipCur.textContent = formatTime(dragFrac * d);
      tipDur.textContent = ` / ${formatTime(d)}`;
      // Keep the popup centred on the pointer but inside the video's width.
      const half = tip.offsetWidth / 2;
      const tipX = r.width > half * 2 ? clamp(x, half, r.width - half) : r.width / 2;
      tip.style.left = `${tipX - half}px`;
      render();
    }

    function endDrag(e) {
      if (!dragging) return;
      if (e && e.type === "pointerup") moveTo(e);
      dragging = false;
      wrap.classList.remove("dragging");
    }

    host.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!duration()) return;
      e.preventDefault();
      dragging = true;
      wrap.classList.add("dragging");
      try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      moveTo(e);
    });
    host.addEventListener("pointermove", (e) => { if (dragging) moveTo(e); });
    host.addEventListener("pointerup", endDrag);
    host.addEventListener("pointercancel", endDrag);
    host.addEventListener("lostpointercapture", endDrag);

    // Keep clicks on the line away from Instagram's handlers
    // (tap-to-pause, hold-to-pause, double-tap like, navigation).
    for (const type of [
      "pointerdown", "pointerup", "pointermove",
      "mousedown", "mouseup", "click", "dblclick", "contextmenu",
      "touchstart", "touchmove", "touchend"
    ]) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }

    document.body.appendChild(host);
    return { update, destroy };
  }

  /* ---------------- shared animation loop ---------------- */
  function tick() {
    frame++;
    for (const inst of instances.values()) inst.update();
    if (instances.size) {
      requestAnimationFrame(tick);
    } else {
      loopRunning = false;
    }
  }

  function ensureLoop() {
    if (loopRunning || !instances.size) return;
    loopRunning = true;
    requestAnimationFrame(tick);
  }

  /* ---------------- discover videos ---------------- */
  function scan() {
    scanQueued = false;
    for (const video of document.getElementsByTagName("video")) {
      if (!instances.has(video)) instances.set(video, createSeekBar(video));
    }
    ensureLoop();
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  }

  new MutationObserver(queueScan).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  queueScan();
})();