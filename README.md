# OpenUnit - 700 MW Gas-Fired Steam Power Plant Simulator

A full-scope training simulator of a 700 MW subcritical drum-type steam unit fired with natural gas:
a dynamic process model, 8 independent controllers exchanging data over Modbus TCP (in Node.js or
OpenPLC soft-PLCs) and a high-performance web HMI with an instructor station.

![Overview](docs/screenshots/overview.png)

## Screenshots

| | |
|---|---|
| **Boiler**<br>![Boiler](docs/screenshots/boiler.png) | **Combustion**<br>![Combustion](docs/screenshots/combustion.png) |
| **BMS & Protection**<br>![BMS & Protection](docs/screenshots/bms.png) | **Turbine**<br>![Turbine](docs/screenshots/turbine.png) |
| **Feedwater**<br>![Feedwater](docs/screenshots/feedwater.png) | **Condenser & CW**<br>![Condenser & CW](docs/screenshots/condenser.png) |
| **Performance**<br>![Performance](docs/screenshots/performance.png) | **Electrical**<br>![Electrical](docs/screenshots/electrical.png) |
| **Control Loops**<br>![Control Loops](docs/screenshots/loops.png) | **Trends**<br>![Trends](docs/screenshots/trends.png) |
| **Alarms & Events**<br>![Alarms & Events](docs/screenshots/alarms.png) | **Procedures**<br>![Procedures](docs/screenshots/procedures.png) |
| **Network / Modbus**<br>![Network / Modbus](docs/screenshots/network.png) | **Instructor**<br>![Instructor](docs/screenshots/instructor.png) |

## Installation

**Requirements:** [Node.js](https://nodejs.org/) 20 or later. For the optional OpenPLC soft-PLC
mode on Windows: WSL 2 and OpenPLC Editor (the installer checks and offers to install them).

### Windows

1. Clone or download this repository.
2. Double-click **`OpenUnit.cmd`** in the project folder.
3. Choose **12 Install / repair** for the one-time setup (or run `OpenUnit.cmd install`).
4. Choose **1** (OpenPLC soft-PLCs) or **2** (Node.js controllers) to start the simulator.
   The HMI opens in your browser.

### Any platform (Node.js controllers)

```bash
git clone https://github.com/alialaqoul/OpenUnit.git
cd OpenUnit
npm install
npm start
```

Then open **http://127.0.0.1:8080**. The unit starts at full load and runs as soon as all
controllers are on line.

## License

MIT
