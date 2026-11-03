# OpenUnit - controller logic in OpenPLC soft-PLCs

The eight unit controllers can run as **IEC 61131-3 programs in OpenPLC Runtime v3 soft-PLCs**, one
runtime per controller, instead of the built-in Node.js controllers. The plant model, the HMI and every
Modbus register stay the same. Each controller program is a **function block diagram (FBD)**, so in
**OpenPLC Editor** the logic is drawn as blocks - PID loops, motor and valve blocks, timers, first-out
trips, AND/OR/compare/select logic - and the Debugger animates it with live values, as on a real DCS
engineering station.

| Controller | Program | Editor IP | Modbus TCP (local) | Runtime web page |
|---|---|---|---|---|
| CCS - Unit coordinated control | `CCS_MAIN` | 127.0.0.11 | 127.0.0.1:5121 | http://localhost:8121 |
| BMS - Burner management | `BMS_MAIN` | 127.0.0.12 | 127.0.0.1:5122 | http://localhost:8122 |
| CMB - Combustion & draft | `CMB_MAIN` | 127.0.0.13 | 127.0.0.1:5123 | http://localhost:8123 |
| FWC - Feedwater & condensate | `FWC_MAIN` | 127.0.0.14 | 127.0.0.1:5124 | http://localhost:8124 |
| STC - Steam temperature | `STC_MAIN` | 127.0.0.15 | 127.0.0.1:5125 | http://localhost:8125 |
| DEH - Turbine control & protection | `DEH_MAIN` | 127.0.0.16 | 127.0.0.1:5126 | http://localhost:8126 |
| GEN - Generator, excitation, sync | `GEN_MAIN` | 127.0.0.17 | 127.0.0.1:5127 | http://localhost:8127 |
| BOP - Balance of plant | `BOP_MAIN` | 127.0.0.18 | 127.0.0.1:5128 | http://localhost:8128 |

The addresses come from `openplc.nodes` in `config/network.json`. Runtime REST and web log-in:
`openplc` / `openplc` (`openplc.user` / `openplc.password`).

## Installing

Double-click **`OpenUnit.cmd`** in the project folder and choose **12 Install / repair** (or run
`OpenUnit.cmd install` from a terminal). It:

1. checks the prerequisites - Windows 10 2004+ / 11, Node.js 20+, WSL 2, OpenPLC Editor and its
   command line - and offers to install what is missing (WSL needs administrator rights and a reboot;
   run the installer again afterwards);
2. creates a dedicated WSL distribution **`OpenUnit-PLC`** (Ubuntu 24.04, in
   `%LOCALAPPDATA%\OpenUnit\wsl`) - your other WSL distributions are not touched;
3. builds OpenPLC Runtime v3 in it and creates the 8 runtime instances (about 10 minutes);
4. compiles and downloads the 8 PLC programs.

Re-running it is safe. Options: `-Yes` (no questions), `-SkipDeploy`, `-Distro <name>`,
`-Export <file.tar>` (save the finished distribution) and `-Package <file.tar>` (install from such a file
on another PC - no 10-minute build, no Linux downloads).

To remove everything: `wsl --unregister OpenUnit-PLC`.

## Running

Double-click **`OpenUnit.cmd`** and choose **1 Start** (stop with 3, overview with 5), or from a terminal:

```sh
OpenUnit.cmd start           # in the background; OpenUnit.cmd stop / status
npm run start:openplc        # in the foreground: plant + 8 soft-PLCs + I/O bridge + HMI  ->  http://127.0.0.1:8080
```

