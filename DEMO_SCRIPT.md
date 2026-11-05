# ThermoRoute — 5-minute demonstration script

## Demo setup

Before presenting, start the backend and frontend in separate terminals. Verify `http://127.0.0.1:8000/api/health`. Use a stable network connection. Public map, geocoding, routing and forecast services can be unavailable; do not claim a feature is live if its source status says unavailable. For a hosted demo, configure `DATABASE_URL`, `CORS_ORIGINS`, and `CIVIC_ADMIN_TOKEN` on the backend before setting the frontend's `VITE_API_URL`.

Suggested journey: **PES University, Banashankari → Lalbagh Botanical Garden, Bengaluru**.

## 0:00–0:35 — Problem and product

“Most route planners optimize time or distance. ThermoRoute explores an additional question: what environmental conditions might a traveller encounter along the route? It combines road-network data, hourly weather and air-quality forecasts, mapped urban features and a transparent scoring model. It is a prototype and clearly labels forecasts and estimates.”

## 0:35–1:20 — Navigation and alternatives

Open Navigation. Enter the suggested origin and destination. Select Drive and find routes. Explain that the routing service may return up to three alternatives, but it does not enumerate every possible path. Show distance, estimated time and turn-by-turn instructions. Select an alternative and tilt the MapLibre map to show available 3D building extrusions.

Say: “These are road-network estimates from an OSRM-compatible public service. There is no live traffic feed, so the time is not a congestion-aware ETA.”

## 1:20–2:00 — Fastest versus route candidates

Open Mobility. Compare the same journey in Drive mode and use the ranking selector to switch between Fastest, Shortest, Fewest turns and Balanced. If time permits, repeat with Cycle or Walk. Explain that ranking normalizes measures against only the returned candidates; it is not a global optimality claim.

## 2:00–3:35 — AI Insights / coolest decision-support route

Open AI Insights. Keep the same journey, choose Walking or Cycling for a pedestrian/cyclist example, select a profile, and select a departure time. Find route candidates, choose one and run analysis.

Explain the route-wide sampling: “The route is sampled at several points. We allocate the route's estimated duration across the intervals so segment times sum to the full route duration. At each point, we select the forecast nearest its predicted arrival time.”

Show apparent temperature, UV, AQI, solar position, mapped shade status and rain estimate. Explain that the score is a weighted decision-support index. Missing inputs are not invented; they are excluded and the remaining weights are renormalized. Show the 30-minute departure candidates over six hours and identify the lowest available score.

Say: “The departure comparison holds route duration constant because we do not have a future traffic forecast. It is a forecast-based estimate, not a guarantee that waiting is safer.”

## 3:35–4:20 — Civic and City Planner

Open Civic. Submit a sample “No shade” or “Waterlogged” observation with a chosen or permitted current location. Show the saved report in the list. Explain that it is a community observation, saved to the configured SQLite or PostgreSQL database, and is not independently verified. Explain that reviewing or deleting reports is restricted to moderators; do not display or share the moderator token.

Open City Planner. Show the georeferenced map, available 3D building data and civic report markers. Explain that OpenStreetMap coverage varies and a missing object does not prove that a feature is absent.

## 4:20–5:00 — Trust, limitations and close

Open Environment or Simulation to show an Open-Meteo model forecast and source timestamp. Close with:

“ThermoRoute is intentionally transparent. Forecast data is labelled Forecast, geometry and timing are Estimated, citizen observations are Live database records, fallbacks are labelled, and the procedural Three.js city is Demo. The next steps are improving sampling density, caching public data, validating shadow estimates against better building data, and evaluating the exposure index with domain experts. It is a research prototype, not medical advice or emergency navigation.”
