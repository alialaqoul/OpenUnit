import { S, val, onUpdate, esc } from '../core.js';
import { kv, indRow, pbtn, attachControls, panel } from '../ui.js';

const ELEVS = ['A', 'B', 'C', 'D'];

function html() {
  const causes = S.meta.get('BMS:MFT_CAUSE')?.enum || [];
  const tCauses = S.meta.get('DEH:TRIP_CAUSE')?.enum || [];
  const gCauses = S.meta.get('GEN:TRIP_CAUSE')?.enum || [];
  const list = (arr, id) => `<div id="${id}" style="font-family:var(--mono);font-size:11px;columns:2;column-gap:14px">${arr.map((c, i) => (i ? `<div data-i="${i}" style="padding:1px 4px">${i}. ${esc(c)}</div>` : '')).join('')}</div>`;
  const elevRows = ELEVS.map(
    (x) => `<tr>
      <td class="mono"><b>${x}</b></td>
      <td class="mono" data-v="BMS:ELEV_${x}.STATE">--</td>
      <td><span class="ind" data-on="BMS:ELEV_${x}.PERM"></span></td>
      <td><span class="ind warn" data-on="PLANT:IGN_${x}_FLAME"></span></td>
      <td><span class="ind" data-on="PLANT:BRN_${x}_OPEN"></span></td>
      <td><span class="ind" data-on="PLANT:FLAME_${x}"></span></td>
      <td class="r mono" data-v="PLANT:GAS_${x}_FLOW">--</td>
      <td>${pbtn('LIGHT', 'BMS', `ELEV_${x}.START`, { cls: 'ok small' })} ${pbtn('STOP', 'BMS', `ELEV_${x}.STOP`, { cls: 'small' })}</td>
    </tr>`,
  ).join('');
  return `<div class="cols" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="col">
    ${panel(
      'Master fuel trip',
      `<div id="mftbox" style="text-align:center;padding:10px;border-radius:4px;margin-bottom:8px;font-size:20px;font-weight:800;font-family:var(--mono)">--</div>
      <div class="kv">${kv('First-out', 'BMS:MFT_CAUSE')}${kv('Purge remaining', 'BMS:PURGE_REMAIN', { dp: 0 })}${kv('Light-off time left', 'BMS:LIGHTOFF_REMAIN', { dp: 0 })}${kv('Elevations in service', 'BMS:ELEV_INSERV')}</div>
      <div class="row" style="margin-top:8px">${pbtn('PURGE START', 'BMS', 'PURGE_START', { cls: 'primary' })}${pbtn('MFT RESET', 'BMS', 'MFT_RESET', { cls: 'ok' })}${pbtn('MANUAL MFT', 'BMS', 'MFT_PB', { cls: 'danger', confirm: true })}</div>
      <div class="row" style="margin-top:6px">${indRow('Purge ready', 'BMS:PURGE_READY')}${indRow('Purging', 'BMS:PURGE_ACTIVE', 'warn')}${indRow('Purge complete', 'BMS:PURGE_COMPLETE')}</div>`,
    )}
    ${panel(
      'Purge permissives',
      `${indRow('ID and FD fan running', 'BMS:PP_FANS')}${indRow('Air flow 25 - 40 %', 'BMS:PP_AIR')}${indRow('All gas valves closed, igniters off', 'BMS:PP_FUEL_OFF')}${indRow('Furnace pressure normal', 'BMS:PP_FURN')}${indRow('Drum level normal', 'BMS:PP_DRUM')}${indRow('No MFT condition present', 'BMS:PP_NO_TRIP')}
      <div class="kv" style="margin-top:8px">${kv('Air flow', 'PLANT:AIR_FLOW', { dp: 0 })}${kv('Furnace pressure', 'CMB:FURN_PRESS_SEL', { dp: 0 })}${kv('Drum level', 'FWC:DRUM_LVL_SEL', { dp: 0 })}</div>`,
    )}
    ${panel(
      'Gas fuel train',
      `<div class="kv">${kv('State', 'BMS:GAS_TRAIN.STATE')}${kv('Supply pressure', 'PLANT:GAS_SUPPLY_PRESS')}${kv('Header pressure', 'PLANT:GAS_HDR_PRESS')}${kv('Gas flow', 'PLANT:GAS_FLOW')}${kv('Control valve', 'PLANT:GFCV_FB')}</div>
      <div class="row" style="margin:8px 0">${pbtn('OPEN GAS TRAIN', 'BMS', 'GAS_TRAIN.OPEN', { cls: 'ok' })}${pbtn('CLOSE', 'BMS', 'GAS_TRAIN.CLOSE')}</div>
      ${indRow('Open permissive', 'BMS:GAS_TRAIN.PERM')}${indRow('SSV-1 / SSV-2 open', 'PLANT:MGTV_OPEN')}${indRow('SSV-1 / SSV-2 closed', 'PLANT:MGTV_CLOSED')}${indRow('Vent (bleed) open', 'PLANT:GAS_VENT_OPEN', 'warn')}`,
    )}
    </div><div class="col">${panel(
      'Burner elevations',
      `<table class="tbl"><tr><th>Elev</th><th>State</th><th>Perm</th><th>Igniter</th><th>Valves</th><th>Flame</th><th class="r">Gas t/h</th><th></th></tr>${elevRows}</table>
      <p style="color:var(--muted);font-size:11px;margin:8px 0 0">Light-off sequence: igniters energise &rarr; igniter flame proven (3 s) &rarr; burner gas valves open &rarr; main flame proven within 15 s &rarr; IN SERVICE &rarr; igniters off after 10 s. Loss of flame for 2 s trips the elevation; loss of all flame or fuel trips the boiler (MFT).</p>`,
    )}
    ${panel('MFT first-out causes', list(causes, 'mftlist'))}
    </div><div class="col">${panel(
      'Turbine protection (DEH)',
      `<div class="kv">${kv('Status', 'DEH:MODE')}${kv('Trip first-out', 'DEH:TRIP_CAUSE')}${kv('Speed', 'DEH:SPEED', { dp: 0 })}${kv('Max vibration', 'DEH:MAX_VIB', { dp: 0 })}${kv('Condenser pressure', 'PLANT:COND_PRESS')}${kv('Lube oil pressure', 'PLANT:LO_PRESS')}</div>
      <div class="row" style="margin:8px 0">${pbtn('RESET / LATCH', 'DEH', 'RESET', { cls: 'ok' })}${pbtn('TURBINE TRIP', 'DEH', 'TRIP_PB', { cls: 'danger', confirm: true })}</div>
      ${indRow('Latch permissive', 'DEH:LATCH_PERM')}${indRow('Turbine tripped', 'DEH:TRIPPED', 'bad')}${indRow('OPC active', 'DEH:OPC_ACTIVE', 'bad')}${list(tCauses, 'tlist')}`,
    )}
    ${panel(
      'Generator protection',
      `<div class="kv">${kv('Lockout 86G', 'GEN:LOCKOUT_86')}${kv('Trip first-out', 'GEN:TRIP_CAUSE')}${kv('Gross MW', 'PLANT:GEN_MW')}${kv('Load angle', 'PLANT:LOAD_ANGLE')}</div>
      <div class="row" style="margin:8px 0">${pbtn('RESET 86G', 'GEN', 'RESET_86', { cls: 'ok' })}${pbtn('TRIP 86G', 'GEN', 'TRIP_86', { cls: 'danger', confirm: true })}</div>
      ${indRow('Reverse power', 'GEN:REV_POWER', 'warn')}${indRow('Pole slipping', 'PLANT:OUT_OF_STEP', 'bad')}${indRow('Differential relay', 'PLANT:GEN_DIFF_RELAY', 'bad')}${list(gCauses, 'glist')}`,
    )}
  </div></div>`;
}

