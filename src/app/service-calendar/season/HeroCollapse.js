"use client";

// HeroCollapse - the compressed welcome hero (Design Batch 2, audit
// P2-6 + Kevin's Q2 decision). Animates from ~160px tall to ~80px
// when the user scrolls past the threshold. Reclaims above-fold
// real estate (rubric Part 2: images earn their place).
//
// Implementation: rAF-throttled scroll listener toggles a CSS class.
// CSS handles the height + transform transition (~200ms ease).
// prefers-reduced-motion: no animation - render the compact state
// directly when the user has scrolled past, expanded when at top.
//
// No-layout-shift: the hero reserves its expanded slot via padding-top
// on the wrapper; when the inner content shrinks, the wrapper does
// not - so the grid below never reflows during the animation.

import { useEffect, useRef, useState } from "react";
import "./heroCollapse.css";

const COLLAPSE_THRESHOLD = 80;

export default function HeroCollapse({
  firstName,
  heroImage,                  // optional URL from sc-hero
}) {
  const [collapsed, setCollapsed] = useState(false);
  const tickingRef = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY || window.pageYOffset || 0;
        setCollapsed((prev) => {
          const next = y > COLLAPSE_THRESHOLD;
          return next === prev ? prev : next;
        });
        tickingRef.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // Initial read so a hard refresh at scroll>threshold lands collapsed.
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const cls = [
    "sc-hero-collapse",
    collapsed && "sc-hero-collapse--collapsed",
  ].filter(Boolean).join(" ");

  return (
    <div className={cls}>
      <div
        className="sc-hero-collapse-image"
        style={heroImage ? { backgroundImage: `url(${heroImage})` } : undefined}
        aria-hidden="true"
      >
        <div className="sc-hero-collapse-scrim" />
      </div>
      <div className="sc-hero-collapse-content">
        <h1 className="sc-hero-collapse-title">Service Calendar</h1>
        <p className="sc-hero-collapse-subtitle">
          Welcome back, {firstName}.
        </p>
      </div>
    </div>
  );
}
