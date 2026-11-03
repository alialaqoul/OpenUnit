# EtaPRO calculation templates in the process model

The plant model is built on the EtaPRO calculation templates in `97) EtaPRO Calculation Templates`.
Each template the unit needs is a function in `src/plant/etapro/`, named after the template and
written in the templates' own (US customary) units: psia, °F, Btu/lbm, kPPH, MMBtu/h, inHga, GPM.
The process model converts at the interface; the operator and controllers keep seeing SI / bar / mbar.

The same functions are used three ways:

1. **Design heat balance** (`src/plant/model/design.js`) solves the unit at MCR and derives every
   model constant from it: stage flow coefficients, heater zone areas, condenser surface, furnace
   radiant surface, convective section UA values, air heater UA.
2. **Process model** (`src/plant/model/PlantModel.js`) uses them as the physics, so the plant leaves
   the design point the way the templates say it should.
3. **Performance monitor** (`src/plant/model/performance.js`) evaluates them on the published
   measurements, as EtaPRO does on DCS data, and publishes the `PERF_*` tags (HMI: Performance).

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

## Template map

| Area | Templates | Module | Used for |
|---|---|---|---|
| Steam properties | GP Steam (IF97) | `common/if97.js`, `common/steam.js`, `etapro/gpsteam.js` | all water / steam states |
| Fuel | 3140, 3150, 3165, 3161, 3250 | `etapro/fuel.js`, `combustion.js` | gas analysis → ultimate analysis, HHV / LHV |
| Combustion | 3 (subroutine), 3000, 3010, 3015, 3020, 3030, 3170, 3260 | `etapro/combustion.js` | excess air from air / fuel, wet O2, flue gas composition and flow |
| Flue gas | 3300, 3303, 3304, 3305 | `etapro/fluegas.js` | gas enthalpy (JANAF / NIST Shomate), densities |
| Furnace | 3680, 3690 (+ FlameEmissivity calc details), 3660 | `etapro/fluegas.js`, `furnace.js` | flame temperature, radiant absorption, FEGT, burner tilt |
| Sections | 3351, 3427, 3650 | `etapro/fluegas.js`, `model/design.js` | section UA and its gas flow / GIT dependence |
| Desuperheaters | 3501, 3505 | `etapro/boiler.js` | spray balance |
| Boiler efficiency | 3040, 3050, 3060, 3070, 3080, 3085, 3090, 3120, 3130, 3180 | `etapro/boiler.js` | loss-method efficiency, heat absorption |
| Air heater | 3800, 3810, 3820, 3830, 3840, 3850, 3860, 3880, 3903, 3904 | `etapro/airheater.js` | leakage correction, X-ratio, efficiencies |
| Turbine | 2000 - 2420 (flows, flow factors 2080, efficiencies 2110 / 2111 / 2140, 2150, 2160, ELEP / UEEP 2180 / 2200, 2209 / 2210, section power 2220 - 2240, packing 2260 - 2315, design efficiencies 2340 / 2350, 2370, deviations 2390 - 2420) | `etapro/turbine.js` | expansion line, stage pressures, power |
| Generator | 2500, 2510, 2520, 2530, 2540, 2550 | `etapro/generator.js` | generator and mechanical losses |
| Condenser | 2600, 2601, 2610, 2611, 2620, 2630, 2640, 2641, 2642, 2660, 2680, 2690, 2700, 2701, 2930 | `etapro/condenser.js` | HEI condenser pressure, cleanliness |
| Feedwater heaters | 2900, 2910, 2930, 2990 - 2999 (Tsou) | `etapro/fwh.js` | outlet / drain temperatures, extraction flows |
| Pumps | 4000 - 4240 | `etapro/pumps.js` | BFP head, efficiency and power |
| Fans | 7400, 7401, 7402 | `etapro/fans.js` | FD / ID fan power |
| Heat rate | 2800, 5010, 5020, 5030, 5090, 5100, 5110, 5120, 5130, 5160, 5170, 5182, 5200 | `etapro/heatrate.js` | unit heat rate, controllable losses |

Not used (not part of this unit): coal, oil and sorbent templates (mills, residue, calcination,
sulfation), gas turbine (6500 series), industrial drive turbine (7000 series), multi-unit and
multi-boiler weighting templates.

## Approximations

Where a template refers to a figure whose coefficients are not in the documents, or has no body,
the model uses the following. Each is marked in the source.

| Template | Missing | Used instead |
|---|---|---|
| 2200 step 2 | '62 GL 25-coefficient pressure / temperature correction (Fig. 14) | zero correction |
| 2200 step 8 / 9 | exhaust loss Table III; sonic-pressure iteration | representative 3600 rpm exhaust loss curve (min 8.6 Btu/lbm near 600 ft/s, turn-up below, rising to 41 Btu/lbm at 1400 ft/s), extrapolated above 1400 ft/s |
| 2340 step 5 | partial load surface (Fig. 9) | quadratic loss below the first admission point |
| 2520 | Fig. 20 / 22 / 23 polynomials | K1 = 1.4 % at 100 MVA falling 0.195 % per e-fold of size; Pmin and Loss15 linear in load (K2 as given) |
| 2530 below 123 MVA | Z1 polynomial | linear (not used at this rating) |
| 2610 step 4 | HEI cutoff / zero-load pressure polynomials (Fig. 4) | saturation at CW inlet + 13 F (cutoff) and + 3 F (zero load) |
| 3690 | template body; TriAtomGasesCoeff, SootPartCoeff | normative furnace method the FlameEmissivity routine is written for (tri-atomic and soot absorption coefficients, T'' = Ta / (1 + M Bo^-0.6 a^0.6)) |
| 3680 | single mean specific heat | exact solve on the JANAF enthalpy |
| 3305 | "abbreviated JANAF / NASA" polynomials | NIST Shomate fits of the same JANAF tables |
| GP Steam | IFC-67 | IAPWS-IF97 (region 3 saturation from an IF97 table above 16.53 MPa) |
| StmVisc / StmCond | GP Steam transport properties | Vogel viscosity and a polynomial liquid conductivity (about 2 %) |

Modelling choices that are not templates: burner tilt shifts the flame centre by 0.015 of the
furnace height per degree (about 1 K reheat per degree at full load); the platen superheater takes a
fixed share of the radiant absorption; superheater / reheater casing losses are 0.003 MW/K each; the
turbine stage groups use the Stodola-ellipse form of the 2080 flow factor so the last LP group
responds to condenser pressure.

## Controller retuning

The template-based plant has weaker drum pressure self-regulation near 18 MPa (the latent heat falls
about 95 kJ/kg per MPa) and a different spray / tilt balance. Two loops were retuned (map defaults
and IC snapshots): boiler master `CCS:PIC_TP` kp 0.9 → 3.5, ti 300 → 500 s; main steam temperature
master `STC:TIC_MS` kp 1.5 → 1.0, ti 150 → 250 s.
