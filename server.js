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
 
// Простой in-memory кэш: на бесплатных хостингах вроде Render IP-адрес сервера
// общий с другими проектами, поэтому лимит запросов Open-Meteo (600/мин, 5000/час,
// 10000/день на IP) может исчерпываться чужими проектами на том же IP. Кэш
// уменьшает число повторных обращений к Open-Meteo за одни и те же координаты
// и таким образом снижает риск получить 429 из-за "соседей по IP".
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут
const cache = new Map(); // key -> { body, status, expiresAt }
 
function cacheKeyFor(target){
  // округляем координаты до 2 знаков (~1.1 км) — этого достаточно для города,
  // и позволяет схлопнуть повторные запросы на одно и то же место
  const lat = parseFloat(target.searchParams.get("latitude")).toFixed(2);
  const lon = parseFloat(target.searchParams.get("longitude")).toFixed(2);
  return `${lat},${lon},${target.searchParams.get("hourly")},${target.searchParams.get("daily")}`;
}
 
function cleanupExpiredCache(){
  const now = Date.now();
  for (const [key, entry] of cache.entries()){
    if (entry.expiresAt < now) cache.delete(key);
  }
}
 
// CORS — разрешаем запросы с любого источника (ваш статичный сайт)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
 
// простой health-check, чтобы видеть, что сервис жив
app.get("/health", (req, res) => res.json({ ok: true, cacheSize: cache.size }));
 
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
 
  const cacheKey = cacheKeyFor(target);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()){
    res.status(cached.status);
    res.set("Content-Type", "application/json");
    res.set("X-Cache", "HIT");
    return res.send(cached.body);
  }
 
  try {
    const upstream = await fetch(target.toString());
    const body = await upstream.text();
 
    if (upstream.status === 429){
      // лимит Open-Meteo исчерпан (возможно, другим проектом на том же IP).
      // Отдаём понятную ошибку — фронтенд автоматически уйдёт на архивный API.
      return res.status(429).json({
        error: true,
        reason: "rate limited by upstream Open-Meteo API, try again later"
      });
    }
 
    if (upstream.ok){
      cache.set(cacheKey, { body, status: upstream.status, expiresAt: Date.now() + CACHE_TTL_MS });
      cleanupExpiredCache();
    }
 
    res.status(upstream.status);
    res.set("Content-Type", "application/json");
    res.set("Cache-Control", "public, max-age=300");
    res.set("X-Cache", "MISS");
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: true, reason: "upstream fetch failed" });
  }
});
 
app.listen(PORT, () => {
  console.log(`SkyPulse weather proxy listening on port ${PORT}`);
});
