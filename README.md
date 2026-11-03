# OpenUnit - 700 MW Gas-Fired Steam Power Plant Simulator

A full-scope training simulator of a 700 MW subcritical drum-type steam unit fired with natural gas. It has three parts:

* a **dynamic process model** (IAPWS-IF97 steam, combustion analysis, furnace radiation, turbine flow factors and expansion line, feedwater heaters, condenser): boiler, combustion, turbine, generator, condenser, feedwater heaters and auxiliaries, plus a performance monitor;
* **8 independent controllers** (a small simulated DCS) that exchange data over **Modbus TCP**. They run either in Node.js or as **IEC 61131-3 programs in OpenPLC soft-PLCs**, whose logic can be watched live in OpenPLC Editor;
* a **high-performance web HMI** with an instructor station.

**Electrical system: 60 Hz, turbine-generator 3600 rpm.** Pressures are shown in **bar(g)** (steam, water, gas supply, lube oil) and **mbar** (condenser absolute, furnace draft, gas burner header, gland steam).

There are no runtime dependencies. The project uses Node.js ≥ 20 only; the Modbus TCP stack is implemented in this repository.

## Quick start

On Windows, double-click **`OpenUnit.cmd`** in the project folder. It opens the control panel menu:

| Menu item | What it does | Command |
|---|---|---|
| 12 Install / repair | One-time setup and repair. It checks Windows, Node.js 20+, WSL 2 and OpenPLC Editor, and offers to install what is missing. Then it creates the `OpenUnit-PLC` WSL distribution with the 8 OpenPLC runtimes and downloads the PLC programs. | `OpenUnit.cmd install` |
| 1 / 2 Start | Starts everything in the background: process model, controllers (1: OpenPLC soft-PLCs, 2: Node.js), I/O bridge and web HMI, from a chosen initial condition. It then opens the HMI. | `OpenUnit.cmd start [openplc\|node] [-IC 3]` |
| 3 Stop, 4 Restart | Stops (and restarts) everything, including the OpenPLC runtimes. | `OpenUnit.cmd stop` / `restart` |
| 5 Status | Shows what is running: simulator, HMI, field I/O, each controller or PLC runtime and PLC state. | `OpenUnit.cmd status` |
| 6-11 | Open the HMI or OpenPLC Editor; run/stop/restart a single PLC or open its web page; deploy or check PLC programs; show the log. | `hmi`, `editor`, `plc stop BOP`, `plc web BMS`, `deploy`, `check`, `logs` |

The simulator keeps running when the window is closed. Its output goes to `logs\simulator.log`.

From a terminal:

```bash
npm install          # dev tools only (vitest, eslint)
npm start            # plant + 8 controllers + HMI, one OS process each
```

Open **http://127.0.0.1:8080**. The unit starts at full load (IC 5) and runs as soon as all controllers are on line.

