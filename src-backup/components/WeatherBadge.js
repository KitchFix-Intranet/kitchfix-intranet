"use client";
import { useState, useEffect } from "react";

const WEATHER_CODES = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
  45: "🌫️", 48: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌧️",
  61: "🌧️", 63: "🌧️", 65: "🌧️",
  71: "🌨️", 73: "🌨️", 75: "❄️",
  77: "❄️", 80: "🌦️", 81: "🌧️", 82: "⛈️",
  85: "🌨️", 86: "❄️",
  95: "⛈️", 96: "⛈️", 99: "⛈️",
};

export default function WeatherBadge() {
  const [weather, setWeather] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph";
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d.current) setWeather(d.current);
      })
      .catch(() => {});
  }, []);

  if (!weather) return null;

  const icon = WEATHER_CODES[weather.weather_code] || "🌡️";
  const temp = Math.round(weather.temperature_2m);
  const humidity = weather.relative_humidity_2m;
  const wind = Math.round(weather.wind_speed_10m);

  return (
    <div
      className="kf-weather-badge"
      onClick={() => setExpanded(!expanded)}
      title="Click for details"
    >
      <span className="kf-weather-icon">{icon}</span>
      <span className="kf-weather-temp">{temp}°F</span>
      <div className={`kf-weather-detail ${expanded ? "open" : ""}`}>
        <span className="kf-weather-stat">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
          </svg>
          {humidity}%
        </span>
        <span className="kf-weather-stat">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
          </svg>
          {wind}mph
        </span>
      </div>
      <span className="kf-weather-loc">Chicago</span>
      <svg className={`kf-weather-chevron ${expanded ? "open" : ""}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}