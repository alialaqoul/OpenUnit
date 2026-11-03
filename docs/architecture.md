# OpenUnit architecture

## Layers

```
 Browser HMI  (vanilla JS + SVG, Server-Sent Events, REST writes)
      |  HTTP :8080
 HMI / SCADA server  - Modbus TCP master polling every node (500 ms), alarms, historian, journal
      |  Modbus TCP
 +----+----+----+----+----+----+----+----+
 CCS  BMS  CMB  FWC  STC  DEH  GEN  BOP     8 controllers, each: Modbus TCP server (own registers)
 5021 5022 5023 5024 5025 5026 5027 5028    + Modbus TCP client of the field I/O and of its peers
      |  Modbus TCP (100 ms scan)
 PLANT :5020 - process simulator acting as remote I/O
```

Each box is an independent OS process in the default launch mode. The HMI never talks to the
process model directly; it sees only Modbus registers, which is the same view an operator station has
in a real DCS.

## Tag database = register map

`src/common/tags.js` turns declarations into Modbus addresses. For example:

```js
m.ir('MS_PRESS', 'bar', 'Main steam (throttle) pressure', { alarm: { h: 176, hh: 182 } })
m.pid('LIC_DRUM', { ... })   // expands to PV, SP, OUT, MODE, KP, TI, TD, CSP, STS
m.motor('BFP_A', { ... })    // START/STOP pulses, MODE, RUN, TRIP, PERM, ILK
```

* Addresses are allocated in declaration order, so servers, clients, the HMI and the documentation
  all derive the identical map from the same module.
* `section(owner, fn)` groups outputs into one contiguous block per writer. That gives each
  controller exactly one FC15 and one FC16 request per scan to the field I/O, and makes write
  ownership explicit. The runtime enforces it: a controller can only `pset` its own tags.
* Snapshots are stored by tag name, so they survive map changes.

## Controller runtime

`src/controllers/runtime/Controller.js` executes this cycle every 100 ms (wall clock):

1. Read field I/O input registers and discrete inputs, and read peers' status (parallel requests).
2. Compute `dt` from the plant's simulation clock (`SIM_TIME_MS`). Frozen means `dt = 0`; fast time means a larger `dt`.
3. Handle the IC / snapshot handshake (see below).
4. Run `logic()`, which uses the function blocks: `Loop` (PID with modes MAN/AUTO/CAS, tracking,
   bumpless transfer, anti-windup, % normalisation), `Station` (M/A loader with bias), `Motor` and
   `OnOff` device blocks (pulse commands, permissives, interlocks, auto/standby, trip latch), timers,
   edges and ramps.
5. Write the owned output block to the field I/O, plus peer write blocks; reset pulse coils.
6. Publish diagnostics: heartbeat, scan time, and communication health per link.

Communication fail-safe behaviour is explicit in each controller. For example, CMB treats loss of
the BMS link as an MFT for fuel purposes, and the plant trips fuel or turbine on a stale BMS/DEH
watchdog.

### Initial conditions across a distributed system

The instructor loads an IC on the plant (`IC_SELECT` + `IC_LOAD`). The plant then:

1. sets its state and freezes;
2. increments `IC_SEQ`;
3. publishes `IC_ACTIVE`.

Each controller then:

1. applies the IC: it either restores its own snapshot file or initialises its modes and outputs from plant feedback;
2. keeps scanning without writing outputs until every peer it reads reports the same `IC_APPLIED` for 3 scans;
3. re-applies the IC on fresh peer data, so loops track the actuator positions.

The plant starts automatically only after every controller has written its output block. This avoids
the classic mistake of a controller acting on a peer's pre-IC status.

## OpenPLC mode

With `controllers.runtime = "openplc"` (`npm run start:openplc`), each controller runs as an IEC 61131-3
program in its own OpenPLC Runtime v3 instance, in WSL. Its sources are in `plc/`; see
[plc/README.md](../plc/README.md).

* **Register maps.** The controller maps switch to the OpenPLC register model (`TagMap` layout `openplc`):
  all bits become coils `%QX`, and all numbers become 32-bit holding-register pairs in `%MD` (HR 2048+,
  high word first). `scripts/plc-build.js` declares every tag as a located variable, so the HMI, the
  generated programs and OpenPLC Editor share one address list.
* **Function block diagrams.** The programs are written in Structured Text (`plc/src`) and deployed as
  function block diagrams that `scripts/fbd/st-to-fbd.js` generates: one network per statement in
  execution order, IF / CASE branches gated by computed branch conditions on EN, FOR loops unrolled. The
  Editor transpiles the diagram back to ST for the runtime; the result behaves exactly like the source.
