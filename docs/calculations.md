# Thermal performance calculations in the process model

The plant model is built on a library of thermal performance calculations in `src/plant/calc/`,
written in US customary units: psia, °F, Btu/lbm, kPPH, MMBtu/h, inHga, GPM. The process model
converts at the interface; the operator and controllers keep seeing SI / bar / mbar.

The same functions are used three ways:

1. **Design heat balance** (`src/plant/model/design.js`) solves the unit at MCR and derives every
   model constant from it: stage flow coefficients, heater zone areas, condenser surface, furnace
   radiant surface, convective section UA values, air heater UA.
2. **Process model** (`src/plant/model/PlantModel.js`) uses them as the physics, so the plant leaves
   the design point the way the equations say it should.
3. **Performance monitor** (`src/plant/model/performance.js`) evaluates them on the published
   measurements, as a plant performance system does on DCS data, and publishes the `PERF_*` tags
   (HMI: Performance).

## Unit design point (design.js)

| | |
|---|---|
| Gross output | 700 MW, 3600 rpm, 823.5 MVA, PF 0.85 |
| Throttle | 16.8 MPa(a) / 538 °C, 606.7 kg/s (solved for 700 MW) |
| Reheat | 3.97 MPa(a) / 538 °C |
| Drum | 18.2 MPa(a) (1.4 MPa superheater pressure drop) |
| Heaters | HPH7 (HP extraction 6.0 MPa), HPH6 (cold reheat), DA (crossover), LPH4-1; final feedwater 275 °C |
| Turbine efficiencies | HP 84.1 %, IP 89.2 %, LP 88.8 % (ELEP), level solved to meet the fuel below |
| Turbine cycle heat rate | 7985 kJ/kWh (7568 Btu/kWh) gross |
| Condenser | titanium 1" BWG 22, 21 860 tubes, 38 230 m², single pass; 6.8 kPa at 25 °C CW, cleanliness 0.85 |
| Fuel | natural gas (CH4 96, C2H6 2.2, C3H8 0.4, N2 0.9, CO2 0.5 vol %), LHV 49 MJ/kg |
| 100 % boiler demand | 1620 MW fuel (LHV), 33.1 kg/s gas, 624 kg/s air (2.0 % O2 wet) |
| Boiler efficiency | 85.8 % HHV (loss method) |
| Furnace | AFT 2061 °C, FEGT 1180 °C, effective radiant surface 4745 m², platen SH 18 % of radiant heat |
| Gas path | 1180 → 1106 (final SH) → 856 (RH) → 435 (primary SH) → 361 °C (economizer) → 128 °C no-leak |
| Air heater | 32 → 315 °C, X-ratio 0.82, gas side efficiency 70.8 %, 7 % leakage |

The earlier model's 1786 MW at 100 % boiler demand does not close against this cycle: it would
need turbine efficiencies about 15 % below any real unit. The controllers' MCR scaling (BMS, CCS,
CMB, Node.js and Structured Text) is now 1620 MW / 119 t/h gas / 2247 t/h air.

## Calculation map

