/*
 * Board motion. Five small effects, each taken apart from an Awwwards Site of the Day
 * and rewritten for the board, with no dependencies:
 *   decode  - a label settles character by character when its text changes (Signal-A Studio).
 *   hold    - press and hold to confirm; progress is the --hold custom property (Santioni Spirits).
 *   follow  - the board scrolls sideways to the stage that is running (EDOLUS, the other way round:
 *             there, scrolling drives the flow; here, the flow drives the scroll).
 *   portal  - a layer opens as a circle from what was clicked and closes back into it (Overworld Audio).
 *   deck    - versions as discs: drag, flick, then a spring to the nearest one (A24 tribute).
 * prefers-reduced-motion is read each time an effect runs, so changing the setting applies at once.
 */
"use strict";

const FX = (() => {
  const motion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => Boolean(motion && motion.matches);

  const CJK = "流程阶段版本运行产物输入脚本分镜素材剪辑导出模型检查回退对比完成等待修改上游配置";
  const LOWER = "abcdefghijklmnopqrstuvwxyz";
  const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const DIGITS = "0123456789";
  const pick = (s) => s[(Math.random() * s.length) | 0];
  /** Pointer capture can throw when the pointer is already gone; losing it only loses the capture. */
  const capture = (el, id) => {
    try {
      el.setPointerCapture?.(id);
    } catch {
      // nothing to capture
    }
  };
  /** A random glyph of the same kind, so the label keeps its width while it settles. */
  function glyph(ch) {
    if (/[㐀-鿿]/.test(ch)) return pick(CJK);
    if (/[A-Z]/.test(ch)) return pick(UPPER);
    if (/[a-z]/.test(ch)) return pick(LOWER);
    if (/[0-9]/.test(ch)) return pick(DIGITS);
    return ch;
  }

  /*
   * 01 decode. The element holds two spans: a screen-reader copy that changes once, and an
   * aria-hidden face that cycles through random glyphs until each character's own settle time.
   * The board re-renders cards often, so a running decode is keyed (e.g. by stage id) and
   * carries on in the new element instead of starting again.
   */
  const jobs = new Map();

  function faceOf(el, text) {
    let sr = el.firstElementChild;
    let face = sr ? sr.nextElementSibling : null;
    if (!sr || !face || !sr.classList.contains("fx-sr") || !face.classList.contains("fx-face")) {
      sr = document.createElement("span");
      sr.className = "fx-sr";
      face = document.createElement("span");
      face.className = "fx-face";
      face.setAttribute("aria-hidden", "true");
      el.replaceChildren(sr, face);
    }
    if (sr.textContent !== text) sr.textContent = text;
    return face;
  }

  function decode(el, text, { key, animate = true, fast = false } = {}) {
    const target = String(text ?? "");
    const id = key ?? el;
    const face = faceOf(el, target);
    const live = jobs.get(id);
    if (live && live.target === target) {
      live.face = face;
      face.textContent = live.shown.join("");
      return;
    }
    if (live) {
      cancelAnimationFrame(live.raf);
      jobs.delete(id);
    }
    if (!animate || reduced()) {
      face.textContent = target;
      return;
    }
    const chars = Array.from(target);
    const settle = chars.map((_, i) => (fast ? 40 + i * 9 + Math.random() * 80 : 120 + i * 22 + Math.random() * 200));
    const job = {
      face,
      target,
      chars,
      settle,
      end: Math.max(0, ...settle),
      start: performance.now(),
      shown: chars.map(glyph),
      swapped: 0,
      raf: 0,
    };
    jobs.set(id, job);
    const tick = (now) => {
      if (jobs.get(id) !== job) return;
      const t = now - job.start;
      const swap = now - job.swapped > 45;
      if (swap) job.swapped = now;
      job.shown = job.chars.map((c, i) => (t >= job.settle[i] ? c : swap ? glyph(c) : job.shown[i]));
      if (t < job.end) {
        job.face.textContent = job.shown.join("");
        job.raf = requestAnimationFrame(tick);
      } else {
        job.face.textContent = job.target;
        jobs.delete(id);
      }
    };
    face.textContent = job.shown.join("");
    job.raf = requestAnimationFrame(tick);
  }

  /*
   * 02 hold. While pressed, a frame loop raises --hold from 0 to 1 over `ms`; released early,
   * it rewinds about twice as fast. onCancel gets the progress and how long it was held, so a
   * quick tap can still act like a click. Enter and Space hold too.
   */
  function hold(btn, { ms = 1000, onStart, onCancel, onDone } = {}) {
    let p = 0;
    let holding = false;
    let done = false;
    let raf = 0;
    let last = 0;
    let began = 0;
    const set = (v) => {
      p = Math.min(1, Math.max(0, v));
      btn.style.setProperty("--hold", p.toFixed(3));
    };
    const loop = (now) => {
      const dt = now - last;
      last = now;
      set(holding ? p + dt / ms : p - dt / (ms * 0.45));
      if (holding && p >= 1) {
        holding = false;
        done = true;
        btn.dataset.hold = "done";
        onDone?.();
        return;
      }
      if (holding || p > 0) raf = requestAnimationFrame(loop);
      else btn.dataset.hold = "";
    };
    const begin = () => {
      if (btn.disabled || done || holding) return;
      holding = true;
      began = performance.now();
      btn.dataset.hold = "holding";
      onStart?.();
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const release = () => {
      if (!holding) return;
      holding = false;
      btn.dataset.hold = "release";
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
      onCancel?.(p, performance.now() - began);
    };
    btn.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      capture(btn, event.pointerId);
      begin();
    });
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("lostpointercapture", release);
    btn.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (!event.repeat) begin();
    });
    btn.addEventListener("keyup", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      release();
    });
    btn.addEventListener("blur", release);
    btn.addEventListener("contextmenu", (event) => {
      if (holding) event.preventDefault();
    });
    return {
      holding: () => holding,
      reset() {
        holding = false;
        done = false;
        cancelAnimationFrame(raf);
        set(0);
        btn.dataset.hold = "";
      },
    };
  }

  /*
   * 03 follow. When the target is not fully in view, scrolls a horizontal scroller to bring it
   * to the start edge (where `scroll-snap-align: start` settles too, so snapping does not pull
   * it back), smoothly unless motion is reduced. `right` is the viewport x where something
   * (the side panel) covers the scroller; `margin` leaves room before the target.
   */
  function follow(scroller, target, { right, margin = 0 } = {}) {
    if (!scroller || !target || !scroller.isConnected || !target.isConnected) return;
    const box = scroller.getBoundingClientRect();
    const item = target.getBoundingClientRect();
    const edge = Math.min(box.right, right ?? box.right);
    if (item.left >= box.left && item.right <= edge) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    const next = Math.min(max, Math.max(0, scroller.scrollLeft + item.left - box.left - margin));
    scroller.scrollTo({ left: next, behavior: reduced() ? "auto" : "smooth" });
  }

  /*
   * 04 portal. open(point) shows a hidden layer as a circle growing from a viewport point;
   * close() shrinks it back into the same point, then hides it. The circle starts where its
   * edge first touches the layer, so a click far from the layer still shows movement at once.
   */
  function portal(layer) {
    let origin = null;
    let anim = null;
    let closing = false;
    const ease = "cubic-bezier(.7,0,.2,1)";
    const circle = (point) => {
      const r = layer.getBoundingClientRect();
      const x = point.x - r.left;
      const y = point.y - r.top;
      const far = Math.max(Math.hypot(x, y), Math.hypot(r.width - x, y), Math.hypot(x, r.height - y), Math.hypot(r.width - x, r.height - y));
      const near = Math.hypot(x - Math.min(Math.max(x, 0), r.width), y - Math.min(Math.max(y, 0), r.height));
      const at = `at ${x.toFixed(1)}px ${y.toFixed(1)}px`;
      return { from: `circle(${near.toFixed(1)}px ${at})`, to: `circle(${Math.ceil(far + 2)}px ${at})` };
    };
    const stop = () => {
      if (anim) anim.cancel();
      anim = null;
      closing = false;
      layer.inert = false;
    };
    return {
      closing: () => closing,
      open(point) {
        const wasHidden = layer.hidden || closing;
        stop();
        layer.hidden = false;
        if (!wasHidden) return;
        origin = point || null;
        if (!origin || reduced() || typeof layer.animate !== "function") return;
        const c = circle(origin);
        anim = layer.animate([{ clipPath: c.from }, { clipPath: c.to }], { duration: 560, easing: ease });
        anim.onfinish = () => {
          anim = null;
        };
      },
      close(after) {
        stop();
        if (layer.hidden) {
          after?.();
          return;
        }
        if (!origin || reduced() || typeof layer.animate !== "function") {
          layer.hidden = true;
          after?.();
          return;
        }
        const c = circle(origin);
        closing = true;
        layer.inert = true;
        const run = layer.animate([{ clipPath: c.to }, { clipPath: c.from }], { duration: 420, easing: ease, fill: "forwards" });
        anim = run;
        run.onfinish = () => {
          if (anim !== run) return;
          layer.hidden = true;
          stop();
          after?.();
        };
      },
    };
  }

  /*
   * 05 deck. Dragging sets a position; letting go keeps the speed (x0.92 a frame), then a spring
   * (0.18 a frame) pulls to the nearest item. Past the ends the drag gives way at 0.35.
   * Arrow keys, Home and End step; a sideways wheel scrolls. place(pos) draws the items.
   */
  function deck(root, count, { start = count - 1, unit = () => 120, place, onSettle } = {}) {
    let pos = Math.min(count - 1, Math.max(0, start));
    let vel = 0;
    let target = null;
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastT = 0;
    let raf = 0;
    let settled = -1;
    const clampSoft = (v) => (v < 0 ? v * 0.35 : v > count - 1 ? count - 1 + (v - count + 1) * 0.35 : v);
    const nearest = () => Math.round(Math.min(count - 1, Math.max(0, pos)));
    const draw = () => {
      place(pos);
      const idx = nearest();
      if (idx !== settled && Math.abs(pos - idx) < 0.08) {
        settled = idx;
        onSettle?.(idx);
      }
    };
    const step = () => {
      raf = 0;
      if (dragging) return;
      if (target !== null) {
        pos += (target - pos) * (reduced() ? 1 : 0.18);
        if (Math.abs(target - pos) < 0.002) {
          pos = target;
          target = null;
        }
      } else {
        pos += vel;
        vel *= 0.92;
        if (pos < 0 || pos > count - 1 || Math.abs(vel) < 0.01) {
          vel = 0;
          target = nearest();
        }
      }
      draw();
      if (target !== null || vel !== 0) raf = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };
    const go = (i) => {
      target = Math.min(count - 1, Math.max(0, i));
      vel = 0;
      kick();
    };
    root.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = 0;
      vel = 0;
      target = null;
      lastX = event.clientX;
      lastT = performance.now();
      root.classList.add("dragging");
    });
    root.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const now = performance.now();
      const dx = event.clientX - lastX;
      moved += Math.abs(dx);
      if (moved > 6 && !root.hasPointerCapture?.(event.pointerId)) capture(root, event.pointerId);
      const d = -dx / unit();
      pos = clampSoft(pos + d);
      vel = reduced() ? 0 : (d / Math.max(1, now - lastT)) * 16;
      lastX = event.clientX;
      lastT = now;
      draw();
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("dragging");
      if (performance.now() - lastT > 80) vel = 0;
      kick();
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
    // Before a real drag there is no pointer capture, so leaving the deck has to end the press.
    root.addEventListener("pointerleave", (event) => {
      if (!root.hasPointerCapture?.(event.pointerId)) end();
    });
    root.addEventListener("keydown", (event) => {
      const base = target ?? Math.round(pos);
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") go(base - 1);
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") go(base + 1);
      else if (event.key === "Home") go(0);
      else if (event.key === "End") go(count - 1);
      else return;
      event.preventDefault();
    });
    let wheelTimer = 0;
    root.addEventListener(
      "wheel",
      (event) => {
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        event.preventDefault();
        vel = 0;
        target = null;
        pos = clampSoft(pos + event.deltaX / 400);
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => go(nearest()), 120);
        draw();
      },
      { passive: false },
    );
    draw();
    return { go, wasDrag: () => moved > 6, front: () => settled, refresh: draw };
  }

  return { reduced, decode, hold, follow, portal, deck };
})();
