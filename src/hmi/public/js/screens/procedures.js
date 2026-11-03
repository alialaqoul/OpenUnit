import { val, onUpdate, esc } from '../core.js';

const v = (k) => val(k);
const on = (k) => !!val(k);
const auto = (k) => (val(`${k}.MODE`) ?? 0) >= 1;
const cas = (k) => (val(`${k}.MODE`) ?? 0) === 2;

const PROCEDURES = [
  {
    id: 'cold',
    title: 'Cold start-up (from IC 1)',
    intro: 'Complete start-up from cold & dark to full load. Run the simulator at 5-10x for the long heat-up phases (Instructor screen). Expect ~6-8 h of plant time.',
    steps: [
      ['Verify turbine on barring gear: AC lube oil pump running, LO pressure > 1 bar, turning gear engaged', 'turbine', () => on('PLANT:AOP_RUN') && v('PLANT:LO_PRESS') > 1.0 && on('PLANT:TG_ENGAGED')],
      ['Start CW pumps A and B (BOP) - put the standby pump in AUTO', 'condenser', () => on('PLANT:CWP_A_RUN') && on('PLANT:CWP_B_RUN')],
      ['Start condensate pump A, put hotwell level LIC_HW in AUTO', 'feedwater', () => on('PLANT:CEP_A_RUN') && auto('BOP:LIC_HW')],
      ['Put deaerator level LIC_DA in AUTO and pegging steam PIC_DA in AUTO (1.5 bar)', 'feedwater', () => auto('FWC:LIC_DA') && auto('FWC:PIC_DA')],
      ['Open gland steam supply', 'condenser', () => on('PLANT:GLAND_ON')],
      ['Start vacuum pumps A and B (hogging)', 'condenser', () => on('PLANT:VP_A_RUN') && on('PLANT:VP_B_RUN')],
      ['Wait for condenser vacuum < 200 mbar(a)', 'condenser', () => on('BOP:VAC_OK'), 'Takes about 15-20 minutes of plant time.'],
      ['Start BFP A at minimum scoop; put SC_BFPA in AUTO, PIC_FWDP in CAS (program)', 'feedwater', () => on('PLANT:BFP_A_RUN') && cas('FWC:PIC_FWDP')],
      ['Fill / control drum level: FIC_FW in CAS, LIC_DRUM in AUTO (SP about -100 mm for start-up swell)', 'boiler', () => cas('FWC:FIC_FW') && auto('FWC:LIC_DRUM')],
      ['Put emergency blowdown EBD in AUTO (opens at +150 mm)', 'boiler', () => (val('FWC:EBD.MODE') ?? 0) === 1],
      ['Start air preheaters A and B', 'combustion', () => on('PLANT:APH_A_RUN') && on('PLANT:APH_B_RUN')],
      ['Start ID fan A then FD fan A (vanes closed); then ID B and FD B', 'combustion', () => on('PLANT:ID_A_RUN') && on('PLANT:FD_A_RUN')],
      ['Fan stations to AUTO; PIC_FURN in AUTO (-1.0 mbar); FIC_AIR in CAS (purge air ~900 t/h)', 'combustion', () => on('CMB:FURN_AUTO') && on('CMB:AIR_AUTO')],
      ['All purge permissives satisfied - press PURGE START', 'bms', () => on('BMS:PURGE_ACTIVE') || on('BMS:PURGE_COMPLETE') || !on('BMS:MFT')],
      ['Purge complete (5 min) - press MFT RESET', 'bms', () => !on('BMS:MFT'), 'An elevation must be lit within 15 minutes or the light-off timer trips the boiler.'],
      ['Open the gas fuel train (SSV-1/2 open, vent closed)', 'bms', () => on('BMS:GAS_TRAIN.OPENED')],
      ['Light burner elevation A (GFCV at light-off position)', 'bms', () => on('BMS:ELEV_A.INSERV')],
      ['Fire with FIC_GAS in MAN (GFCV 6-12 %). Limit drum saturation temperature rise to ~2-3 K/min (drum metal dT < 50 K)', 'boiler', () => v('PLANT:DRUM_PRESS') > 5, 'SH start-up vent is open in AUTO below 3 bar and closes above 5 bar.'],
      ['Put HP bypass PIC_HPB in AUTO (FIXED, target 60 bar, ramp 1 bar/min) and LP bypass PIC_LPB in AUTO', 'boiler', () => auto('DEH:PIC_HPB') && auto('DEH:PIC_LPB')],
      ['Raise pressure and temperature: throttle > 55 bar and main steam > 380 degC', 'boiler', () => v('PLANT:MS_PRESS') > 55 && v('PLANT:MS_TEMP') > 380],
      ['Reset / latch the turbine (DEH)', 'turbine', () => on('DEH:LATCHED')],
      ['Roll: speed target 600 rpm, rate 100 rpm/min, GO. Turning gear disengages automatically', 'turbine', () => v('DEH:SPEED') > 550],
      ['Check eccentricity / vibration; target 2400 rpm, GO (critical speeds are passed at >= 300 rpm/min)', 'turbine', () => v('DEH:SPEED') > 2350],
      ['Heat soak until HP rotor stress < 70 %; then target 3600 rpm, GO', 'turbine', () => on('DEH:AT_SPEED')],
      ['Close field breaker 41, AVR in AUTO - generator voltage 22 kV', 'electrical', () => on('PLANT:FCB_CLOSED') && v('PLANT:GEN_KV') > 21],
      ['SYNC ON - auto-synchroniser matches speed/voltage and closes 52G', 'electrical', () => on('PLANT:GCB_CLOSED'), 'The unit picks up ~35 MW initial load automatically.'],
      ['Raise load to 70 MW (DEH LOAD target, 10 MW/min, GO) while increasing firing', 'turbine', () => v('PLANT:GEN_MW') > 60],
      ['Light elevation B; start BFP B and put SC_BFPB in AUTO before 40 % load', 'bms', () => (v('BMS:ELEV_INSERV') ?? 0) >= 2 && on('PLANT:BFP_B_RUN')],
      ['Steam temperature control: TIC_MS AUTO, TIC_DSH CAS, TIC_RH AUTO, TIC_RHS AUTO (spray block opens > 20 % load)', 'boiler', () => auto('STC:TIC_MS') && cas('STC:TIC_DSH') && auto('STC:TIC_RH')],
      ['Fuel master FIC_GAS to CAS, O2 trim AIC_O2 to AUTO', 'combustion', () => on('CMB:FM_AUTO') && auto('CMB:AIC_O2')],
      ['DEH control to REMOTE (CCS); CCS mode COORDINATED', 'overview', () => v('CCS:MODE_ACT') === 3],
      ['Unit load target 700 MW, rate 14 MW/min, GO; light elevations C and D (210 MW capacity per elevation)', 'overview', () => v('PLANT:GEN_MW') > 690],
    ],
  },
  {
    id: 'hot',
    title: 'Hot start - roll, sync & load (from IC 2)',
    intro: 'Boiler at 60 bar on bypass, vacuum established. Turbine metal is hot - roll quickly to avoid cooling the rotor (watch TSE stress).',
    steps: [
      ['Increase firing (FIC_GAS MAN) to raise main steam temperature above 420 degC', 'combustion', () => v('PLANT:MS_TEMP') > 420],
      ['Reset / latch the turbine', 'turbine', () => on('DEH:LATCHED')],
      ['Target 3600 rpm at 300 rpm/min, GO (hot start)', 'turbine', () => on('DEH:AT_SPEED')],
      ['Close field breaker 41, AVR AUTO', 'electrical', () => on('PLANT:FCB_CLOSED')],
      ['SYNC ON and wait for breaker closure', 'electrical', () => on('PLANT:GCB_CLOSED')],
      ['Load to 150 MW (DEH LOCAL, 20 MW/min) while increasing firing; bypass closes and switches to FOLLOW', 'turbine', () => v('PLANT:GEN_MW') > 140 && v('DEH:HPB_MODE') === 1],
      ['Light elevation B, start BFP B (AUTO), steam temperature loops in AUTO/CAS', 'bms', () => (v('BMS:ELEV_INSERV') ?? 0) >= 2],
      ['FIC_GAS CAS, AIC_O2 AUTO, DEH REMOTE, CCS COORDINATED', 'overview', () => v('CCS:MODE_ACT') === 3],
    ],
  },
  {
    id: 'sync',
    title: 'Synchronising (from IC 3)',
    intro: 'Turbine at full speed no load with field applied. Practise automatic and manual synchronisation.',
    steps: [
      ['Check generator voltage matches grid (dV < 2 %), AVR in AUTO', 'electrical', () => Math.abs(v('GEN:DV_PCT') ?? 99) < 2],
      ['Option A: SYNC ON (auto). Option B: trim DEH speed target to get a slow positive slip and close 52G when the synchroscope is at 12 o clock', 'electrical', () => on('PLANT:GCB_CLOSED'), 'The synchro-check relay blocks manual closure outside +/-15 deg, 0.2 Hz, 5 %.'],
      ['Verify initial load ~35 MW and stable furnace / drum level', 'overview', () => v('PLANT:GEN_MW') > 25],
    ],
  },
  {
    id: 'load',
    title: 'Load changes & coordinated control (IC 4 / IC 5)',
    intro: 'Practise ramping in coordinated mode with sliding pressure and observe the boiler-turbine interaction.',
    steps: [
      ['CCS in COORDINATED mode', 'overview', () => v('CCS:MODE_ACT') === 3],
      ['Set load target 500 MW at 20 MW/min and press GO; watch pressure setpoint slide', 'overview', () => Math.abs((v('CCS:ULD_ACT') ?? 0) - 500) < 2],
      ['Switch to FIXED pressure 167 bar and observe governor valve throttling', 'overview', () => v('CCS:PRESS_MODE') === 0],
      ['Return to SLIDING pressure and full load', 'overview', () => v('CCS:PRESS_MODE') === 1 && v('PLANT:GEN_MW') > 690],
      ['Try a grid frequency dip to 59.8 Hz (Instructor) and watch primary response', 'instructor', () => (v('PLANT:GRID_FREQ') ?? 60) < 59.9],
    ],
  },
  {
    id: 'shutdown',
    title: 'Normal shutdown',
    intro: 'Unit from load to boiler off, turbine on barring.',
    steps: [
      ['Reduce unit load to 210 MW in coordinated control', 'overview', () => (v('PLANT:GEN_MW') ?? 999) < 230],
      ['Shut down burner elevations D and C', 'bms', () => (v('BMS:ELEV_INSERV') ?? 4) <= 2],
      ['CCS to BASE; DEH LOCAL; reduce load to ~40 MW (bypass opens to hold pressure)', 'turbine', () => (v('PLANT:GEN_MW') ?? 999) < 50],
      ['Trip the turbine (DEH TRIP) - generator opens on reverse power (sequential trip)', 'turbine', () => on('DEH:TRIPPED') && !on('PLANT:GCB_CLOSED')],
      ['Stop the remaining elevations - the boiler trips on loss of all fuel (MFT)', 'bms', () => on('BMS:MFT')],
      ['Keep fans running for post-purge; JOP and turning gear start automatically as the rotor coasts down', 'turbine', () => on('PLANT:TG_ENGAGED')],
    ],
  },
  {
    id: 'events',
    title: 'Abnormal events - operator response',
    intro: 'Use the Instructor screen to insert malfunctions, then follow these response guides.',
    steps: [
      ['BFP trip at full load: standby BFP C auto-starts (AUTO); if not, CCS runback to 385 MW - verify drum level recovers', 'feedwater', () => true],
      ['ID / FD fan trip: paired fan stops, runback to 350 MW at 50 %/min; watch furnace pressure and O2', 'combustion', () => true],
      ['Turbine trip at load: boiler MFT (load > 30 %), generator reverse-power trip; HP/LP bypass hold pressure', 'turbine', () => true],
      ['Load rejection (grid fault): OPC closes GV/ICV, turbine returns to 3600 rpm FSNL; re-synchronise', 'electrical', () => true],
      ['Condenser air in-leakage: start standby vacuum pump, reduce load if condenser pressure > 150 mbar; turbine trips at 300 mbar', 'condenser', () => true],
      ['Drum level transmitter failure: 2oo3 median selection keeps control; deviation alarm identifies the failed LT', 'boiler', () => true],
      ['Gas supply pressure drop: header pressure falls; reduce firing, low-low header pressure trips the boiler', 'bms', () => true],
    ],
  },
];