export default {
  id: 'bms',
  title: 'BMS & Protection',
  render(root) {
    root.innerHTML = html();
    const off1 = attachControls(root);
    const refresh = () => {
      const mft = !!val('BMS:MFT');
      const box = root.querySelector('#mftbox');
      box.textContent = mft ? 'MFT ACTIVE' : 'MFT RESET - FIRING PERMITTED';
      box.style.background = mft ? '#5a1416' : '#17402a';
      box.style.color = mft ? '#ffb0b2' : '#8ff0ae';
      const mark = (id, k, active) => {
        const c = val(k) ?? 0;
        root.querySelectorAll(`#${id} [data-i]`).forEach((d) => {
          const on = active && Number(d.dataset.i) === c;
          d.style.background = on ? '#5a1416' : '';
          d.style.color = on ? '#ffd0d1' : '';
        });
      };
      mark('mftlist', 'BMS:MFT_CAUSE', mft);
      mark('tlist', 'DEH:TRIP_CAUSE', !!val('DEH:TRIPPED'));
      mark('glist', 'GEN:TRIP_CAUSE', !!val('GEN:LOCKOUT_86'));
    };
    refresh();
    const off2 = onUpdate(refresh);
    return {
      dispose() {
        off1();
        off2();
      },
    };
  },
};
