"use client";

export default function PeopleHero({ firstName, heroImage, onHelpClick }) {
  const bgStyle = heroImage
    ? { backgroundImage: `url('${heroImage}')`, backgroundSize: "cover", backgroundPosition: "center" }
    : {};

  return (
    <header className="pp-hero" style={bgStyle}>
      <div className="pp-hero-overlay" />
      <div className="pp-hero-content">
        <h1 className="pp-hero-title">People Portal</h1>
        <p className="pp-hero-subtitle">Welcome back, {firstName}.</p>
      </div>
      <button className="pp-hero-help-btn" onClick={onHelpClick}>?</button>
    </header>
  );
}