| Area | Method | Module | Used for |
|---|---|---|---|
| Steam properties | IAPWS-IF97 | `common/if97.js`, `common/steam.js`, `calc/steamus.js` | all water / steam states |
| Fuel | volumetric → mass analysis | `calc/fuel.js`, `combustion.js` | gas analysis → ultimate analysis, HHV / LHV |
| Combustion | combustion analysis | `calc/combustion.js` | excess air from air / fuel, wet O2, flue gas composition and flow |
| Flue gas | JANAF / NIST Shomate | `calc/fluegas.js` | gas enthalpy, densities |
| Furnace | adiabatic flame temperature, normative furnace method | `calc/fluegas.js`, `furnace.js` | flame temperature, radiant absorption, FEGT, burner tilt |
| Sections | overall heat transfer coefficient | `calc/fluegas.js`, `model/design.js` | section UA and its gas flow / GIT dependence |
| Desuperheaters | spray balance | `calc/boiler.js` | spray flow |
| Boiler efficiency | loss method (ASME PTC 4.1 / PTC 4) | `calc/boiler.js` | efficiency, heat absorption |
| Air heater | ASME PTC 4.3 | `calc/airheater.js` | leakage correction, X-ratio, efficiencies |
| Turbine | Spencer, Cotton & Cannon ('62 GL), Stodola flow factors | `calc/turbine.js` | expansion line, stage pressures, power |
| Generator | '62 GL losses | `calc/generator.js` | generator and mechanical losses |
| Condenser | HEI Standards | `calc/condenser.js` | condenser pressure, cleanliness |
| Feedwater heaters | Tsou three-zone method (ASME PTC 12.1) | `calc/fwh.js` | outlet / drain temperatures, extraction flows |
| Pumps | pump curves, affinity laws | `calc/pumps.js` | BFP head, efficiency and power |
| Fans | total pressure, fan power | `calc/fans.js` | FD / ID fan power |
| Heat rate | controllable parameter corrections | `calc/heatrate.js` | unit heat rate, controllable losses |

Not used (not part of this unit): coal, oil and sorbent calculations (mills, residue, calcination,
sulfation), gas turbines, industrial drive turbines, multi-unit and multi-boiler weighting.

## Approximations

Where a method refers to a figure whose coefficients are not published, the model uses the
following. Each is marked in the source.

| Calculation | Missing | Used instead |
|---|---|---|
| Turbine expansion line | '62 GL 25-coefficient pressure / temperature correction (Fig. 14) | zero correction |
| Turbine exhaust loss | exhaust loss Table III; sonic-pressure iteration | representative 3600 rpm exhaust loss curve (min 8.6 Btu/lbm near 600 ft/s, turn-up below, rising to 41 Btu/lbm at 1400 ft/s), extrapolated above 1400 ft/s |
| HP design efficiency | partial load surface (Fig. 9) | quadratic loss below the first admission point |
| Generator losses | Fig. 20 / 22 / 23 polynomials | K1 = 1.4 % at 100 MVA falling 0.195 % per e-fold of size; Pmin and Loss15 linear in load (K2 as given) |
| Mechanical losses below 123 MVA | Z1 polynomial | linear (not used at this rating) |
| Condenser target pressure | HEI cutoff / zero-load pressure polynomials (Fig. 4) | saturation at CW inlet + 13 F (cutoff) and + 3 F (zero load) |
| Furnace exit gas temperature | tri-atomic gas and soot absorption coefficients | normative furnace method (tri-atomic and soot absorption coefficients, T'' = Ta / (1 + M Bo^-0.6 a^0.6)) |
| Adiabatic flame temperature | single mean specific heat | exact solve on the JANAF enthalpy |
| Flue gas enthalpy | "abbreviated JANAF / NASA" polynomials | NIST Shomate fits of the same JANAF tables |
| Steam properties | IFC-67 | IAPWS-IF97 (region 3 saturation from an IF97 table above 16.53 MPa) |
| Steam viscosity / conductivity | transport property formulation | Vogel viscosity and a polynomial liquid conductivity (about 2 %) |

Other modelling choices: burner tilt shifts the flame centre by 0.015 of the furnace height per
degree (about 1 K reheat per degree at full load); the platen superheater takes a fixed share of
the radiant absorption; superheater / reheater casing losses are 0.003 MW/K each; the turbine stage
groups use the Stodola-ellipse form of the stage flow factor so the last LP group responds to
condenser pressure.

## Controller retuning

The plant built on these calculations has weaker drum pressure self-regulation near 18 MPa (the
latent heat falls about 95 kJ/kg per MPa) and a different spray / tilt balance. Two loops were
retuned (map defaults and IC snapshots): boiler master `CCS:PIC_TP` kp 0.9 → 3.5, ti 300 → 500 s;
main steam temperature master `STC:TIC_MS` kp 1.5 → 1.0, ti 150 → 250 s.