| Command | Purpose |
|---|---|
| `npm start` | Distributed mode: every node is its own process, auto-restarted if it crashes |
| `node src/launcher.js --single` | All nodes in one process (still talking Modbus TCP over localhost) |
| `SIM_IC=1 npm start` (PowerShell: `$env:SIM_IC=1; npm start`) | Start from another initial condition (1 cold, 2 hot standby, 3 FSNL, 4 50 %, 5 100 %) |
| `npm run start:plant` / `npm run start:controller -- DEH` / `npm run start:hmi` | Run single nodes, e.g. on different machines |
| `npm test` | Unit + integration tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run build` | Validate register maps, syntax-check all modules, regenerate `docs/modbus-map.md` |
| `node scripts/headless.js --ic 5 --speed 10 --seconds 600` | Headless run with periodic status lines (tuning / regression) |
| `bash scripts/make-ics.sh` | Regenerate the settled initial-condition snapshots in `config/ic/` |
| `node scripts/headless.js --ic 5 --scenario events` | Scripted abnormal events (BFP trip, ID fan runback, load rejection). Other scenarios: `sync` (IC 3), `coldstart` (IC 1), `loadreject`, `tocc` (IC 3: sync, coordinated control, load ramp) |
| `npm run start:openplc` | The same, with the controllers in OpenPLC Runtime soft-PLCs (see below) |
| `npm run plc:check` / `npm run plc:deploy` | Check / compile and download the PLC programs |

## Controllers in OpenPLC soft-PLCs

All controller logic is also available as IEC 61131-3 programs in [plc/](plc/README.md), one OpenPLC
Runtime v3 soft-PLC per controller, in a dedicated WSL distribution. The programs are **function block
diagrams**, generated from the Structured Text sources. Install it once with **`OpenUnit.cmd install`**
(checks WSL, Node.js and OpenPLC Editor, then builds and deploys everything), then start it (menu item 1).
Menu item 7 opens **OpenPLC Editor** with the 8 controller projects on its start screen: open one and start
the Debugger to see the controller's logic run live as blocks - PID loops, motors, interlocks, sequences
and every register. The HMI, the instructor station and Modbus addresses are unchanged; an I/O bridge
connects the PLCs to the plant and to each other. Details: [plc/README.md](plc/README.md).

## What is simulated

**Process (src/plant/model)**: a first-principles, lumped dynamic model integrated at 50 ms steps.

* Natural-gas fuel train: supply pressure, double block & bleed safety shut-off valves with vent, flow control valve, burner header, and 4 burner elevations with igniters and flame scanners. It also models unburned-gas accumulation and furnace puff.
* Balanced draft: 2 × FD and 2 × ID fans, air heaters, furnace pressure dynamics including the MFT implosion transient, O2/CO/NOx.
* Drum boiler energy and mass balance. Drum level includes swell/shrink and cold-water expansion; three level transmitters; blowdown; safety valves; tube leak.
* Primary and final superheater with a spray attemperator, and a reheater. All use gas-side driving force, so steam temperatures respond realistically to load, excess air and burner tilt.
* HP/IP/2×LP turbine:
  * Stodola-type valve flows, reheater storage (the classic reheat lag), extractions, and a vacuum-dependent LP output.
  * HP/LP bypass system.
  * Rotor inertia (H ≈ 3.5 s) with windage, turning gear, critical speeds, rotor bow/eccentricity, vibration, bearings, lube/jacking oil, metal temperatures and stress.
* Condenser with CW pumps, air partial pressure and vacuum pumps, gland steam, vacuum breaker, hotwell, deaerator with pegging steam, 3 × 50 % variable-speed BFPs (pump curves solved against the system curve), and HP heaters.
* Generator on an infinite bus:
  * load angle and reactive power from excitation, out-of-step detection;
  * synchroscope phase and slip, with consequences for out-of-phase closing;
  * stator/rotor temperatures, auxiliary power;
  * grid frequency and voltage disturbances.

**Controllers (src/controllers)**: each runs a 100 ms scan using simulation time, so run/freeze and fast time are honoured.

| Node | Port | Functions |
|---|---|---|
| CCS | 5021 | Unit load demand with ramp, frequency bias, runbacks, sliding/fixed pressure, BASE / BF / TF / COORDINATED modes, boiler master |
| BMS | 5022 | NFPA-85 style MFT with 18 first-out causes, 5 min purge, gas train, elevation light-off sequences, light-off timer |
| CMB | 5023 | Gas fuel master, air flow with O2 trim, air/fuel cross-limiting, furnace draft with FD feed-forward and MFT kicker, fan interlocks & runback |
| FWC | 5024 | Drum level 1-/3-element with bumpless transfer and 2oo3 median, BFP DP control and auto-standby, deaerator level/pressure, EBD |
| STC | 5025 | Cascade SH spray, superheat margin limiter, burner tilt and RH emergency spray |
| DEH | 5026 | Turbine protection (12 trips), latch, speed control with critical-speed avoidance, load control with droop, OPC, TPL/VPL, valve management, TSE stress, HP/LP bypass with follow mode |
| GEN | 5027 | AVR with V/Hz, OEL and UEL limiters, MVAR/PF control, auto-synchroniser, synchro-check, 86G protection (10 functions incl. sequential reverse-power tripping) |
| BOP | 5028 | CW, vacuum, condensate pumps with standby, lube oil / JOP / turning gear automatics, hotwell level |

**Modbus TCP data exchange**

* The process simulator acts as remote I/O on port 5020. Every controller reads its input registers and discrete inputs, and writes only its own contiguous block of coils and holding registers.
* Controllers also exchange data peer-to-peer. Examples: CCS writes the boiler demand into CMB and the load reference into DEH; GEN writes synchroniser speed adjustments into DEH; DEH, CMB, FWC and STC read BMS MFT status.
* Hardwired fail-safes in the I/O: if the BMS or DEH watchdog register stops changing, the plant trips the fuel or the turbine.
* All addresses are documented in [docs/modbus-map.md](docs/modbus-map.md). You can connect any Modbus client (Modbus Poll, QModMaster, a real PLC) to the ports above. Set `bindHost` in `config/network.json` to `0.0.0.0` to expose them on your LAN.

**HMI (src/hmi)**: a SCADA server polls all nodes every 500 ms and provides alarms (ISA-18.2 states), a 2-hour historian and an event journal. It streams to the browser over Server-Sent Events.

* Mimics: Overview, Boiler, Combustion, Turbine, Feedwater, Condenser & CW, Electrical (single line, synchroscope, P-Q diagram).
* Panels: BMS & Protection with first-out indication.
* Lists and tools: Control Loops, Trends, Alarms & Events, Procedures (live-checked step lists for cold start, hot start, synchronising, load changes, shutdown, abnormal events), Network / Modbus (topology, statistics, raw register explorer, register map).
* Instructor station: run/freeze, 0.5–10× speed, initial conditions and snapshots, 22 malfunctions, grid/CW/gas boundary conditions.
* Faceplates: clicking any loop, station, device or value opens a faceplate. PID faceplates support mode changes, setpoint/output entry and live tuning, and include a mini-trend.

## Typical training exercises

1. **Load changes**: IC 5. Overview → set the unit target to 500 MW at 20 MW/min, press GO, and watch sliding pressure, firing and steam temperatures.
2. **Equipment trips**: Instructor → `MF_BFP_A_TRIP` (standby BFP C auto-starts) or `MF_ID_A_TRIP` (runback to 350 MW).
3. **Load rejection**: `MF_GRID_FAULT`. OPC holds the turbine near 3600 rpm and the bypass protects the boiler; re-synchronise.
4. **Synchronising**: IC 3. Electrical → SYNC ON, or synchronise manually against the synchroscope.
5. **Cold start-up**: IC 1. Follow Procedures → *Cold start-up*. Use 5–10× speed for heat-up.

## Project layout

```
config/            network.json (nodes, ports), ic/ (initial-condition snapshots)
src/common/        Modbus TCP stack, tag database, IAPWS-IF97 steam properties, control blocks
src/maps/          register maps of every node (single source of truth)
src/plant/         process model (model/: design heat balance, PlantModel, performance monitor),
                   calculation library, initial conditions, field I/O node
src/controllers/   controller runtime (scan, PID/station/motor/valve blocks) and the 8 controllers
src/openplc/       OpenPLC mode: I/O bridge, loopback relay for OpenPLC Editor, WSL runtime control
plc/               IEC 61131-3 sources (src/, lib/) and the generated OpenPLC Editor projects (projects/,
                   programs as function block diagrams made by scripts/fbd/)
src/hmi/           SCADA server (alarms, history, SSE/REST) and the browser HMI (public/)
scripts/           headless runner, IC generation, build and doc generation, plc-* (OpenPLC build/deploy),
                   openplc/ (WSL install, runtime instances, supervisor)
tests/             Vitest unit and integration tests
docs/              architecture and the generated Modbus register map
```

See [docs/architecture.md](docs/architecture.md) for design details.
