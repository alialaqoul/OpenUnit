import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { stIdent } from '../common/tags.js';

/**
 * I/O image of an OpenPLC controller.
 *
 * A soft-PLC cannot be a Modbus client of the field I/O and of its peers the way the Node.js
 * controllers are, so the I/O bridge (src/openplc/bridge.js) plays the role of the I/O network:
 * it copies field inputs and peer data INTO the PLC's memory and copies its outputs OUT to the
 * field and to peers. The image is declared in the PLC's own register map so the HMI, the bridge
 * and the generated Structured Text all agree on the addresses:
 *
 *   I_<tag>         field input from the plant I/O                  (written by the bridge)
 *   P_<PEER>_<tag>  status read from a peer controller              (written by the bridge)
 *   IO_COMM_<node>  link + heartbeat health of the plant / a peer    (written by the bridge)
 *   IO_IC_*         initial-condition command                       (written by the bridge)
 *   Q_<tag>         field output owned by this controller           (read by the bridge)
 *   W_<PEER>_<tag>  value this controller writes into a peer         (read by the bridge)
 *
 * Only the signals the program uses are declared: the bridge finds them by scanning the
 * controller's Structured Text source (plc/src/<NODE>.st).
 */
export function plcSourceFile(plcDir, node) {
  return path.join(plcDir, 'src', `${node}.st`);
}

export function readPlcSource(plcDir, node) {
  const file = plcSourceFile(plcDir, node);
  if (!existsSync(file)) return '';
  // Drop comments so a mention in a comment does not create an I/O point.
  return readFileSync(file, 'utf8').replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/.*$/gm, ' ');
}

/**
 * Appends the I/O image to `map` (an openplc-layout TagMap of `node`).
 * maps: every node's map (base tags only, images not yet added).  peers: PEERS[node].
 */
export function addPlcImage(map, node, { maps, peers, source }) {
  const plant = maps.PLANT;
  const idents = new Set((source.toUpperCase().match(/\b[A-Z_][A-Z0-9_]*\b/g) || []).filter((s) => /^(I|P|Q|W)_/.test(s)));
  const byIdent = (m) => new Map([...m.tags.values()].map((t) => [stIdent(t.name), t]));
  const plantByIdent = byIdent(plant);
  const peerNames = [...new Set([...(peers?.read || []), ...(peers?.write || []), ...Object.keys(map.owners).filter((o) => o !== node && o !== 'IO')])];
  const peerByIdent = Object.fromEntries(peerNames.map((p) => [p, byIdent(maps[p])]));
  const image = { plantIn: [], peerIn: [], plantOut: [], peerOut: [], peers: peerNames, unknown: [] };

  const resolvePeer = (rest) => {
    for (const p of peerNames) if (rest.startsWith(`${p}_`)) return { peer: p, tag: peerByIdent[p].get(rest.slice(p.length + 1)) };
    return null;
  };
  const kind = (t) => ({ area: t.type === 'bool' ? 'di' : 'ir', type: t.type, units: t.units, dp: t.dp, enum: t.enum });

  map.section('IO', () => {
    map.di('IO_COMM_PLANT', 'Bridge: field I/O link healthy');
    for (const p of peerNames) map.di(`IO_COMM_${p}`, `Bridge: ${p} link and heartbeat healthy`);
    map.ir('IO_IC_SEQ', '', 'Bridge: initial-condition command sequence', { type: 'u16' });
    map.ir('IO_IC_ID', '', 'Bridge: initial condition number', { type: 'u16' });
    map.di('IO_IC_SNAP', 'Bridge: controller values restored from a snapshot');
    for (const id of [...idents].sort()) {
      if (id.startsWith('I_')) {
        const t = plantByIdent.get(id.slice(2));
        if (!t || !t.ro) {
          image.unknown.push(id);
          continue;
        }
        map.add(id, { ...kind(t), desc: `Field input: ${t.desc}` });
        image.plantIn.push({ tag: id, src: t.name });
      } else if (id.startsWith('P_')) {
        const r = resolvePeer(id.slice(2));
        if (!r?.tag || !r.tag.ro) {
          image.unknown.push(id);
          continue;
        }
        map.add(id, { ...kind(r.tag), desc: `From ${r.peer}: ${r.tag.desc}` });
        image.peerIn.push({ tag: id, peer: r.peer, src: r.tag.name });
      }
    }
  });
  map.ir('IC_ACK', '', 'Last initial-condition command acknowledged', { type: 'u16' });
  for (const id of [...idents].sort()) {
    if (id.startsWith('Q_')) {
      const t = plantByIdent.get(id.slice(2));
      if (!t || t.owner !== node) {
        image.unknown.push(id);
        continue;
      }
      map.add(id, { ...kind(t), area: t.type === 'bool' ? 'di' : 'ir', desc: `Field output: ${t.desc}` });
      image.plantOut.push({ tag: id, dst: t.name });
    } else if (id.startsWith('W_')) {
      const r = resolvePeer(id.slice(2));
      if (!r?.tag || r.tag.owner !== node) {
        image.unknown.push(id);
        continue;
      }
      map.add(id, { ...kind(r.tag), desc: `To ${r.peer}: ${r.tag.desc}` });
      image.peerOut.push({ tag: id, peer: r.peer, dst: r.tag.name });
    }
  }
  map.plcImage = image;
  return image;
}
