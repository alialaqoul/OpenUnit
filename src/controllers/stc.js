import { Controller } from './runtime/Controller.js';
import { PID_MODE } from '../common/tags.js';
import { tsat } from '../common/steamTable.js';

const MCR_STEAM = 2149;

/** Main steam (cascade SH spray) and reheat (burner tilt + emergency spray) temperature control. */
export class StcController extends Controller {
  constructor() {
    super('STC');
    this.onoff('SPRAY_BLOCK', { cmd: 'SPRAY_BLOCK_CMD', opened: 'SPRAY_BLOCK_OPEN' });
    this.loop('TIC_MS', { action: 'reverse', spTrack: false });
    this.loop('TIC_DSH', { action: 'direct' });
    this.loop('TIC_RH', { action: 'reverse', spTrack: false });
    this.loop('TIC_RHS', { action: 'direct', spTrack: false });
  }

  logic() {
    const steamPct = (this.p('STEAM_FLOW') / MCR_STEAM) * 100;
    const mft = this.peerOk('BMS') ? this.peer('BMS', 'MFT') : true;
    const turbTrip = this.peerOk('DEH') ? this.peer('DEH', 'TRIPPED') : true;
    const prevPermit = !!this.state.latch.permit;
    const permit = !mft && (prevPermit ? steamPct > 15 : steamPct > 20);
    this.state.latch.permit = permit;
    this.set('SPRAY_PERMIT', permit);

    const block = this.devices.SPRAY_BLOCK;
    block.run({ autoOpen: permit, autoClose: !permit, ilkClose: mft });

    const pms = this.p('MS_PRESS') / 10 + 0.1013; // bar(g) -> MPa(a)
    const ts = tsat(pms);
    const dshMin = ts + 15;
    this.set('DSH_SP_MIN', dshMin);
    this.set('MS_SUPERHEAT', this.p('MS_TEMP') - ts);

    // Cascade: TIC_MS (master) -> TIC_DSH (slave) -> SH spray valve
    const dsh = this.loops.TIC_DSH;
    const ms = this.loops.TIC_MS;
    const sprayOk = permit && block.opened;
    const dshCas = dsh.get('MODE') === PID_MODE.CAS && sprayOk;
    const msOut = ms.run({
      pv: this.p('MS_TEMP'),
      outLo: dshMin,
      track: dshCas ? null : this.p('DSH_OUT_TEMP'),
    });
    const spray = dsh.run({ pv: this.p('DSH_OUT_TEMP'), csp: msOut, spLo: dshMin, track: sprayOk ? null : 0 });
    this.pset('SH_SPRAY_DMD', spray);

    // Reheat: burner tilt is the primary control, spray is a high-limit backstop
    const rh = this.loops.TIC_RH;
    const rhs = this.loops.TIC_RHS;
    const rhPermit = permit && !turbTrip;
    const tilt = rh.run({ pv: this.p('HRH_TEMP'), track: rhPermit ? null : 0 });
    this.pset('TILT_DMD', tilt);
    if (rhs.get('MODE') !== PID_MODE.MAN) rhs.setSP(rh.get('SP') + this.get('RHS_OFFSET'));
    this.pset('RH_SPRAY_DMD', rhs.run({ pv: this.p('HRH_TEMP'), track: rhPermit ? null : 0 }));
  }

  onBuiltInIC(id) {
    const L = this.loops;
    L.TIC_DSH.setOut(this.p('SH_SPRAY_FB'));
    L.TIC_MS.setOut(this.p('DSH_OUT_TEMP'));
    L.TIC_RH.setOut(this.p('TILT_FB'));
    L.TIC_RHS.setOut(this.p('RH_SPRAY_FB'));
    const auto = id >= 2;
    this.set('SPRAY_BLOCK.MODE', PID_MODE.AUTO);
    L.TIC_MS.setMode(auto ? PID_MODE.AUTO : PID_MODE.MAN);
    L.TIC_DSH.setMode(auto ? PID_MODE.CAS : PID_MODE.MAN);
    L.TIC_RH.setMode(auto ? PID_MODE.AUTO : PID_MODE.MAN);
    L.TIC_RHS.setMode(auto ? PID_MODE.AUTO : PID_MODE.MAN);
    this.state.latch.permit = (this.p('STEAM_FLOW') / MCR_STEAM) * 100 > 20;
  }
}
