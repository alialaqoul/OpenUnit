import { Controller } from './runtime/Controller.js';
import { PID_MODE } from '../common/tags.js';
import { median3, clamp, fgen } from '../common/blocks.js';

const MCR_STEAM = 2149; // t/h
const TRIM_GAIN = 12; // t/h per % of level master output in 3-element mode
const dpProgram = fgen([
  [0, 10],
  [30, 12],
  [100, 20],
]); // bar

/** Drum level (1/3-element), BFP speed (valve DP), deaerator level & pressure, blowdown. */
export class FwcController extends Controller {
  constructor() {
    super('FWC');
    for (const p of ['A', 'B', 'C']) this.motor(`BFP_${p}`);
    this.onoff('EBD', { cmd: 'EBD_CMD', opened: 'EBD_OPEN' });
    this.onoff('HPH', { cmd: 'HPH_CMD', opened: 'HPH_IN_SERVICE' });
    this.loop('LIC_DRUM', { action: 'reverse' });
    this.loop('FIC_FW', { action: 'reverse' });
    this.loop('PIC_FWDP', { action: 'reverse' });
    for (const p of ['A', 'B', 'C']) this.station(`SC_BFP${p}`);
    this.loop('LIC_DA', { action: 'reverse' });
    this.loop('PIC_DA', { action: 'reverse' });
    this.station('HIC_CBD');
  }

  levels() {
    return [this.p('DRUM_LVL_A'), this.p('DRUM_LVL_B'), this.p('DRUM_LVL_C')];
  }

  e3Wanted(steamPct) {
    const sel = this.get('ELEM_SEL');
    if (sel === 1) return false;
    if (sel === 2) return true;
    const prev = !!this.state.latch.e3;
    return prev ? steamPct > 20 : steamPct > 25;
  }

  logic() {
    const lt = this.levels();
    const lvl = median3(...lt);
    this.set('DRUM_LVL_SEL', lvl);
    this.set('LT_DEVIATION', this.ton('ltdev', lt.some((v) => Math.abs(v - lvl) > 50), 5));

    const steam = this.p('STEAM_FLOW');
    const spray = this.p('SH_SPRAY_FLOW');
    const fw = this.p('FW_FLOW');
    const steamPct = (steam / MCR_STEAM) * 100;
    this.set('STEAM_FLOW_PCT', steamPct);

    // ---- drum level: 1-element / 3-element with bumpless transfer
    const lic = this.loops.LIC_DRUM;
    const fic = this.loops.FIC_FW;
    const e3 = this.e3Wanted(steamPct);
    const ff = Math.max(0, steam - spray);
    if (e3 !== !!this.state.latch.e3) {
      this.state.latch.e3 = e3;
      lic.setOut(e3 ? clamp(50 + (fw - ff) / TRIM_GAIN, 0, 100) : this.p('FCV_FB'));
      lic.wasTracking = true;
    }
    this.set('E3_ACTIVE', e3);
    const ficCas = this.get('FIC_FW.MODE') === PID_MODE.CAS;
    if (!e3) {
      const licOut = lic.run({ pv: lvl, track: ficCas ? null : this.p('FCV_FB') });
      fic.run({ pv: fw, csp: fw, track: ficCas ? licOut : null });
    } else {
      const licOut = lic.run({ pv: lvl, track: ficCas ? null : clamp(50 + (fw - ff) / TRIM_GAIN, 0, 100) });
      fic.run({ pv: fw, csp: clamp(ff + (licOut - 50) * TRIM_GAIN, 0, 2600) });
    }
    this.pset('FCV_DMD', fic.out);
    this.set('LVL_AUTO', lic.auto && ficCas);

    // ---- boiler feed pumps
    const running = ['A', 'B', 'C'].filter((p) => this.p(`BFP_${p}_RUN`));
    this.set('BFP_RUNNING', running.length);
    const daLvl = this.p('DA_LVL');
    for (const p of ['A', 'B', 'C']) {
      const others = ['A', 'B', 'C'].filter((q) => q !== p);
      const partnerTrip = others.some((q) => this.p(`BFP_${q}_TRIP`) || !!this.state.dev[`BFP_${q}`]?.trip);
      const st = this.stations[`SC_BFP${p}`];
      const permit = daLvl > 1200 && st.get('OUT') <= 10;
      const wasRunning = this.p(`BFP_${p}_RUN`);
      this.devices[`BFP_${p}`].run({ permit, autoStart: partnerTrip && running.length < 3 });
      if (this.rise(`bfpRun${p}`, wasRunning) && this.devices[`BFP_${p}`].auto && partnerTrip) {
        // Auto-standby start: join the master demand without bias
        this.state.latch[`bfpJoin${p}`] = true;
      }
    }
    const dp = this.p('FW_HDR_PRESS') - this.p('DRUM_PRESS');
    this.set('FW_DP', dp);
    const dpc = this.loops.PIC_FWDP;
    const anyAuto = running.some((p) => this.stations[`SC_BFP${p}`].get('MODE') === PID_MODE.AUTO);
    const avgScoop = running.length ? running.reduce((a, p) => a + this.stations[`SC_BFP${p}`].get('OUT'), 0) / running.length : 0;
    const master = dpc.run({
      pv: dp,
      csp: this.get('DP_SP_MODE') === 1 ? dpProgram(steamPct) : undefined,
      track: running.length === 0 || !anyAuto ? avgScoop : null,
    });
    this.set('BFP_MASTER', master);
    for (const p of ['A', 'B', 'C']) {
      const st = this.stations[`SC_BFP${p}`];
      const run = this.p(`BFP_${p}_RUN`);
      if (this.state.latch[`bfpJoin${p}`]) {
        st.setMode(PID_MODE.AUTO);
        this.state.stMode[st.name] = PID_MODE.AUTO;
        st.set('BIAS', 0);
        this.state.latch[`bfpJoin${p}`] = false;
      }
      const out = st.run({ auto: master, fb: clamp((this.p(`BFP_${p}_SPEED`) - 1500) / 39, 0, 100), forceMan: !run, track: run ? null : 0, rate: 3 });
      this.pset(`BFP_${p}_SPD_DMD`, out);
    }
    // Runback only if the standby pump has not restored two running pumps within 10 s.
    this.set('RB_BFP', this.ton('rbBfp', running.length < 2 && steamPct > 58 && this.p('GCB_CLOSED'), 10));

    // ---- deaerator level and pressure
    const cep = this.p('CEP_A_RUN') || this.p('CEP_B_RUN');
    this.pset('DA_CV_DMD', this.loops.LIC_DA.run({ pv: daLvl, track: cep ? null : 0 }));
    this.pset('PEG_DMD', this.loops.PIC_DA.run({ pv: this.p('DA_PRESS') }));

    // ---- blowdown and HP heaters
    this.devices.EBD.run({ autoOpen: lvl > 150, autoClose: lvl < 50 });
    this.devices.HPH.run({});
    this.pset('CBD_DMD', this.stations.HIC_CBD.run({ fb: this.p('CBD_FB') }));
  }

