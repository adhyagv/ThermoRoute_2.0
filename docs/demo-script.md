# ThermoRoute demo walkthrough

Suggested duration: 7–10 minutes. Keep both the Vite frontend and FastAPI backend running. Public routing, forecast, and Overpass services can be delayed or rate-limited; describe unavailable data honestly rather than presenting a fallback as a live result.

## 1. Product and provenance (1 minute)

1. Open **Overview** and identify Bengaluru as the target city.
2. Point out the data/provenance labels and explain that weather and AQI are model forecasts, shade is estimated, civic observations are unverified, and the 3D concept scene is illustrative.
3. Mention the existing navigation and backend health functionality retained in the upgrade.

## 2. Route search and replay (2 minutes)

1. Open **Navigation**, keep the example PES University → Lalbagh Botanical Garden journey, and select Drive, Cycle, or Walk.
2. Search and inspect the returned route alternatives, road geometry, route duration, and turn instructions.
3. Select **Explore Thermal Journey**. The chosen journey and actual candidate geometries are carried into **AI Insights**.
4. Click **Explore Thermal Journey** in AI Insights to run the shared analysis.
5. Play the route timeline or move the slider. Show the active route location, estimated mapped-building shadow polygons, shade-coded route segments, distance/time progress, predicted Bengaluru arrival time, apparent temperature, UV, AQI/PM2.5 where available, shade estimate, and source/timestamp.
6. Point out that missing observations are marked unavailable and forecast samples are interpolated only between forecast hours.

## 3. Solar shadow estimate (1 minute)

1. In **AI Insights**, compare the Morning, Midday, Afternoon, and Evening presets, rerunning the analysis after changing the time.
2. Show solar elevation/azimuth, route shade, coverage and confidence.
3. Explain that Astral provides solar position; mapped OSM footprints and tagged heights inform the estimate; `building:levels × 3 m` is an explicit assumption, and incomplete mapping limits confidence.

## 4. Decision engine and best time (2 minutes)

1. Compare route candidates and switch among fastest, shortest, coolest, cleanest-air, and balanced strategies.
2. Move the FASTEST ↔ COOLEST/CLEANEST preference slider. Explain that changing inputs clears the old analysis; press **Explore Thermal Journey** again to recalculate.
3. Show time, distance, turn count, exposure, shade, AQI, normalized score, Pareto status, and the recommendation explanation.
4. Review the departure chart. Explain the default 30-minute spacing, six-hour window, 10-minute maximum additional travel time, Asia/Kolkata time display, and no-extrapolation rule.
5. If no qualifying forecast candidate exists, show that no recommendation is established rather than implying a forced optimum.

## 5. Community heat intelligence (1–2 minutes)

1. Open **Civic** and submit a sample report using a non-sensitive description or anonymous mode.
2. Show that its initial status is **Unverified**, then filter by category/status/date and inspect the report marker/list.
3. Open the hotspot summary and explain that coordinate-cell groupings are approximate and the trends measure community submissions—not scientific heat intensity.

## Closing

Reiterate that ThermoRoute is a research and decision-support prototype. It is not a medical device, live-traffic service, emergency system, street-level sensor network, or flood warning system.
