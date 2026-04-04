"use client";
import { useState } from "react";

/**
 * QuickTour.js — 3-card walkthrough: Pick location → Count items → Submit
 * Props: onComplete — () => void
 */

const CARDS = [
  {
    icon: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
    title: "Pick a location, start counting.",
    desc: "Tap any storage area — Walk-in Cooler, Freezer, Dry Storage. Count what's there.",
  },
  {
    icon: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M12 5v14" /><circle cx="12" cy="12" r="10" />
      </svg>
    ),
    title: "Tap the number or use +/- buttons.",
    desc: "If you had 5 last time, we'll show that. One tap to accept. Hit \"None\" if it's out of stock.",
  },
  {
    icon: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" /><circle cx="12" cy="12" r="10" stroke="#16A34A" strokeWidth="1.5" />
      </svg>
    ),
    title: "When you're done, hit Submit.",
    desc: "AP gets notified automatically. Your totals are on file. That's it.",
  },
];

export default function QuickTour({ onComplete }) {
  const [step, setStep] = useState(0);

  const isLast = step === CARDS.length - 1;
  const card = CARDS[step];

  return (
    <div className="oh-inv-mgmt-tour">
      <div className="oh-inv-mgmt-tour-card">
        <div className="oh-inv-mgmt-tour-icon">{card.icon}</div>
        <h3 className="oh-inv-mgmt-tour-title">{card.title}</h3>
        <p className="oh-inv-mgmt-tour-desc">{card.desc}</p>
      </div>

      {/* Dots */}
      <div className="oh-inv-mgmt-tour-dots">
        {CARDS.map((_, i) => (
          <span key={i} className={`oh-inv-mgmt-tour-dot${i === step ? " active" : ""}`} />
        ))}
      </div>

      {/* Actions */}
      <div className="oh-inv-mgmt-tour-actions">
        {step > 0 && (
          <button className="oh-inv-mgmt-tour-back" onClick={() => setStep(step - 1)}>Back</button>
        )}
        <button
          className="oh-inv-mgmt-tour-next"
          onClick={() => isLast ? onComplete() : setStep(step + 1)}
        >
          {isLast ? "Got It" : "Next"}
        </button>
      </div>
    </div>
  );
}