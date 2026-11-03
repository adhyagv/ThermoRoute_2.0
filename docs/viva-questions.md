# ThermoRoute viva questions and answer cues

Use the answer cues as a concise guide; explain assumptions and limitations rather than claiming scientific precision.

1. **What problem does ThermoRoute address?**  
   It helps compare returned Bengaluru travel routes using route-specific weather/AQI forecast samples, estimated shade, travel time, and community observations.

2. **How does the thermal route replay differ from showing origin weather?**  
   It samples the route geometry, allocates OSRM duration over route intervals, and queries/interpolates forecast data at each sample's predicted arrival time.

3. **How are segment arrival times computed?**  
   Route duration is distributed across `n - 1` sample intervals in proportion to distance. A final remainder correction ensures the sum equals the original route duration.

4. **How is temporal forecast interpolation handled?**  
   Linear interpolation is applied only between adjacent valid hourly values. Missing values and times outside the available forecast range remain unavailable; the service does not extrapolate.

5. **How is solar position calculated?**  
   The backend uses Astral to calculate solar azimuth/elevation and sunrise/sunset for a coordinate and timestamp, interpreted in Asia/Kolkata for Bengaluru.

6. **How does the shade estimator use OpenStreetMap?**  
   It uses mapped building footprints and available heights to estimate shadow geometry in local metric coordinates. Tagged heights are preferred; building levels multiplied by the documented 3 m floor assumption are explicitly estimated. Tree shade requires adequate mapped dimensions.

7. **Why is route shade distance-weighted?**  
   A point count can overrepresent short intervals. The implementation weights shade by evaluated route-interval length, dividing estimated shaded length by evaluated route length.

8. **What does low shade confidence mean?**  
   It indicates incomplete mapped feature/height/tree coverage or other uncertainty. It does not prove that shade is absent.

9. **How do route ranking strategies work?**  
   Fastest and shortest focus on normalized time and distance; coolest and cleanest-air use available environmental scores; balanced combines time and environmental objectives using the preference slider. Alternatives are only those returned by the routing provider.

10. **How are missing environmental measurements handled?**  
    They remain unavailable and are omitted from score components with available weights renormalized; missing data is not treated as zero exposure.

11. **What is Pareto dominance in the comparison?**  
    A candidate is marked dominated when another returned candidate is no worse on the comparable metrics and better on at least one; this is only within the returned candidate set.

12. **How does Best Time to Travel choose a departure?**  
    It evaluates 30-minute candidates within a configurable forecast window, checks the default 10-minute additional-time limit, and recommends only when required exposure data is available. If no candidate qualifies, it does not force a recommendation.

13. **Does the departure recommendation predict traffic?**  
    No. It holds route durations fixed and does not model future congestion or traffic-dependent travel time.

14. **How are civic reports stored and validated?**  
    FastAPI/Pydantic validates request fields and coordinates; SQLite stores reports using parameterized queries. New submissions are unverified and creation is rate-limited.

15. **What does civic report density represent?**  
    The number/distribution of community submissions. It is not measured heat intensity, and approximate coordinate cells are not official neighbourhood boundaries.

16. **What are the key external dependencies and failure modes?**  
    Nominatim, public OSRM, Open-Meteo/CAMS, Overpass, and OpenFreeMap are open public services that may be rate-limited or unavailable; the UI should show errors or unavailable data transparently.

17. **What makes the system technically defensible?**  
    It preserves provenance, exposes assumptions, bounds external-data requests, uses a shared analysis contract, avoids inventing missing values, and distinguishes forecast, estimated, community, and demo content.

18. **What should not be inferred from the exposure score?**  
    It is an experimental, profile-weighted decision-support index, not a medical safety assessment or individualized health recommendation.
