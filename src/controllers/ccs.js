import { Controller } from './runtime/Controller.js';
import { PID_MODE } from '../common/tags.js';
import { clamp } from '../common/blocks.js';
import { slidingPressure } from '../plant/model/initialConditions.js';

const MODE = { BASE: 0, BF: 1, TF: 2, CC: 3 };
const RATED = 700;
const ELEV_MW = 210; // unit capability per burner elevation in service

/**
 * Unit coordinated control: unit load demand with ramp, frequency bias, runbacks,
 * sliding / fixed pressure, boiler master and turbine master co-ordination.
 */
export class CcsController extends Controller {
  constructor() {
    super('CCS');
    this.loop('PIC_TP', { action: 'reverse', spTrack: false });
  }

  defaultState() {
    const s = super.defaultState();
    Object.assign(s, { uld: 0, psp: 16.7, go: false, dropT: 0 });
    return s;
  }

  /** Peer value, holding the last good value while the link is down. */
  peerVal(node, tag, fallback) {
    const key = `${node}.${tag}`;
    const cache = (this.state.peerCache ||= {});
    if (this.peerOk(node)) cache[key] = this.peer(node, tag);
    return cache[key] ?? fallback;
  }

  logic() {
    const s = this.state;
    const p = (t) => this.p(t);
    const dt = this.dt;
    const mw = p('GEN_MW');
    const pms = p('MS_PRESS');
    const gcb = p('GCB_CLOSED');

    const mft = this.peerVal('BMS', 'MFT', true);
    const elevIn = this.peerVal('BMS', 'ELEV_INSERV', 0);
    const remReady = this.peerVal('DEH', 'REM_READY', false);
    const latched = this.peerVal('DEH', 'LATCHED', false);
    const fmAuto = this.peerVal('CMB', 'FM_AUTO', false);
    const airAuto = this.peerVal('CMB', 'AIR_AUTO', false);
    const furnAuto = this.peerVal('CMB', 'FURN_AUTO', false);
    const rbFan = this.peerVal('CMB', 'RB_FAN', false);
    const lvlAuto = this.peerVal('FWC', 'LVL_AUTO', false);
    const rbBfp = this.peerVal('FWC', 'RB_BFP', false);

    // ---------------------------------------------------------------- mode management
    const bfPerm = fmAuto && airAuto && furnAuto && !mft && gcb;
    const ccPerm = bfPerm && remReady && lvlAuto;
    const tfPerm = remReady && latched && !mft;
    this.set('CC_PERM', ccPerm);
    this.set('BF_PERM', bfPerm);
    this.set('TF_PERM', tfPerm);
    const req = this.get('MODE_REQ');
    let active = req;
    if (!this.inGrace()) {
      if (req === MODE.CC && !ccPerm) active = bfPerm ? MODE.BF : MODE.BASE;
      if (req === MODE.TF && !tfPerm) active = MODE.BASE;
      if (req === MODE.BF && !bfPerm) active = MODE.BASE;
    }
    if (active !== req) {
      // Degrade and make the request follow so the operator must re-select deliberately
      if (this.state.latch.prevActive === req) s.dropT = 15;
      this.set('MODE_REQ', active);
    }
    this.state.latch.prevActive = active;
    s.dropT = Math.max(0, s.dropT - dt);
    this.set('MODE_DROPPED', s.dropT > 0);
    this.set('MODE_ACT', active);

    // ---------------------------------------------------------------- capacity & runback
    let capacity = Math.min(this.get('MAX_LOAD'), elevIn * ELEV_MW);
    let rbRate = 0;
    if (rbFan || rbBfp) {
      capacity = Math.min(capacity, rbFan ? 350 : 385);
      rbRate = 350 / 60;
    }
    this.set('CAPACITY', capacity);

    // ---------------------------------------------------------------- unit load demand
    if (this.get('GO')) s.go = true;
    if (this.get('HOLD')) s.go = false;
    const pspActive = s.psp;
    const dev = pspActive - pms;
    this.set('PRESS_DEV', dev);
    const blockInc = active === MODE.CC && dev > 10;
    const blockDec = active === MODE.CC && dev < -10;
    this.set('BLOCK_INC', blockInc);
    this.set('BLOCK_DEC', blockDec);
    let rbActive = false;
    if (active === MODE.CC || active === MODE.TF) {
      const tgt = clamp(this.get('ULD_TARGET'), this.get('MIN_LOAD'), this.get('MAX_LOAD'));
      if (s.uld > capacity + 1) {
        rbActive = true;
        const r = (rbRate || 70 / 60) * dt;
        s.uld = Math.max(capacity, s.uld - r);
        this.set('ULD_TARGET', Math.round(Math.min(tgt, capacity)));
      } else if (s.go) {
        const r = (this.get('ULD_RATE') / 60) * dt;
        let d = clamp(Math.min(tgt, capacity) - s.uld, -r, r);
        if ((d > 0 && blockInc) || (d < 0 && blockDec)) d = 0;
        s.uld += d;
        if (Math.abs(Math.min(tgt, capacity) - s.uld) < 0.05) s.go = false;
      }
    } else {
      s.uld = Math.max(0, mw);
      s.go = false;
    }
    this.set('RB_ACTIVE', rbActive || ((rbFan || rbBfp) && gcb));
    this.set('RB_TARGET', capacity);
    this.set('RAMPING', s.go);
    this.set('ULD_ACT', s.uld);
    const df = p('GRID_FREQ') - 60;
    const dfDb = Math.abs(df) > 0.015 ? df - Math.sign(df) * 0.015 : 0;
    const fbias = this.get('FREQ_BIAS') && active === MODE.CC ? clamp((-dfDb / 60 / 0.05) * RATED, -70, 70) : 0;
    const uldF = s.uld + fbias;
    this.set('ULD_FREQ', uldF);

    // ---------------------------------------------------------------- pressure setpoint
    const loadForP = active === MODE.CC || active === MODE.TF ? s.uld : mw;
    const pTarget = this.get('PRESS_MODE') === 1 ? slidingPressure((loadForP / RATED) * 100) * 10 : this.get('PRESS_FIXED'); // bar
    const pr = (this.get('PRESS_RATE') / 60) * dt;
    if (active === MODE.BASE || this.resync) s.psp = active === MODE.BASE ? pms : s.psp;
    else s.psp += clamp(pTarget - s.psp, -pr, pr);
    this.set('PRESS_SP', s.psp);

    // ---------------------------------------------------------------- boiler master
    const bm = this.loops.PIC_TP;
    if (active === MODE.BF || active === MODE.CC) bm.setMode(PID_MODE.AUTO);
    bm.setSP(s.psp);
    let bmTrack = null;
    if (mft) bmTrack = 0;
    // Fuel master not in CAS: follow actual firing so its transfer to CAS is bumpless.
    else if (!fmAuto) bmTrack = (p('FUEL_HEAT') / 1620) * 100;
    else if (active === MODE.TF) bmTrack = (uldF / RATED) * 100 * 1.04;
    const ffLoad = active === MODE.CC ? uldF : mw;
    // Fast cut-back: on load rejection run the boiler back to what the HP/LP bypass can pass.
    if (this.fall('gcbFcb', gcb) && bm.out > 40 && !mft) {
      bm.setOut(35);
      bm.wasTracking = true;
      this.log.warn('Load rejection - boiler fast cut-back to 35 %');
    }
    const blr = bm.run({ pv: pms, ff: (ffLoad / RATED) * 100, forceMan: active === MODE.BASE || active === MODE.TF || mft, track: bmTrack });
    this.set('BLR_DMD', blr);

    // ---------------------------------------------------------------- peer outputs
    this.peerSet('CMB', 'BLR_DMD_REM', blr);
    this.peerSet('CMB', 'CCS_BM_AUTO', active === MODE.BF || active === MODE.CC ? 1 : 0);
    this.peerSet('DEH', 'LOAD_REF_REM', s.uld);
    this.peerSet('DEH', 'PRESS_SP_REM', s.psp);
    this.peerSet('DEH', 'CCS_REQ', active === MODE.CC ? 1 : active === MODE.TF ? 2 : 0);
    this.peerSet('STC', 'BLR_DMD_FF', blr);
  }

  onBuiltInIC(id) {
    const s = this.state;
    const mw = this.p('GEN_MW');
    s.uld = mw;
    s.psp = this.p('MS_PRESS');
    this.set('ULD_TARGET', Math.round(mw > 50 ? mw : 700));
    const onLoad = id >= 4;
    this.set('MODE_REQ', onLoad ? MODE.CC : MODE.BASE);
    this.state.latch.prevActive = onLoad ? MODE.CC : MODE.BASE;
    const bm = this.loops.PIC_TP;
    bm.setOut((this.p('FUEL_HEAT') / 1620) * 100);
    bm.setMode(onLoad ? PID_MODE.AUTO : PID_MODE.MAN);
  }
}
