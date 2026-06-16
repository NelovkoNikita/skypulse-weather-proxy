/**
 * SkyPulse weather proxy — Render.com web service
 *
 * Назначение: обходит блокировку api.open-meteo.com в России.
 * Сайт обращается к этому серверу (домен *.onrender.com сейчас доступен
 * без VPN), а сервер сам делает запрос к настоящему api.open-meteo.com
 * (с серверов Render, физически не в зоне блокировки РФ) и возвращает
 * свежие данные без архивной задержки.
 *
 * Использование с фронтенда:
 *   https://ВАШ-СЕРВИС.onrender.com/?latitude=52.52&longitude=13.41
 * Принимает те же query-параметры, что и обычный Open-Meteo /v1/forecast.
 */

const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_PARAMS = [
  "latitude", "longitude", "current", "hourly", "daily",
  "timezone", "temperature_unit", "wind_speed_unit", "precipitation_unit",
  "forecast_days", "past_days"
];

// CORS — разрешаем запросы с любого источника (ваш статичный сайт)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// простой health-check, чтобы видеть, что сервис жив
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/", async (req, res) => {
  const lat = req.query.latitude;
  const lon = req.query.longitude;

  if (!lat || !lon) {
    return res.status(400).json({ error: true, reason: "latitude and longitude are required" });
  }

  const target = new URL("https://api.open-meteo.com/v1/forecast");
  for (const key of ALLOWED_PARAMS) {
    if (req.query[key] !== undefined) target.searchParams.set(key, req.query[key]);
  }

  try {
    const upstream = await fetch(target.toString());
    const body = await upstream.text();
    res.status(upstream.status);
    res.set("Content-Type", "application/json");
    res.set("Cache-Control", "public, max-age=300");
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: true, reason: "upstream fetch failed" });
  }
});

app.listen(PORT, () => {
  console.log(`SkyPulse weather proxy listening on port ${PORT}`);
});