* **I/O image.** A soft-PLC is a Modbus server only, so `src/openplc/bridge.js` acts as its I/O network
  every 50 ms:
  - it writes the field inputs `I_*`, peer data `P_<PEER>_*` and link health `IO_COMM_*` into the PLC;
  - it copies the PLC's field outputs `Q_*` and peer writes `W_<PEER>_*` to the plant and the peers;
  - it writes each PLC's heartbeat into the peers it writes to.

  Only the signals a program uses are in its image; `src/maps/plcImage.js` finds them in the ST source.
* **Initial conditions and snapshots** follow the same two-phase procedure as the Node.js runtime, driven
  by the bridge. A PLC that restarts, for example after a download from OpenPLC Editor, is detected from
  its IC acknowledgement and re-initialised with its last operator settings. Until it has acknowledged,
  its peers keep its last good status.
* **Mixed operation.** `openplc.controllers` (or `SIM_OPENPLC`) puts only some controllers on OpenPLC. The
  Node.js controllers read an OpenPLC peer's status from its holding registers and coils.
* **OpenPLC Editor** reaches a v3 runtime by IP only, with REST on 8443 and the debugger on Modbus 502. The
  loopback relay (`src/openplc/relay.js`) therefore gives each runtime its own address, 127.0.0.11 to 18.

## Units

The process model works internally in SI-style units (MPa, kPa, Pa, kg/s). The field I/O layer
(`PlantModel.measure()`) converts to what the operator sees: bar(g) for steam/water/gas supply/oil,
mbar(a) for the condenser and mbar(g) for furnace draft, burner header and gland steam. Controllers
and the HMI only ever see the converted values. The grid runs at 60 Hz, giving 3600 rpm for the 2-pole generator.

## Process model

The process equations come from a library of thermal performance calculations in `src/plant/calc/`,
calibrated by the design heat balance in `src/plant/model/design.js`. [calculations.md](calculations.md)
maps every calculation to its use and lists the approximations made where coefficients are not published.

`src/plant/model/PlantModel.js` advances in fixed 50 ms steps (sub-stepped in fast time); the
iterative calculations (expansion line, Tsou heaters, HEI condenser, furnace radiation) run
every 0.5 s of simulation time. Main states:

| Subsystem | States / method |
|---|---|
| Combustion | combustion analysis from the air / fuel ratio: excess air, wet O2, flue gas composition |
| Furnace | available energy and flame temperature, radiant absorption (normative furnace method with a flame emissivity model); burner tilt moves the flame centre; absorption split waterwalls / platen SH |
| Convective pass | final SH bank, RH, primary SH, economizer: gas enthalpy (JANAF), UA from the design balance scaled by W^0.6, GIT^0.6 |
| Air heater | regenerative counter-flow effectiveness, X-ratio / gas side efficiency, leakage |
| Drum & evaporator | saturation temperature (energy balance incl. metal), water mass, swell (steam fraction + dP/dt flashing) |
| Superheaters / reheater | metal-steam node temperatures driven by the gas path duties |
| Turbine | governor valves into the first stage; stage pressures from the stage flow factors (Stodola form); HP / IP / LP efficiencies with ELEP / UEEP and exhaust loss; N2 packing leakage; stage power; generator and mechanical losses |
| Feedwater heaters | LPH1-4, DA, HPH6-7: Tsou three-zone prediction for outlet / drain temperature and extraction flow, cascading drains; DA heat balance |
| Condenser | HEI: tube velocity, inlet temperature and material corrections, cleanliness; air partial pressure vs. vacuum pump removal |
| Pumps / fans | BFP curve with affinity laws and pump power; fan total pressure and power |
| Generator | infinite-bus load angle, excitation lag, synchroscope phase integration |

Steam properties are IAPWS-IF97 (`src/common/if97.js`, `src/common/steam.js`);
`src/plant/calc/steamus.js` exposes them in US customary units.

The model also runs a **performance monitor** (`src/plant/model/performance.js`): the
calculations evaluated on the published measurements every 2 s, published as `PERF_*` tags and shown
on the HMI Performance screen.

## Extending

* **New measurement**: add it in `src/maps/plant.js` and assign it in `PlantModel.measure()`.
* **New controller function**: declare its tags in the controller map, then implement it in `logic()`.
  The HMI picks up loops and devices automatically: Control Loops screen, faceplates, alarms, trends.
* **New peer exchange**: add the relationship to `*_PEERS`, and a `peerBlock(...)` in the target map.
* **Distributed deployment**: edit the hosts in `config/network.json` and start the nodes on different machines.
