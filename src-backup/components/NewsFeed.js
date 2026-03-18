"use client";
import { useState, useEffect } from "react";

// Apps Script exact color mapping
const CATEGORY_COLORS = {
  SAFETY: "red",
  CULINARY: "green",
  PEOPLE: "purple",
  HOSPITALITY: "orange",
  OPS: "blue",
  OPERATIONS: "blue",
  NEWS: "blue",
};

function getChipColor(category) {
  const key = String(category).toUpperCase().trim();
  return CATEGORY_COLORS[key] || "blue";
}

function resolveImageUrl(imageId) {
  if (!imageId || imageId.length < 5) return null;
  if (imageId.startsWith("http")) return imageId;
  // Google Drive file ID → direct image URL
  return `https://lh3.googleusercontent.com/d/${imageId}=s400`;
}

export default function NewsFeed({ news }) {
  const [readItems, setReadItems] = useState({});
  const [expandedItem, setExpandedItem] = useState(null);
  const items = news || [];

  // Load read state from localStorage
  useEffect(() => {
    try {
      const reads = {};
      items.forEach((item) => {
        const key = "kf_news_read_" + item.headline.replace(/\s/g, "");
        if (localStorage.getItem(key)) reads[item.headline] = true;
      });
      setReadItems(reads);
    } catch (e) {}
  }, [items]);

  function handleCardClick(item, index) {
    // Mark as read
    try {
      const key = "kf_news_read_" + item.headline.replace(/\s/g, "");
      localStorage.setItem(key, "true");
      setReadItems((prev) => ({ ...prev, [item.headline]: true }));
    } catch (e) {}

    // Toggle expanded view
    setExpandedItem((prev) => (prev === index ? null : index));
  }

  if (items.length === 0) {
    return (
      <div className="kf-widget-card">
        <div className="kf-card-header">
          <div className="kf-card-title"><span>KitchFix News Feed</span></div>
        </div>
        <div className="kf-news-placeholder">
          <span>No updates today.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="kf-widget-card">
      <div className="kf-card-header">
        <div className="kf-card-title"><span>KitchFix News Feed</span></div>
      </div>
      <div className="kf-news-feed">
        {items.map((item, i) => {
          const imageUrl = resolveImageUrl(item.imageId);
          const chipColor = getChipColor(item.category);
          const isRead = readItems[item.headline];
          const isExpanded = expandedItem === i;
          const isHero = i === 0 && item.pinned;
          const bodyPreview = item.body?.length > 100
            ? item.body.substring(0, 100) + "..."
            : item.body || "";

          return (
            <div
              key={i}
              className={`kf-news-card${imageUrl ? " kf-news-split" : ""}${isHero ? " kf-news-hero" : ""}${isRead ? " kf-news-read" : ""}`}
              onClick={() => handleCardClick(item, i)}
              style={{ cursor: "pointer" }}
            >
              {imageUrl && (
                <div
                  className="kf-news-img"
                  style={{ backgroundImage: `url('${imageUrl}')` }}
                />
              )}
              <div className="kf-news-content">
                <div className="kf-news-meta-row">
                  <span className={`kf-glass-chip ${chipColor}`}>
                    {item.category}
                  </span>
                  <span className="kf-news-date">
                    {item.date ? new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Recent"}
                  </span>
                </div>
                <h3 className="kf-news-headline">{item.headline}</h3>
                <div className="kf-news-preview">
                  {isExpanded ? item.body : bodyPreview}
                </div>
                <div className="kf-news-footer">
                  <div className="kf-author-group">
                    <span className="kf-author-chip">KF</span>
                    <span className="kf-author-name">KitchFix</span>
                  </div>
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="kf-glass-btn"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open Link →
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}