  onBuiltInIC(id) {
    const L = this.loops;
    const S = this.stations;
    this.set('EBD.MODE', PID_MODE.AUTO);
    for (const p of ['A', 'B', 'C']) {
      const run = this.p(`BFP_${p}_RUN`);
      this.set(`BFP_${p}.MODE`, run ? PID_MODE.MAN : PID_MODE.AUTO);
      S[`SC_BFP${p}`].setOut(run ? clamp((this.p(`BFP_${p}_SPEED`) - 1500) / 39, 0, 100) : 0);
      S[`SC_BFP${p}`].setMode(run && id >= 2 ? PID_MODE.AUTO : PID_MODE.MAN);
      this.state.stMode[`SC_BFP${p}`] = S[`SC_BFP${p}`].get('MODE');
    }
    const running = ['A', 'B', 'C'].filter((p) => this.p(`BFP_${p}_RUN`));
    L.PIC_FWDP.setOut(running.length ? S[`SC_BFP${running[0]}`].get('OUT') : 0);
    L.FIC_FW.setOut(this.p('FCV_FB'));
    L.LIC_DA.setOut(this.p('DA_CV_FB'));
    L.PIC_DA.setOut(this.p('PEG_FB'));
    const steamPct = (this.p('STEAM_FLOW') / MCR_STEAM) * 100;
    const e3 = steamPct > 25;
    this.state.latch.e3 = e3;
    const ff = this.p('STEAM_FLOW') - this.p('SH_SPRAY_FLOW');
    L.LIC_DRUM.setOut(e3 ? clamp(50 + (this.p('FW_FLOW') - ff) / TRIM_GAIN, 0, 100) : this.p('FCV_FB'));
    const auto = id >= 2;
    L.LIC_DRUM.setMode(auto ? PID_MODE.AUTO : PID_MODE.MAN);
    L.FIC_FW.setMode(auto ? PID_MODE.CAS : PID_MODE.MAN);
    L.PIC_FWDP.setMode(auto ? PID_MODE.CAS : PID_MODE.MAN);
    L.LIC_DA.setMode(auto ? PID_MODE.AUTO : PID_MODE.MAN);
    L.PIC_DA.setMode(auto ? PID_MODE.AUTO : PID_MODE.MAN);
  }
}
