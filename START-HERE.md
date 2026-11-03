# ThermoRoute 3.2.1 — Start here

Open this folder in VS Code. Confirm `package.json` is visible in the Explorer before running commands.

## Frontend (Terminal 1)

Use `npm install` to synchronize package metadata and the lockfile. Then run:

```powershell
npm install
npm run check:version
npm run type-check
npm run build
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`).

## Backend (Terminal 2)

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r backend/requirements.txt
py -m pip install -r backend/requirements-dev.txt
py -m compileall -q backend
py -m pytest -q
py -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

API health: `http://127.0.0.1:8000/api/health`  
Swagger UI: `http://127.0.0.1:8000/docs`

If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, then activate again. Keep both terminals open.

## Workspace pages

- **Overview:** backend status, Open-Meteo model conditions, quick links and a synthetic 3D concept city labelled Demo.
- **Navigation:** real route geometry, alternatives, turn steps, GPS and route export/share tools.
- **Environment:** point-level weather and air-quality model data for a searched place.
- **Mobility:** route alternatives for driving, cycling and walking with transparent ranking.
- **Civic:** save/list unverified citizen street observations in local SQLite.
- **AI Insights:** route-wide weather/AQI forecast samples, profile-weighted exposure estimate, mapped shade estimate and departure-time comparison.
- **Simulation:** inspect hourly weather and air-quality forecasts for a coordinate.
- **City Planner:** georeferenced MapLibre map with available OSM building extrusions and civic report pins.

## Truthfulness notes

- Open-Meteo data is labelled Forecast (model-derived), not physical sensor Live data.
- Route geometry and turns come from an OSRM-compatible public service; there is no live traffic.
- Shade and rain/waterlogging outputs are Estimated and depend on incomplete OSM data.
- Civic reports are local user submissions and are not verified.
- The Three.js concept city is Demo content. The City Planner map uses georeferenced map data.
- Exposure profiles and scores are experimental decision-support indices, not medical advice.

See `README.md`, `PROJECT_ABSTRACT.md`, `DEMO_SCRIPT.md` and `VIVA_QA.md` for architecture, formulas, limitations and presentation material.