Single PLCs: menu item 8, or `OpenUnit.cmd plc status`, `OpenUnit.cmd plc stop|run|restart <NODE|all>`,
`OpenUnit.cmd plc web <NODE>` (the runtime's web page).

The launcher starts the runtimes in the WSL distribution, the loopback relay for OpenPLC Editor and the
I/O bridge.
**Ctrl+C** stops everything, including the runtimes. Everything else (HMI, instructor station,
initial conditions, snapshots, malfunctions, fast time) works as in the Node.js mode.

To run only some controllers on OpenPLC and the rest in Node.js, set `openplc.controllers` in the config,
for example `["BMS", "BOP"]`, or run `SIM_OPENPLC=BMS,BOP npm run start:openplc`.

## Watching the logic live in OpenPLC Editor

1. Start the simulator (menu item 1).
2. Menu item **7 OpenPLC Editor** (or `npm run plc:editor`) lists the 8 controller projects on the
   Editor's start screen. Click one; then open its program (`<NODE>_MAIN`) under *Programs*.
3. The program opens as a function block diagram. Pan with the mouse, zoom with Ctrl + wheel. The
   variable table above it can be scrolled away or made smaller.
4. The project's device is already *OpenPLC Runtime v3* at the controller's IP. Start the **Debugger**,
   connect to the runtime and log in with `openplc` / `openplc`. Every variable shows its live value on the
   diagram (BOOLs coloured), and you can force values. The PLC must run the program of the project: after
   a change in the sources, download it first (menu item 9).

The large programs take a few seconds to open (BMS about 15 s).

Each runtime also has a web page (table above, log-in `openplc` / `openplc`). Its *Monitoring* page lists
every located variable with its live value.

## How the diagrams are made

The diagrams are generated from the Structured Text sources by `scripts/fbd/st-to-fbd.js`, so the ST
stays the one place where the logic is written. Every ST statement becomes one network, in execution
order (the numbered badges on the blocks):

| ST | Diagram |
|---|---|
| `x := a + b * c` | blocks ADD, MUL, ... wired into the output variable `x` |
| `PIC_TP(PV_IN := pms, ...);` then `BLR_DMD := PIC_TP.Q;` | the function block `PIC_TP` with its pins wired; outputs read right after the call are wires from the block |
| `IF c THEN ... ELSIF d THEN ... ELSE ... END_IF` | one network per branch computes its condition into a BOOL - `IF12`, `IF12_2`, `IF12_ELSE` (the comment above it shows the ST condition) - and the networks of the branch get it on **EN** (a MOVE for a plain copy) |
| `CASE s OF 1: ...` | the same with `CASE7_1`, `CASE7_2`, ... |
| `FOR x := 1 TO 4 DO ...` | unrolled: the body once per value, `x` replaced by 1, 2, 3, 4 |

The function blocks and functions of the library (`FB_LOOP`, `FIRST_OUT`, ...) stay in ST: double-click a
block's POU in the project tree to read it. A few things MatIEC lacks are drawn differently: `-x` as
`0 - x`, `a <> b` on BOOLs as XOR, and AND / OR / XOR / NOT / MOD (ST keywords) never carry EN
themselves. The generated program behaves exactly like the ST: it was checked by running both side by
side on randomised and scripted inputs (every statement executed, every variable compared each scan) and
in closed loop with the plant.

## Changing the logic

The sources are the master copies:

```
plc/src/<NODE>.st            controller program (PROGRAM <NODE>_MAIN)
plc/lib/function-blocks/     shared blocks: FB_LOOP (PID), FB_STATION (M/A), FB_MOTOR, FB_ONOFF,
                             FB_TONS (timer on simulation time), FB_RAMP, FB_PLC_RUNTIME
plc/lib/functions/           MEDIAN3, VOTE2OO3, FIRST_OUT (first-out trip cause), FGEN5 (function
                             generator), TSAT (steam table)
```

```sh
npm run plc:check    # check the ST with the runtime's compiler (MatIEC) and the diagrams with OpenPLC Editor
npm run plc:deploy   # build, compile and download to the runtimes (also while the simulator runs)
```

`plc:build` regenerates `plc/projects/` from the sources, diagrams included. Edits made only in a
generated project are overwritten, so make them in `plc/src` (or `plc/lib`). You can also download from
OpenPLC Editor directly; the simulator copes the same way. To get the programs as Structured Text
instead of diagrams, set `openplc.language` to `"st"` (or `node scripts/plc-build.js --st`) and deploy.

When a PLC restarts after a download, the I/O bridge notices and writes back its last operator settings
(modes, setpoints, tuning), then the PLC takes over from the actual plant state without a bump.

**Freeze the simulator before downloading to BMS or DEH while the unit is running.** A download stops
the PLC for about 10 s, and the field's hardwired watchdogs then trip the boiler (BMS) or the turbine
(DEH), exactly as on a real plant.

## How it fits together

```
 Browser HMI ── HTTP ── HMI server ──────────── Modbus TCP ──────────────┐
                                                                          │
 PLANT (field I/O, :5020) ◄── Modbus TCP ── I/O BRIDGE ── Modbus TCP ──► 8 × OpenPLC Runtime v3 (WSL)
                                             (50 ms)                       :5121 … :5128
 OpenPLC Editor ── 127.0.0.1x:8443 / :502 ── loopback relay ─────────────┘  (REST / debugger)
```

* **Register map.** Every register-map tag of a controller is a *located variable* in its program
  (`AT %MDn` for numbers, high word first; `AT %QXn.m` for bits). The map gets an OpenPLC layout for this
  (`src/common/tags.js`), and `scripts/plc-build.js` generates the declarations from it. The HMI register
  map (Network screen) shows each tag's IEC address.
* **I/O image.** An OpenPLC runtime is a Modbus TCP server only. It cannot poll the field I/O or its peers
  itself, so the I/O bridge (`src/openplc/bridge.js`) plays the I/O network. It writes field inputs
  `I_*`, peer data `P_<PEER>_*` and link health `IO_COMM_*` into each PLC, and copies the PLC's field
  outputs `Q_*` and peer writes `W_<PEER>_*` out again. Only the signals a program uses are in its image;
  the bridge finds them by scanning `plc/src/<NODE>.st` (`src/maps/plcImage.js`).
* **Simulation time.** `FB_PLC_RUNTIME` derives the time step from the plant clock, so PID loops, timers
  and ramps follow freeze and fast time.
* **Initial conditions.** The bridge loads a controller's values from the snapshot (or the map defaults),
  issues an IC command (`IO_IC_SEQ`), waits for every controller and does a second pass on fresh peer data.
  Field outputs are held meanwhile, as the Node.js controllers do. It also saves controller snapshots.
* **Runtimes.** `scripts/openplc/` installs OpenPLC v3 in WSL and creates one instance per controller with
  its own ports. Each instance gets two fixes to the v3 Modbus server: a race in its accept loop that
  could leave a connection unserved, and coil writes (FC15) that overwrote up to 7 coils after the
  written range. A supervisor keeps the runtimes running while the simulator runs. The relay
  (`src/openplc/relay.js`) gives each runtime its own loopback IP on Windows, because the Editor expects a
  v3 runtime on ports 8443 and 502.

## Setting up another PC

Copy the project and run `OpenUnit.cmd install` there. To skip the build, export the distribution once
(`OpenUnit.cmd install -Export D:\openunit-plc.tar`) and install with
`OpenUnit.cmd install -Package D:\openunit-plc.tar`.

Notes:
- OpenPLC v3 is built without DNP3 (it does not build with CMake 4 and the simulator does not use it).
- Native Windows (MSYS2) builds of OpenPLC v3 were tried: the runtime starts very slowly and its HTTPS
  upload hangs, so the runtimes run in WSL.
