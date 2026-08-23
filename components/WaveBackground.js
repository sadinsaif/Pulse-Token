"use client";

import { useEffect, useRef } from "react";

/**
 * WaveBackground — decorative animated backdrop: many thin emerald contour
 * lines slowly flowing/deforming over a deep green-black base (the liveframe.ai
 * "flowing topographic" look).
 *
 * PURELY VISUAL. It is a single <canvas>, fixed to the full viewport, painted
 * BEHIND every UI element (z-index:-1), with pointer-events:none so it never
 * intercepts clicks or scrolling. It changes no content, layout, or logic.
 *
 * The site is permanently dark (liveframe.ai style), so the animation always
 * runs. It still:
 * - Respects prefers-reduced-motion (draws one static frame, no animation).
 * - Pauses while the tab is hidden. Caps devicePixelRatio at 2 for perf.
 */
export default function WaveBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let running = false;
    let t = 0;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Cheap smooth "noise" from summed sines — no library. Neighbouring columns
    // share most of the argument, so the field bends coherently (topographic),
    // never a straight grid; the per-line phase keeps them from being identical.
    function flow(x, y, time) {
      return (
        Math.sin(x * 0.0016 + y * 0.006 + time) * 26 +
        Math.sin(x * 0.0009 - y * 0.011 + time * 0.7) * 20 +
        Math.sin(y * 0.02 + time * 1.25) * 8
      );
    }

    function draw() {
      // Deep green-black base, blending to the app's --bg (#0a0b0d) at the foot.
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, "#07110b");
      g.addColorStop(1, "#0a0b0d");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      const spacing = 26; // px between vertical lines
      const cols = Math.ceil(width / spacing) + 2;
      const step = 14; // vertical sampling resolution
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (let c = 0; c < cols; c++) {
        const baseX = c * spacing;
        const phase = c * 0.35;

        // Two passes: a wide, very faint stroke for the glow, then a crisp thin
        // line on top — a cheap glow without expensive shadowBlur.
        for (let pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          for (let y = -step; y <= height + step; y += step) {
            const x = baseX + flow(baseX, y, t + phase);
            if (y <= -step) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          if (pass === 0) {
            ctx.strokeStyle = "rgba(46, 204, 148, 0.05)";
            ctx.lineWidth = 2.6;
          } else {
            ctx.strokeStyle = "rgba(74, 222, 150, 0.16)";
            ctx.lineWidth = 1;
          }
          ctx.stroke();
        }
      }
    }

    function loop() {
      t += 0.004; // slow, elegant drift
      draw();
      rafId = requestAnimationFrame(loop);
    }

    function start() {
      if (running) return;
      running = true;
      if (reduce.matches) {
        draw(); // single static frame, no loop
        return;
      }
      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    resize();
    start();

    function onResize() {
      resize();
      // If we're not in an animation loop (reduced motion), repaint the static
      // frame so it fits the new size.
      if (!running || reduce.matches) draw();
    }
    window.addEventListener("resize", onResize);

    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }
    document.addEventListener("visibilitychange", onVisibility);

    const onReduceChange = () => {
      stop();
      start();
    };
    reduce.addEventListener?.("change", onReduceChange);

    return () => {
      stop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      reduce.removeEventListener?.("change", onReduceChange);
    };
  }, []);

  return <canvas ref={canvasRef} id="wave-bg" aria-hidden="true" />;
}
