"use client";
import { useState, useEffect } from "react";

export default function WeatherBadge() {
  const [weather, setWeather] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("https://wttr.in/Chicago?format=j1")
      .then((r) => r.json())
      .then((data) => {
        const current = data.current_condition?.[0];
        if (current) {
          const tempF = current.temp_F;
          const code = parseInt(current.weatherCode, 10);
          let icon = "☀️";
          if (code >= 113 && code <= 116) icon = "⛅";
          if (code >= 119 && code <= 122) icon = "☁️";
          if (code >= 176 && code <= 299) icon = "🌧️";
          if (code >= 300 && code <= 399) icon = "🌧️";
          if (code >= 200 && code <= 232) icon = "⛈️";
          if (code >= 600 && code <= 622) icon = "🌨️";
          if (code >= 395 || (code >= 323 && code <= 392)) icon = "🌨️";
          setWeather({
            icon,
            temp: `${tempF}°F`,
            humidity: `${current.humidity}%`,
            wind: `${current.windspeedMiles}mph`,
            location: "Chicago",
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!weather) return null;

  return (
    <span className="kf-weather-badge" onClick={() => setExpanded(!expanded)}>
      <span className="kf-weather-icon">{weather.icon}</span>
      <span className="kf-weather-temp">{weather.temp}</span>
      <span className="kf-weather-loc">{weather.location}</span>
      <span className={`kf-weather-detail${expanded ? " open" : ""}`}>
        <span className="kf-weather-stat">
          💧 {weather.humidity}
        </span>
        <span className="kf-weather-stat">
          💨 {weather.wind}
        </span>
      </span>
      <svg
        className={`kf-weather-chevron${expanded ? " open" : ""}`}
        width="10" height="10" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2.5"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </span>
  );
}