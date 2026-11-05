# ThermoRoute — Viva / Interview Questions and Answers

## 1. What problem does ThermoRoute solve?

It explores route comparison beyond travel time and distance. It estimates environmental exposure along a route using hourly weather and air-quality forecasts, solar position and nearby mapped shade features. It is decision support, not a medical risk predictor.

## 2. What is the architecture?

A React 18 and TypeScript frontend runs with Vite. MapLibre GL JS renders geospatial maps and available 3D building extrusions; Three.js renders a separate synthetic concept scene. A Python FastAPI backend validates requests and coordinates routing, forecast sampling, shade estimation, exposure scoring and civic reports stored in local SQLite or configured PostgreSQL.

## 3. Where does the route geometry come from?

Place names are resolved with Nominatim. An OSRM-compatible public routing endpoint returns route geometry, alternatives when available, distances, estimated durations and maneuver instructions. The public service is not a live-traffic provider.

## 4. How do you fix the route-duration allocation bug?

For each interval, duration is total route duration multiplied by that interval's share of total route distance. A final floating-point correction is applied to the last interval. The unit-test invariant is that the sum of interval durations equals the route duration.

## 5. How is route-wide environmental sampling performed?

The geometry is resampled at approximately equal spatial intervals, up to a bounded sample count. The service predicts each sample's arrival time using cumulative allocated duration and selects the nearest hourly forecast for that coordinate and time.

## 6. How is shade estimated?

A solar-position approximation provides sun azimuth and elevation. OSM building heights or an assumed 3 metres per mapped building level are used to approximate shadow length as height divided by the tangent of sun elevation. Nearby trees/tree rows and alignment relative to the sun are also considered. This is a coarse heuristic, not ray tracing or a measured shade percentage.

## 7. How is the exposure score calculated?

Available heat, UV, AQI and shade-penalty components are normalized to 0–100 and combined using profile-specific weights. If an input is missing, its weight is excluded and the remaining weights are renormalized. The values and weights are experimental product assumptions, not medically validated thresholds.

## 8. How does the departure-time recommender work?

It evaluates 13 departure candidates from the current request time through six hours later in 30-minute steps. It computes the route score for each candidate and chooses the lowest score when sufficient forecast data exists. Travel duration is held constant; future traffic is not modelled.

## 9. What is the purpose of the Civic module and how is data stored?

It allows users to report geotagged street observations such as high heat, no shade, waterlogging, broken signals or unsafe crossings. Reports are stored in local SQLite or configured PostgreSQL through FastAPI and displayed in the application. They are unverified user submissions and should not contain personal information; moderation requires a backend-configured token.

## 10. What are the key limitations and how do you handle data honesty?

Open public services can be unavailable or rate-limited. Forecasts are grid-cell model outputs, OSM mapping is incomplete, shade and waterlogging are estimates, routes have no live traffic, and the exposure index is not medically validated. The UI labels values Forecast, Estimated, Live, Fallback or Demo, reports source status, and does not replace missing route-wide forecast values with fabricated numbers.