let selected = 'cold';

export default {
  id: 'procedures',
  title: 'Procedures',
  render(root, { go }) {
    const draw = () => {
      const p = PROCEDURES.find((x) => x.id === selected);
      let nextFound = false;
      const steps = p.steps
        .map(([text, screen, check, hint], i) => {
          let done = false;
          try {
            done = !!check();
          } catch {
            done = false;
          }
          const next = !done && !nextFound;
          if (next) nextFound = true;
          return `<div class="step ${done ? 'done' : ''} ${next ? 'next' : ''}"><div class="chk">${done ? '&#10003;' : i + 1}</div>
            <div>${esc(text)}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div><button class="btn small" data-go="${screen}">${esc(screen)} &rsaquo;</button></div>`;
        })
        .join('');
      root.querySelector('#proc').innerHTML = `<h3>${esc(p.title)}</h3><p style="color:var(--muted);margin-top:0">${esc(p.intro)}</p>${steps}`;
      root.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('sel', b.dataset.p === selected));
    };
    root.innerHTML = `<div class="cols" style="grid-template-columns:260px minmax(0,1fr)">
      <div class="panel" style="overflow:auto;min-height:0"><h3>Operating procedures</h3>${PROCEDURES.map((p) => `<button class="btn" style="width:100%;text-align:left;margin-bottom:4px" data-p="${p.id}">${esc(p.title)}</button>`).join('')}
      <p style="color:var(--muted);font-size:11px">Steps are checked live against plant data. The highlighted step is the next action.</p></div>
      <div class="panel procedure" id="proc" style="overflow:auto;min-height:0"></div></div>`;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.p) {
        selected = b.dataset.p;
        draw();
      }
      if (b.dataset.go) go(b.dataset.go);
    });
    draw();
    let last = 0;
    const off = onUpdate(() => {
      if (Date.now() - last > 1000) {
        last = Date.now();
        draw();
      }
    });
    return { dispose: off };
  },
};
