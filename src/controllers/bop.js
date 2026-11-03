import { Controller } from './runtime/Controller.js';
import { PID_MODE } from '../common/tags.js';
import { median3 } from '../common/blocks.js';

/** Balance of plant: CW, vacuum, condensate pumps, lube oil / turning gear, hotwell level. */
export class BopController extends Controller {
  constructor() {
    super('BOP');
    for (const m of ['CWP_A', 'CWP_B', 'VP_A', 'VP_B', 'CEP_A', 'CEP_B', 'AOP', 'EOP', 'JOP', 'TG']) this.motor(m);
    this.onoff('GLAND', { cmd: 'GLAND_CMD', opened: 'GLAND_ON' });
    this.onoff('VB', { cmd: 'VB_CMD', opened: 'VB_OPEN' });
    this.onoff('HW_DUMP', { cmd: 'HW_DUMP_CMD', opened: 'HW_DUMP_OPEN' });
    this.loop('LIC_HW', { action: 'reverse' });
  }

  speed() {
    return median3(this.p('SPEED_A'), this.p('SPEED_B'), this.p('SPEED_C'));
  }

  logic() {
    const d = this.devices;
    const n = this.speed();
    const cond = this.p('COND_PRESS');
    const lo = this.p('LO_PRESS');
    const hw = this.p('HW_LVL');
    // Standby pumps start on the latched trip of the duty pump (cleared only by operator reset).
    const tripped = (m) => this.p(`${m}_TRIP`) || !!this.state.dev[m]?.trip;

    // Circulating water: standby pump starts when the duty pump trips
    d.CWP_A.run({ autoStart: tripped('CWP_B') });
    d.CWP_B.run({ autoStart: tripped('CWP_A') });

    // Vacuum pumps: standby starts on partner trip or poor vacuum
    const vacPoor = cond > 150 && this.p('GLAND_ON');
    d.VP_A.run({ autoStart: tripped('VP_B') || (vacPoor && this.p('VP_B_RUN')) });
    d.VP_B.run({ autoStart: tripped('VP_A') || (vacPoor && this.p('VP_A_RUN')) });

    // Condensate pumps
    const cepPermit = hw > 300;
    const cepLowP = this.ton('cepLowP', this.p('CEP_PRESS') < 12 && (this.p('CEP_A_RUN') || this.p('CEP_B_RUN')), 5);
    d.CEP_A.run({ permit: cepPermit, autoStart: tripped('CEP_B') || (cepLowP && this.p('CEP_B_RUN')) });
    d.CEP_B.run({ permit: cepPermit, autoStart: tripped('CEP_A') || (cepLowP && this.p('CEP_A_RUN')) });

    // Lube oil, jacking oil, turning gear
    d.AOP.run({ autoStart: lo < 1.0 });
    d.EOP.run({ autoStart: lo < 0.7 });
    d.JOP.run({ autoStart: n < 600 && lo > 0.5, autoStop: n > 700 });
    const tgPermit = n < 5 && this.p('JOP_RUN') && lo > 1.0;
    d.TG.run({ permit: tgPermit || this.p('TG_RUN'), autoStart: tgPermit, ilk: lo < 0.5 });

    // Gland steam, vacuum breaker, hotwell dump
    d.GLAND.run({});
    const dehTripped = this.peerOk('DEH') ? this.peer('DEH', 'TRIPPED') : true;
    d.VB.run({ permit: dehTripped && n < 2400 });
    d.HW_DUMP.run({ autoOpen: hw > 1100, autoClose: hw < 900 });

    // Hotwell level via condenser make-up
    const makeup = this.loops.LIC_HW.run({ pv: hw });
    this.pset('MAKEUP_DMD', makeup);

    this.set('VAC_OK', cond < 200);
    this.set('CW_OK', this.p('CWP_A_RUN') || this.p('CWP_B_RUN'));
    this.set('LO_OK', lo > 1.0);
    this.set('COND_PRESS', cond);
  }

  onBuiltInIC(id) {
    for (const m of ['CWP_A', 'CWP_B', 'VP_A', 'VP_B', 'CEP_A', 'CEP_B', 'AOP', 'EOP', 'JOP', 'TG']) this.set(`${m}.MODE`, PID_MODE.AUTO);
    this.set('HW_DUMP.MODE', PID_MODE.AUTO);
    const lic = this.loops.LIC_HW;
    lic.setOut(this.p('MAKEUP_FB'));
    lic.setMode(id >= 2 ? PID_MODE.AUTO : PID_MODE.MAN);
  }
}
