(* CCS - Unit Coordinated Control
   Unit control modes BASE / BOILER FOLLOW / TURBINE FOLLOW / COORDINATED with permissives
   (a mode whose permissive drops degrades automatically), unit load demand with ramp rate,
   GO / HOLD, frequency bias, capMw limit from the burner elevations in service and fan /
   BFP runbacks, sliding or fixed throttle pressure setpoint, boiler master (PIC_TP) with
   load feed-forward and fast cut-back on load rejection.
   Naming: I_* field inputs, P_<PEER>_* peer status, W_<PEER>_* values written into peers
   (CMB boiler demand, DEH load / pressure references, STC feed-forward), IO_* bridge signals. *)
PROGRAM CCS_MAIN
(*@IO*)
  VAR
    RT : FB_PLC_RUNTIME;
    PIC_TP : FB_LOOP;
    dts : REAL;
    init : BOOL;
    mw : REAL;
    pms : REAL;
    gcb : BOOL;
    gcbPrev : BOOL;
    gcbOpened : BOOL;
    mft : BOOL;
    elevIn : DINT;
    remReady : BOOL;
    latched : BOOL;
    fmAuto : BOOL;
    airAuto : BOOL;
    furnAuto : BOOL;
    rbFan : BOOL;
    lvlAuto : BOOL;
    rbBfp : BOOL;
    bfPerm : BOOL;
    ccPerm : BOOL;
    tfPerm : BOOL;
    req : DINT;
    active : DINT;
    prevActive : DINT;
    dropT : REAL;
    capMw : REAL;
    rbRate : REAL;
    goLatch : BOOL;
    uld : REAL;
    psp : REAL;
    dev : REAL;
    blockInc : BOOL;
    blockDec : BOOL;
    rbActive : BOOL;
    tgt : REAL;
    lim : REAL;
    stepR : REAL;
    d : REAL;
    df : REAL;
    dfDb : REAL;
    fbias : REAL;
    uldF : REAL;
    loadForP : REAL;
    loadPct : REAL;
    pTarget : REAL;
    pr : REAL;
    bmTrk : BOOL;
    bmTrkVal : REAL;
    ffLoad : REAL;
    cutBack : BOOL;
  END_VAR
  VAR CONSTANT
    RATED : REAL := 700.0;        (* MW *)
    ELEV_MW : REAL := 210.0;      (* unit capability per burner elevation in service *)
    M_BASE : DINT := 0;
    M_BF : DINT := 1;
    M_TF : DINT := 2;
    M_CC : DINT := 3;
  END_VAR

  (* ---------------------------------------------------------------- runtime services *)
  RT(SIM_MS := I_SIM_TIME_MS, IC_SEQ := IO_IC_SEQ, IC_ID := IO_IC_ID, IC_SNAP := IO_IC_SNAP, CYCLE_MS := 50.0,
     HEARTBEAT := HEARTBEAT, SCAN_COUNT := SCAN_COUNT, SCAN_MS := SCAN_MS, SIM_DT := SIM_DT,
     IC_APPLIED := IC_APPLIED, IC_ACK := IC_ACK);
  dts := RT.DTS;
  init := RT.IC_INIT;
  HEALTHY := IO_COMM_PLANT AND RT.READY;
  COMM_PLANT := IO_COMM_PLANT OR NOT RT.READY;   (* not reported before the bridge has initialised the PLC *)
  COMM_DEH := IO_COMM_DEH OR RT.GRACE OR NOT RT.READY;
  COMM_CMB := IO_COMM_CMB OR RT.GRACE OR NOT RT.READY;
  COMM_FWC := IO_COMM_FWC OR RT.GRACE OR NOT RT.READY;
  COMM_BMS := IO_COMM_BMS OR RT.GRACE OR NOT RT.READY;
  COMM_STC := IO_COMM_STC OR RT.GRACE OR NOT RT.READY;

  mw := I_GEN_MW;
  pms := I_MS_PRESS;
  gcb := I_GCB_CLOSED;
  IF init THEN
    uld := mw;
    psp := pms;
    goLatch := FALSE;
    dropT := 0.0;
    gcbPrev := FALSE;
    prevActive := MODE_REQ;
  END_IF;

  (* ---------------------------------------------------------------- built-in initial condition *)
  IF RT.IC_BUILTIN THEN
    IF mw > 50.0 THEN ULD_TARGET := mw; ELSE ULD_TARGET := 700.0; END_IF;
    IF IO_IC_ID >= 4 THEN MODE_REQ := M_CC; PIC_TP_MODE := 1; ELSE MODE_REQ := M_BASE; PIC_TP_MODE := 0; END_IF;
    prevActive := MODE_REQ;
    PIC_TP_OUT := I_FUEL_HEAT / 1620.0 * 100.0;
  END_IF;

  IF RT.READY THEN
    (* peer status: the I/O bridge keeps the last good values while a peer is unreachable *)
    mft := P_BMS_MFT;
    elevIn := P_BMS_ELEV_INSERV;
    remReady := P_DEH_REM_READY;
    latched := P_DEH_LATCHED;
    fmAuto := P_CMB_FM_AUTO;
    airAuto := P_CMB_AIR_AUTO;
    furnAuto := P_CMB_FURN_AUTO;
    rbFan := P_CMB_RB_FAN;
    lvlAuto := P_FWC_LVL_AUTO;
    rbBfp := P_FWC_RB_BFP;

    (* ---------------------------------------------------------------- mode management *)
    bfPerm := fmAuto AND airAuto AND furnAuto AND NOT mft AND gcb;
    ccPerm := bfPerm AND remReady AND lvlAuto;
    tfPerm := remReady AND latched AND NOT mft;
    CC_PERM := ccPerm;
    BF_PERM := bfPerm;
    TF_PERM := tfPerm;
    req := MODE_REQ;
    active := req;
    IF NOT RT.GRACE THEN
      IF req = M_CC AND NOT ccPerm THEN
        IF bfPerm THEN active := M_BF; ELSE active := M_BASE; END_IF;
      END_IF;
      IF req = M_TF AND NOT tfPerm THEN active := M_BASE; END_IF;
      IF req = M_BF AND NOT bfPerm THEN active := M_BASE; END_IF;
    END_IF;
    IF active <> req THEN
      (* degrade and make the request follow, so the operator must re-select deliberately *)
      IF prevActive = req THEN dropT := 15.0; END_IF;
      MODE_REQ := active;
    END_IF;
    prevActive := active;
    dropT := MAX(0.0, dropT - dts);
    MODE_DROPPED := dropT > 0.0;
    MODE_ACT := active;

    (* ---------------------------------------------------------------- capMw & runback *)
    capMw := MIN(MAX_LOAD, DINT_TO_REAL(elevIn) * ELEV_MW);
    rbRate := 0.0;
    IF rbFan OR rbBfp THEN
      IF rbFan THEN capMw := MIN(capMw, 350.0); ELSE capMw := MIN(capMw, 385.0); END_IF;
      rbRate := 350.0 / 60.0;
    END_IF;
    CAPACITY := capMw;

    (* ---------------------------------------------------------------- unit load demand *)
    IF GO THEN goLatch := TRUE; END_IF;
    IF HOLD THEN goLatch := FALSE; END_IF;
    dev := psp - pms;
    PRESS_DEV := dev;
    blockInc := active = M_CC AND dev > 10.0;
    blockDec := active = M_CC AND dev < -10.0;
    BLOCK_INC := blockInc;
    BLOCK_DEC := blockDec;
    rbActive := FALSE;
    IF active = M_CC OR active = M_TF THEN
      tgt := LIMIT(MIN_LOAD, ULD_TARGET, MAX_LOAD);
      lim := MIN(tgt, capMw);
      IF uld > capMw + 1.0 THEN
        rbActive := TRUE;
        IF rbRate > 0.0 THEN stepR := rbRate * dts; ELSE stepR := 70.0 / 60.0 * dts; END_IF;
        uld := MAX(capMw, uld - stepR);
        ULD_TARGET := lim;
      ELSIF goLatch THEN
        stepR := ULD_RATE / 60.0 * dts;
        d := LIMIT(-stepR, lim - uld, stepR);
        IF (d > 0.0 AND blockInc) OR (d < 0.0 AND blockDec) THEN d := 0.0; END_IF;
        uld := uld + d;
        IF ABS(lim - uld) < 0.05 THEN goLatch := FALSE; END_IF;
      END_IF;
    ELSE
      uld := MAX(0.0, mw);
      goLatch := FALSE;
    END_IF;
    RB_ACTIVE := rbActive OR ((rbFan OR rbBfp) AND gcb);
    RB_TARGET := capMw;
    RAMPING := goLatch;
    ULD_ACT := uld;
    (* primary frequency response, 5 % droop with 15 mHz deadband, +/- 70 MW *)
    df := I_GRID_FREQ - 60.0;
    dfDb := 0.0;
    IF df > 0.015 THEN dfDb := df - 0.015; ELSIF df < -0.015 THEN dfDb := df + 0.015; END_IF;
    fbias := 0.0;
    IF FREQ_BIAS <> 0 AND active = M_CC THEN
      fbias := LIMIT(-70.0, -dfDb / 60.0 / 0.05 * RATED, 70.0);
    END_IF;
    uldF := uld + fbias;
    ULD_FREQ := uldF;

    (* ---------------------------------------------------------------- pressure setpoint *)
    IF active = M_CC OR active = M_TF THEN loadForP := uld; ELSE loadForP := mw; END_IF;
    IF PRESS_MODE = 1 THEN
      (* sliding pressure: 90 bar below 30 % load, 167 bar above 90 %, linear between *)
      loadPct := loadForP / RATED * 100.0;
      IF loadPct <= 30.0 THEN
        pTarget := 90.0;
      ELSIF loadPct >= 90.0 THEN
        pTarget := 167.0;
      ELSE
        pTarget := 90.0 + (loadPct - 30.0) / 60.0 * 77.0;
      END_IF;
    ELSE
      pTarget := PRESS_FIXED;
    END_IF;
    pr := PRESS_RATE / 60.0 * dts;
    IF active = M_BASE THEN
      psp := pms;
    ELSIF NOT RT.RESYNC THEN
      psp := psp + LIMIT(-pr, pTarget - psp, pr);
    END_IF;
    PRESS_SP := psp;

    (* ---------------------------------------------------------------- boiler master *)
    IF active = M_BF OR active = M_CC THEN PIC_TP_MODE := 1; END_IF;
    PIC_TP_SP := psp;
    bmTrk := FALSE;
    bmTrkVal := 0.0;
    IF mft THEN
      bmTrk := TRUE;
      bmTrkVal := 0.0;
    ELSIF NOT fmAuto THEN
      (* fuel master not in CAS: follow the actual firing so its transfer to CAS is bumpless *)
      bmTrk := TRUE;
      bmTrkVal := I_FUEL_HEAT / 1620.0 * 100.0;
    ELSIF active = M_TF THEN
      bmTrk := TRUE;
      bmTrkVal := uldF / RATED * 100.0 * 1.04;
    END_IF;
    IF active = M_CC THEN ffLoad := uldF; ELSE ffLoad := mw; END_IF;
    (* fast cut-back: on load rejection run the boiler back to what the HP / LP bypass can pass *)
    gcbOpened := NOT gcb AND gcbPrev;
    gcbPrev := gcb;
    cutBack := gcbOpened AND PIC_TP.Q > 40.0 AND NOT mft;
    IF cutBack THEN PIC_TP_OUT := 35.0; END_IF;
    PIC_TP(PV_IN := pms, FF := ffLoad / RATED * 100.0, FORCE_MAN := active = M_BASE OR active = M_TF OR mft,
           TRK := bmTrk, TRK_VAL := bmTrkVal,
           DTS := dts, RESYNC := RT.RESYNC OR cutBack, PV_MIN := 0.0, PV_MAX := 200.0, OUT_MIN := 0.0, OUT_MAX := 110.0, SP_TRACK := FALSE,
           SP := PIC_TP_SP, OUT := PIC_TP_OUT, MODE := PIC_TP_MODE, KP := PIC_TP_KP, TI := PIC_TP_TI, TD := PIC_TP_TD,
           PV := PIC_TP_PV, CSP := PIC_TP_CSP, STS := PIC_TP_STS);
    BLR_DMD := PIC_TP.Q;

    (* ---------------------------------------------------------------- peer outputs *)
    W_CMB_BLR_DMD_REM := PIC_TP.Q;
    IF active = M_BF OR active = M_CC THEN W_CMB_CCS_BM_AUTO := 1; ELSE W_CMB_CCS_BM_AUTO := 0; END_IF;
    W_DEH_LOAD_REF_REM := uld;
    W_DEH_PRESS_SP_REM := psp;
    IF active = M_CC THEN W_DEH_CCS_REQ := 1; ELSIF active = M_TF THEN W_DEH_CCS_REQ := 2; ELSE W_DEH_CCS_REQ := 0; END_IF;
    W_STC_BLR_DMD_FF := PIC_TP.Q;
  END_IF;

  GO := FALSE;
  HOLD := FALSE;
END_PROGRAM
