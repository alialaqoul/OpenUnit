/**
 * Pumps (water systems). Flows in GPM / kPPH, pressures in psia,
 * temperatures in F, heads in ft, power in HP / kW, speed in rpm.
 *
 * Pump configuration design data (nv): speed, suctionID, dischID [in], suctLeg, dischLeg
 * [ft], motorEff [%], motorPF, motorVolt [V]; pump curve at rated speed: shutoffHead, ratedFlow,
 * ratedHead [ft], bepFlow, bepEff [%] (pump curve forms).
 */
import { StmSpVol, StmPT, StmTP } from './steamus.js';
import { HP_PER_KW } from './units.js';

const CUFTHR_TO_GPM = 0.124675;
const GPM_TO_CUFTSEC = 0.002228;
const LBFFTSEC_TO_HP = 0.00181818;
const G = 32.2;

/** Liquid specific volume [ft3/lbm]; saturated liquid at P when T is above saturation, or at T when P is unknown. */
function liqVol(P, T) {
  if (!P) return StmSpVol(StmTP(T) + 0.1, T - 0.01);
  const ts = StmPT(P);
  const v = StmSpVol(P, Math.min(T, ts - 0.01));
  return Number.isFinite(v) && v > 0 ? v : 0.017;
}

/** Water mass flow [kPPH] to volumetric flow [GPM]. */
export const waterVolFlow = (P, T, kpph) => 1000 * kpph * liqVol(P, T) * CUFTHR_TO_GPM;
/** Volumetric flow [GPM] to mass flow [kPPH]. */
export const waterMassFlow = (P, T, gpm) => gpm / (1000 * liqVol(P, T) * CUFTHR_TO_GPM);
/** Capacity at rated speed [GPM]. */
export const capacityAtRated = (nv, speed, gpm) => gpm * (nv.speed / speed);
/** Head at rated speed [ft]. */
export const headAtRated = (nv, speed, head) => head * (nv.speed / speed) ** 2;
/** Design capacity at actual speed [GPM]. */
export const capacityAtSpeed = (nv, speed, gpm) => gpm * (speed / nv.speed);
/** Design head at actual speed [ft]. */
export const headAtSpeed = (nv, speed, head) => head * (speed / nv.speed) ** 2;

const velHead = (gpm, idIn) => {
  const area = Math.PI * (idIn / 24) ** 2;
  const vel = (gpm * GPM_TO_CUFTSEC) / area;
  return (vel * vel) / (2 * G);
};
/** Suction gauge head [ft]. */
export const suctionHead = (nv, Ps, Ts, gpm, Pbar = 14.696) => 144 * liqVol(Ps, Ts) * (Ps - Pbar) + (nv.suctLeg ?? 0) + velHead(gpm, nv.suctionID);
/** Discharge gauge head [ft]. */
export const dischargeHead = (nv, Pd, Td, gpm, Pbar = 14.696) => 144 * liqVol(Pd, Td) * (Pd - Pbar) + (nv.dischLeg ?? 0) + velHead(gpm, nv.dischID);
/** Total head [ft]. */
export const totalHead = (nv, Ps, Ts, Pd, Td, gpm, Pbar = 14.696) => dischargeHead(nv, Pd, Td, gpm, Pbar) - suctionHead(nv, Ps, Ts, gpm, Pbar);
/** Net positive suction head available [ft]. */
export const npsh = (nv, Ps, Ts, gpm) => 144 * liqVol(Ps, Ts) * (Ps - StmTP(Ts)) + (nv.suctLeg ?? 0) + velHead(gpm, nv.suctionID);
/** Pump power output [whp]. */
export function powerOutput(nv, Ps, Ts, Pd, Td, gpm, Pbar = 14.696) {
  const rho = 1 / ((liqVol(Ps, Ts) + liqVol(Pd, Td)) / 2);
  return gpm * GPM_TO_CUFTSEC * totalHead(nv, Ps, Ts, Pd, Td, gpm, Pbar) * rho * LBFFTSEC_TO_HP;
}
/** Pump power input [HP] from motor power [kW]. */
export const powerInputKw = (nv, kw) => (kw * HP_PER_KW * nv.motorEff) / 100;
/** Motor power [kW] from current [A], and power input [HP]. */
export const motorKwFromAmps = (nv, amps) => (amps * nv.motorPF * nv.motorVolt * Math.sqrt(3)) / 1000;
export const powerInputAmps = (nv, amps) => powerInputKw(nv, motorKwFromAmps(nv, amps));
/** Pump specific speed. */
export const specificSpeed = (nv, Ps, Ts, Pd, Td, gpm, speed, Pbar = 14.696) => (speed * Math.sqrt(gpm)) / totalHead(nv, Ps, Ts, Pd, Td, gpm, Pbar) ** 0.75;
/** Suction specific speed, single / double suction. */
export const suctionSpecificSpeed = (speed, gpm, npshr, double = false) => (speed * Math.sqrt(double ? gpm / 2 : gpm)) / npshr ** 0.75;
/** Pump efficiency [%] from motor power [kW]. */
export const pumpEfficiency = (nv, kw, Ps, Ts, Pd, Td, gpm, Pbar = 14.696) => {
  const pin = powerInputKw(nv, kw);
  return pin > 0 ? (powerOutput(nv, Ps, Ts, Pd, Td, gpm, Pbar) / pin) * 100 : 0;
};
/** Pump efficiency [%] from motor current [A]. */
export const pumpEfficiencyAmps = (nv, amps, Ps, Ts, Pd, Td, gpm, Pbar = 14.696) => pumpEfficiency(nv, motorKwFromAmps(nv, amps), Ps, Ts, Pd, Td, gpm, Pbar);

/**
 * Pump curve at a speed (affinity laws applied to the rated speed curve):
 * head = H0 (n/n0)^2 - k Q^2, efficiency a parabola through the best efficiency point.
 */
export function curveHead(nv, gpm, speed = nv.speed) {
  const r = speed / nv.speed;
  const k = (nv.shutoffHead - nv.ratedHead) / nv.ratedFlow ** 2;
  return nv.shutoffHead * r * r - k * gpm * gpm;
}
export function curveEfficiency(nv, gpm, speed = nv.speed) {
  const q = capacityAtRated(nv, Math.max(1, speed), gpm) / nv.bepFlow;
  return Math.max(5, nv.bepEff * (1 - (q - 1) ** 2) * (q > 0 ? 1 : 0)) * (gpm > 0 ? 1 : 0);
}
/** Hydraulic power [whp] for a flow [GPM], head [ft] and density [lbm/ft3]. */
export const hydraulicHp = (gpm, head, rho) => gpm * GPM_TO_CUFTSEC * head * rho * LBFFTSEC_TO_HP;
