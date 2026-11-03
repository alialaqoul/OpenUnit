(* DEH - Turbine Control & Protection (digital electro-hydraulic governor)
   Turbine protection with first-out and latch (reset) permissives; operating modes SPEED
   (run-up through the critical speed bands, synchroniser trim from GEN), LOAD (local load
   reference with frequency droop), REMOTE (load reference from CCS) and PRESSURE (turbine
   follow, throttle pressure from CCS); valve position and throttle pressure limiters; OPC
   (overspeed protection controller) on load rejection; turbine stress evaluator (TSE) limits
   the ramp rates; HP / LP bypass FIXED / FOLLOW pressure control; SH start-up vent.
   Naming: I_* field inputs, Q_* field outputs, P_<PEER>_* peer status, IO_* bridge signals.
   LOAD_REF_REM / PRESS_SP_REM / CCS_REQ are written into this PLC by CCS, SYNC_ADJ /
   SYNC_ACTIVE by GEN. *)
PROGRAM DEH_MAIN
(*@IO*)
  VAR
    RT : FB_PLC_RUNTIME;
    SPD_CTRL : FB_LOOP;
    LOAD_CTRL : FB_LOOP;
    PIC_TPT : FB_LOOP;
    PIC_HPB : FB_LOOP;
    PIC_LPB : FB_LOOP;
    SH_VENT : FB_ONOFF;
    T_VIBHH : FB_TONS;
    T_HPXHH : FB_TONS;
    T_HPBCLOSED : FB_TONS;
    dts : REAL;
    init : BOOL;
    n : REAL;
    gcb : BOOL;
    mw : REAL;
    pms : REAL;
    vib : REAL;
    brg : REAL;
    nOver : INT;
    c : ARRAY[1..12] OF BOOL;   (* trip conditions, by first-out cause number *)
    firstOut : DINT;
    tripActive : BOOL;
    latchPerm : BOOL;
    latch : BOOL;              (* turbine latched (reset) *)
    latchPrev : BOOL;
    latchFell : BOOL;
    spdResync : BOOL;
    cause : DINT;
    req : DINT;
    remoteSel : BOOL;
    dehMode : DINT;            (* 0 TRIPPED, 1 SPEED, 2 LOAD, 3 REMOTE, 4 PRESSURE *)
    gcbPrev : BOOL;
    gcbRose : BOOL;
    gcbFell : BOOL;
    lastMw : REAL;
    opcT : REAL;
    opcLatch : BOOL;
    opc : BOOL;
    hpMetal : REAL;
    flowing : BOOL;
    stressHp : REAL;
    stressIp : REAL;
    stressFactor : REAL;
    spdGo : BOOL;
    loadGo : BOOL;
    spdRef : REAL;
    loadRef : REAL;
    target : REAL;
    rate : REAL;
    banded : BOOL;
    df : REAL;
    dfDb : REAL;
    droopPu : REAL;
    fcorr : REAL;
    tgt : REAL;
    r : REAL;
    tpl : BOOL;
    gvHi : REAL;
    pFilt : REAL;
    gv : REAL;
    spLoad : REAL;
    ffGv : REAL;
    lpbIlk : BOOL;
    follow : BOOL;
    hpbSp : REAL;
    lpbSp : REAL;
    fired : BOOL;
    pd : REAL;
  END_VAR
  VAR CONSTANT
    RPM : REAL := 3600.0;      (* 2-pole generator on a 60 Hz grid *)
    M_TRIPPED : DINT := 0;
    M_SPEED : DINT := 1;
    M_LOAD : DINT := 2;
    M_REMOTE : DINT := 3;
    M_PRESSURE : DINT := 4;
  END_VAR

  (* ---------------------------------------------------------------- runtime services *)
  RT(SIM_MS := I_SIM_TIME_MS, IC_SEQ := IO_IC_SEQ, IC_ID := IO_IC_ID, IC_SNAP := IO_IC_SNAP, CYCLE_MS := 50.0,
     HEARTBEAT := HEARTBEAT, SCAN_COUNT := SCAN_COUNT, SCAN_MS := SCAN_MS, SIM_DT := SIM_DT,
     IC_APPLIED := IC_APPLIED, IC_ACK := IC_ACK);
  dts := RT.DTS;
  init := RT.IC_INIT;
  HEALTHY := IO_COMM_PLANT AND RT.READY;
  COMM_PLANT := IO_COMM_PLANT OR NOT RT.READY;   (* not reported before the bridge has initialised the PLC *)
  COMM_BMS := IO_COMM_BMS OR RT.GRACE OR NOT RT.READY;
  COMM_GEN := IO_COMM_GEN OR RT.GRACE OR NOT RT.READY;
  COMM_CCS := IO_COMM_CCS OR RT.GRACE OR NOT RT.READY;

  n := MEDIAN3(I_SPEED_A, I_SPEED_B, I_SPEED_C);
  gcb := I_GCB_CLOSED;
  mw := I_GEN_MW;
  pms := I_MS_PRESS;

  (* ---------------------------------------------------------------- built-in initial condition *)
  IF RT.IC_BUILTIN THEN
    SH_VENT_MODE := 1;
    SPD_CTRL_MODE := 1; SPD_CTRL_OUT := I_GV_POS;
    LOAD_CTRL_MODE := 1; LOAD_CTRL_OUT := I_GV_POS;
    PIC_TPT_MODE := 1; PIC_TPT_OUT := I_GV_POS;
    PIC_HPB_OUT := I_HPB_POS;
    PIC_LPB_OUT := I_LPB_POS;
    HPB_TARGET := pms;
    IF IO_IC_ID >= 2 THEN PIC_HPB_MODE := 1; PIC_LPB_MODE := 1; ELSE PIC_HPB_MODE := 0; PIC_LPB_MODE := 0; END_IF;
    IF I_MSV_OPEN THEN
      SPD_TARGET := n;
      LOAD_TARGET := mw;
      IF gcb THEN
        MODE_SEL := 1;
        HPB_MODE := 1;
      END_IF;
    END_IF;
  END_IF;

  (* ---------------------------------------------------------------- initial condition: state from the plant *)
  IF init THEN
    latch := I_MSV_OPEN;
    IF latch THEN
      cause := 0;
    ELSIF IO_IC_ID = 1 THEN
      cause := 13;   (* power-up *)
    ELSE
      cause := 0;
    END_IF;
    spdRef := n;
    loadRef := mw;
    spdGo := FALSE;
    loadGo := FALSE;
    opcT := 0.0;
    opcLatch := FALSE;
    IF HPB_MODE = 1 THEN
      hpbSp := pms + 10.0;
      lpbSp := I_HRH_PRESS + 3.0;
    ELSE
      hpbSp := pms;
      lpbSp := MAX(9.0, I_HRH_PRESS);
    END_IF;
    gcbPrev := gcb;
    latchPrev := latch;
    lastMw := mw;
    pFilt := pms;
    gv := I_GV_POS;
  END_IF;

  IF RT.READY THEN
    SPEED := n;

    (* ---------------------------------------------------------------- protection *)
    vib := MAX(MAX(MAX(I_VIB_1, I_VIB_2), MAX(I_VIB_3, I_VIB_4)), MAX(I_VIB_5, I_VIB_6));
    brg := MAX(MAX(MAX(I_BRG_T_1, I_BRG_T_2), MAX(I_BRG_T_3, I_BRG_T_4)), MAX(I_BRG_T_5, I_BRG_T_6));
    MAX_VIB := vib;
    nOver := 0;
    IF I_SPEED_A > RPM * 1.1 THEN nOver := nOver + 1; END_IF;
    IF I_SPEED_B > RPM * 1.1 THEN nOver := nOver + 1; END_IF;
    IF I_SPEED_C > RPM * 1.1 THEN nOver := nOver + 1; END_IF;
    T_VIBHH(IN := vib > 250.0 AND n > 200.0, PT := 2.0, DTS := dts, INIT := init);
    T_HPXHH(IN := I_HP_EXH_TEMP > 450.0, PT := 60.0, DTS := dts, INIT := init);
    c[1] := TRIP_PB;                              (* manual *)
    c[2] := nOver >= 2;                           (* electrical overspeed 110 %, 2 out of 3 *)
    c[3] := I_MECH_OVERSPEED;                     (* mechanical overspeed bolt *)
    c[4] := I_COND_PRESS > 300.0;                 (* low condenser vacuum *)
    c[5] := I_LO_PRESS < 0.6;                     (* low lube oil pressure *)
    c[6] := T_VIBHH.Q;                            (* high shaft vibration *)
    c[7] := ABS(I_AXIAL_DISP) > 1.0;              (* axial displacement *)
    c[8] := T_HPXHH.Q;                            (* HP exhaust temperature *)
    c[9] := IO_COMM_BMS AND P_BMS_MFT;            (* boiler MFT *)
    c[10] := IO_COMM_GEN AND P_GEN_LOCKOUT_86;    (* generator protection 86G *)
    c[11] := brg > 115.0;                         (* bearing temperature *)
    c[12] := I_DEH_WD_FAIL;                       (* watchdog / field I/O *)
    firstOut := FIRST_OUT(C1 := c[1], C2 := c[2], C3 := c[3], C4 := c[4], C5 := c[5], C6 := c[6], C7 := c[7], C8 := c[8], C9 := c[9],
                          C10 := c[10], C11 := c[11], C12 := c[12]);
    IF latch AND firstOut > 0 THEN
      latch := FALSE;
      cause := firstOut;
      spdGo := FALSE;
    END_IF;
    (* a trip condition other than the manual trip blocks the latch *)
    tripActive := c[2] OR c[3] OR c[4] OR c[5] OR c[6] OR c[7] OR c[8] OR c[9] OR c[10] OR c[11] OR c[12];
    latchPerm := NOT latch AND NOT tripActive AND I_COND_PRESS < 200.0 AND I_LO_PRESS > 1.0 AND n < RPM * 1.033 AND NOT gcb;
    LATCH_PERM := latchPerm;
    spdResync := FALSE;
    IF RESET AND latchPerm THEN
      latch := TRUE;
      cause := 0;
      spdRef := n;
      spdGo := FALSE;
      SPD_TARGET := n;
      SPD_CTRL_OUT := 0.0;
      spdResync := TRUE;
    END_IF;
    Q_TURB_TRIP := NOT latch;
    Q_MSV_CMD := latch;
    Q_RSV_CMD := latch;

    (* ---------------------------------------------------------------- mode *)
    IF IO_COMM_CCS THEN req := CCS_REQ; ELSE req := 0; END_IF;
    remoteSel := MODE_SEL = 1;
    dehMode := M_TRIPPED;
    IF latch THEN
      IF NOT gcb THEN
        dehMode := M_SPEED;
      ELSIF remoteSel AND req = 1 THEN
        dehMode := M_REMOTE;
      ELSIF remoteSel AND req = 2 THEN
        dehMode := M_PRESSURE;
      ELSE
        dehMode := M_LOAD;
      END_IF;
    END_IF;
    gcbRose := gcb AND NOT gcbPrev;
    gcbFell := NOT gcb AND gcbPrev;
    gcbPrev := gcb;
    IF gcbRose AND latch THEN
      (* initial load pick-up after synchronising *)
      loadRef := MAX(35.0, mw);
      LOAD_TARGET := MAX(35.0, mw);
      loadGo := FALSE;
    END_IF;
    IF gcbFell AND latch THEN
      (* load rejection: OPC pulse, back to speed control at synchronous speed, and the HP / LP
         bypass holds the boiler at its present pressure *)
      IF lastMw > 210.0 THEN opcT := 3.0; END_IF;
      IF PIC_HPB_MODE <> 0 THEN
        HPB_MODE := 0;
        HPB_TARGET := pms;
        hpbSp := pms;
        lpbSp := MAX(9.0, I_HRH_PRESS);
      END_IF;
      spdRef := RPM;
      SPD_TARGET := RPM;
      spdGo := FALSE;
    END_IF;
    lastMw := mw;

    (* ---------------------------------------------------------------- OPC *)
    opcT := MAX(0.0, opcT - dts);
    IF n > RPM * 1.03 THEN
      opcLatch := TRUE;
    ELSIF n < RPM * 1.01 AND opcT <= 0.0 THEN
      opcLatch := FALSE;
    END_IF;
    opc := latch AND (opcLatch OR opcT > 0.0);
    OPC_ACTIVE := opc;

    (* ---------------------------------------------------------------- turbine stress evaluator *)
    hpMetal := I_HP_METAL_TEMP;
    flowing := I_GV_POS > 1.0 AND I_MSV_OPEN;
    IF flowing THEN
      stressHp := (I_MS_TEMP - 40.0 - hpMetal) / 110.0 * 100.0;
      stressIp := (I_HRH_TEMP - 20.0 - I_IP_METAL_TEMP) / 120.0 * 100.0;
    ELSE
      stressHp := 0.0;
      stressIp := 0.0;
    END_IF;
    STRESS_HP := LIMIT(-100.0, stressHp, 200.0);
    STRESS_IP := LIMIT(-100.0, stressIp, 200.0);
    stressFactor := LIMIT(0.2, (110.0 - MAX(stressHp, stressIp)) / 30.0, 1.0);
    IF hpMetal < 200.0 THEN START_CLASS := 0;
    ELSIF hpMetal < 350.0 THEN START_CLASS := 1;
    ELSIF hpMetal < 450.0 THEN START_CLASS := 2;
    ELSE START_CLASS := 3;
    END_IF;

    (* ---------------------------------------------------------------- speed control *)
    IF GO THEN
      IF dehMode = M_SPEED THEN spdGo := TRUE; ELSE loadGo := TRUE; END_IF;
    END_IF;
    IF HOLD THEN
      spdGo := FALSE;
      loadGo := FALSE;
    END_IF;
    target := LIMIT(0.0, SPD_TARGET, RPM * 1.02);
    IF dehMode = M_SPEED THEN
      rate := SPD_RATE / 60.0 * stressFactor;
      (* critical speed bands 1140-1380, 1860-2100, 2160-2400 rpm: pass at >= 300 rpm/min, never hold *)
      banded := (spdRef > 1140.0 AND spdRef < 1380.0) OR (spdRef > 1860.0 AND spdRef < 2100.0) OR (spdRef > 2160.0 AND spdRef < 2400.0);
      IF banded THEN
        rate := MAX(rate, 300.0 / 60.0);
        IF NOT spdGo AND ABS(target - spdRef) > 1.0 THEN spdGo := TRUE; END_IF;
      END_IF;
      IF spdGo THEN
        spdRef := spdRef + LIMIT(-rate * dts, target - spdRef, rate * dts);
        IF ABS(target - spdRef) < 0.5 THEN spdGo := FALSE; END_IF;
      END_IF;
      IF IO_COMM_GEN AND SYNC_ACTIVE <> 0 AND spdRef >= RPM * 0.983 THEN
        spdRef := LIMIT(RPM * 0.983, spdRef + SYNC_ADJ * dts, RPM * 1.02);
        SPD_TARGET := spdRef;
      END_IF;
    ELSE
      spdRef := n;
      spdGo := FALSE;
    END_IF;
    CRIT_ZONE := dehMode = M_SPEED AND ((n > 1140.0 AND n < 1380.0) OR (n > 1860.0 AND n < 2100.0) OR (n > 2160.0 AND n < 2400.0));
    SPEED_REF := spdRef;
    RAMP_ACTIVE := spdGo OR loadGo;

    (* ---------------------------------------------------------------- load / pressure control *)
    df := I_GRID_FREQ - 60.0;
    dfDb := 0.0;
    IF df > 0.015 THEN dfDb := df - 0.015; ELSIF df < -0.015 THEN dfDb := df + 0.015; END_IF;
    droopPu := MAX(1.0, DROOP) / 100.0;
    fcorr := 0.0;
    IF FREQ_ON <> 0 AND gcb THEN
      fcorr := LIMIT(-70.0, -dfDb / 60.0 / droopPu * 700.0, 70.0);
    END_IF;
    FREQ_CORR := fcorr;
    IF dehMode = M_REMOTE THEN
      loadRef := LOAD_REF_REM;
      LOAD_TARGET := loadRef;
    ELSIF dehMode = M_LOAD THEN
      tgt := LIMIT(0.0, LOAD_TARGET, 720.0);
      IF loadGo THEN
        r := LOAD_RATE / 60.0 * stressFactor * dts;
        loadRef := loadRef + LIMIT(-r, tgt - loadRef, r);
        IF ABS(tgt - loadRef) < 0.05 THEN loadGo := FALSE; END_IF;
      END_IF;
    ELSIF dehMode <> M_PRESSURE THEN
      loadRef := MAX(0.0, mw);
      loadGo := FALSE;
    ELSE
      loadRef := mw;
    END_IF;
    LOAD_REF := loadRef;

    (* throttle pressure limiter and valve position limit *)
    tpl := (dehMode = M_LOAD OR dehMode = M_REMOTE) AND pms < TPL_SP;
    TPL_ACTIVE := tpl;
    gvHi := VPL;
    IF tpl THEN gvHi := MIN(gvHi, MAX(0.0, I_GV_POS - 0.5)); END_IF;
    pFilt := pFilt + (pms - pFilt) * MIN(1.0, dts / 30.0);

    IF NOT latch OR opc THEN
      (* tripped / OPC: all governors track a closed valve *)
      SPD_CTRL(PV_IN := n, TRK := TRUE, TRK_VAL := 0.0, OUT_HI := 1.0E30, FF := 0.0,
               DTS := dts, RESYNC := RT.RESYNC OR spdResync, PV_MIN := 0.0, PV_MAX := 4320.0, SP_TRACK := FALSE,
               SP := SPD_CTRL_SP, OUT := SPD_CTRL_OUT, MODE := SPD_CTRL_MODE, KP := SPD_CTRL_KP, TI := SPD_CTRL_TI, TD := SPD_CTRL_TD,
               PV := SPD_CTRL_PV, CSP := SPD_CTRL_CSP, STS := SPD_CTRL_STS);
      LOAD_CTRL(PV_IN := mw, TRK := TRUE, TRK_VAL := 0.0, OUT_HI := 1.0E30, FF := 0.0,
                DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 800.0, SP_TRACK := FALSE,
                SP := LOAD_CTRL_SP, OUT := LOAD_CTRL_OUT, MODE := LOAD_CTRL_MODE, KP := LOAD_CTRL_KP, TI := LOAD_CTRL_TI, TD := LOAD_CTRL_TD,
                PV := LOAD_CTRL_PV, CSP := LOAD_CTRL_CSP, STS := LOAD_CTRL_STS);
      PIC_TPT(PV_IN := pms, TRK := TRUE, TRK_VAL := 0.0, OUT_HI := 1.0E30,
              DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 200.0, DIRECT := TRUE, SP_TRACK := FALSE,
              SP := PIC_TPT_SP, OUT := PIC_TPT_OUT, MODE := PIC_TPT_MODE, KP := PIC_TPT_KP, TI := PIC_TPT_TI, TD := PIC_TPT_TD,
              PV := PIC_TPT_PV, CSP := PIC_TPT_CSP, STS := PIC_TPT_STS);
      gv := 0.0;
    ELSIF dehMode = M_SPEED THEN
      SPD_CTRL_SP := spdRef;
      SPD_CTRL(PV_IN := n, TRK := FALSE, OUT_HI := gvHi, FF := 0.0,
               DTS := dts, RESYNC := RT.RESYNC OR spdResync, PV_MIN := 0.0, PV_MAX := 4320.0, SP_TRACK := FALSE,
               SP := SPD_CTRL_SP, OUT := SPD_CTRL_OUT, MODE := SPD_CTRL_MODE, KP := SPD_CTRL_KP, TI := SPD_CTRL_TI, TD := SPD_CTRL_TD,
               PV := SPD_CTRL_PV, CSP := SPD_CTRL_CSP, STS := SPD_CTRL_STS);
      gv := SPD_CTRL.Q;
      LOAD_CTRL(PV_IN := mw, TRK := TRUE, TRK_VAL := gv, OUT_HI := 1.0E30, FF := 0.0,
                DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 800.0, SP_TRACK := FALSE,
                SP := LOAD_CTRL_SP, OUT := LOAD_CTRL_OUT, MODE := LOAD_CTRL_MODE, KP := LOAD_CTRL_KP, TI := LOAD_CTRL_TI, TD := LOAD_CTRL_TD,
                PV := LOAD_CTRL_PV, CSP := LOAD_CTRL_CSP, STS := LOAD_CTRL_STS);
      PIC_TPT(PV_IN := pms, TRK := TRUE, TRK_VAL := gv, OUT_HI := 1.0E30,
              DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 200.0, DIRECT := TRUE, SP_TRACK := FALSE,
              SP := PIC_TPT_SP, OUT := PIC_TPT_OUT, MODE := PIC_TPT_MODE, KP := PIC_TPT_KP, TI := PIC_TPT_TI, TD := PIC_TPT_TD,
              PV := PIC_TPT_PV, CSP := PIC_TPT_CSP, STS := PIC_TPT_STS);
    ELSIF dehMode = M_PRESSURE THEN
      PIC_TPT_SP := PRESS_SP_REM;
      PIC_TPT(PV_IN := pms, TRK := FALSE, OUT_HI := gvHi,
              DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 200.0, DIRECT := TRUE, SP_TRACK := FALSE,
              SP := PIC_TPT_SP, OUT := PIC_TPT_OUT, MODE := PIC_TPT_MODE, KP := PIC_TPT_KP, TI := PIC_TPT_TI, TD := PIC_TPT_TD,
              PV := PIC_TPT_PV, CSP := PIC_TPT_CSP, STS := PIC_TPT_STS);
      gv := PIC_TPT.Q;
      SPD_CTRL(PV_IN := n, TRK := TRUE, TRK_VAL := gv, OUT_HI := 1.0E30, FF := 0.0,
               DTS := dts, RESYNC := RT.RESYNC OR spdResync, PV_MIN := 0.0, PV_MAX := 4320.0, SP_TRACK := FALSE,
               SP := SPD_CTRL_SP, OUT := SPD_CTRL_OUT, MODE := SPD_CTRL_MODE, KP := SPD_CTRL_KP, TI := SPD_CTRL_TI, TD := SPD_CTRL_TD,
               PV := SPD_CTRL_PV, CSP := SPD_CTRL_CSP, STS := SPD_CTRL_STS);
      LOAD_CTRL(PV_IN := mw, TRK := TRUE, TRK_VAL := gv, OUT_HI := 1.0E30, FF := 0.0,
                DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 800.0, SP_TRACK := FALSE,
                SP := LOAD_CTRL_SP, OUT := LOAD_CTRL_OUT, MODE := LOAD_CTRL_MODE, KP := LOAD_CTRL_KP, TI := LOAD_CTRL_TI, TD := LOAD_CTRL_TD,
                PV := LOAD_CTRL_PV, CSP := LOAD_CTRL_CSP, STS := LOAD_CTRL_STS);
    ELSE
      (* LOAD / REMOTE: load controller with a valve-area feed-forward at the filtered throttle pressure *)
      spLoad := loadRef + fcorr;
      LOAD_CTRL_SP := spLoad;
      ffGv := LIMIT(0.0, spLoad / 700.0 * 90.0 * (168.0 / MAX(20.0, pFilt + 1.0)), 100.0);
      LOAD_CTRL(PV_IN := mw, TRK := FALSE, OUT_HI := gvHi, FF := ffGv,
                DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 800.0, SP_TRACK := FALSE,
                SP := LOAD_CTRL_SP, OUT := LOAD_CTRL_OUT, MODE := LOAD_CTRL_MODE, KP := LOAD_CTRL_KP, TI := LOAD_CTRL_TI, TD := LOAD_CTRL_TD,
                PV := LOAD_CTRL_PV, CSP := LOAD_CTRL_CSP, STS := LOAD_CTRL_STS);
      gv := LOAD_CTRL.Q;
      SPD_CTRL(PV_IN := n, TRK := TRUE, TRK_VAL := gv, OUT_HI := 1.0E30, FF := 0.0,
               DTS := dts, RESYNC := RT.RESYNC OR spdResync, PV_MIN := 0.0, PV_MAX := 4320.0, SP_TRACK := FALSE,
               SP := SPD_CTRL_SP, OUT := SPD_CTRL_OUT, MODE := SPD_CTRL_MODE, KP := SPD_CTRL_KP, TI := SPD_CTRL_TI, TD := SPD_CTRL_TD,
               PV := SPD_CTRL_PV, CSP := SPD_CTRL_CSP, STS := SPD_CTRL_STS);
      PIC_TPT(PV_IN := pms, TRK := TRUE, TRK_VAL := gv, OUT_HI := 1.0E30,
              DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 200.0, DIRECT := TRUE, SP_TRACK := FALSE,
              SP := PIC_TPT_SP, OUT := PIC_TPT_OUT, MODE := PIC_TPT_MODE, KP := PIC_TPT_KP, TI := PIC_TPT_TI, TD := PIC_TPT_TD,
              PV := PIC_TPT_PV, CSP := PIC_TPT_CSP, STS := PIC_TPT_STS);
    END_IF;
    GV_DEMAND := gv;
    Q_GV_DMD := gv;
    (* valve management: the intercept valves share the flow demand at low load so the reheater
       (held up by the LP bypass) cannot over-drive the IP turbine; fully open above ~67 % *)
    IF latch AND NOT opc THEN Q_ICV_DMD := LIMIT(0.0, gv * 1.5, 100.0); ELSE Q_ICV_DMD := 0.0; END_IF;

    (* ---------------------------------------------------------------- HP / LP bypass *)
    lpbIlk := I_COND_PRESS > 300.0 OR I_CW_FLOW < 15000.0;
    LPB_ILK := lpbIlk;
    latchFell := NOT latch AND latchPrev;
    latchPrev := latch;
    IF latchFell AND PIC_HPB_MODE <> 0 THEN
      (* turbine trip: hold the boiler at its present pressure through the bypass *)
      HPB_MODE := 0;
      HPB_TARGET := pms;
      hpbSp := pms;
      lpbSp := MAX(9.0, I_HRH_PRESS);
    END_IF;
    T_HPBCLOSED(IN := gcb AND I_HPB_POS < 2.0 AND mw > 50.0, PT := 30.0, DTS := dts, INIT := init);
    IF T_HPBCLOSED.Q AND HPB_MODE = 0 THEN HPB_MODE := 1; END_IF;
    follow := HPB_MODE = 1;
    IF follow THEN
      (* FOLLOW: setpoints a margin above the actual pressures, rising slowly, falling at once *)
      tgt := pms + 10.0;
      IF tgt < hpbSp THEN hpbSp := tgt; ELSE hpbSp := MIN(tgt, hpbSp + 5.0 / 60.0 * dts); END_IF;
      tgt := I_HRH_PRESS + 3.0;
      IF tgt < lpbSp THEN lpbSp := tgt; ELSE lpbSp := MIN(tgt, lpbSp + 3.0 / 60.0 * dts); END_IF;
    ELSE
      (* FIXED: ramp to the operator target *)
      r := HPB_RAMP / 60.0 * dts;
      hpbSp := hpbSp + LIMIT(-r, HPB_TARGET - hpbSp, r);
      IF PIC_LPB_MODE <> 0 AND NOT gcb THEN lpbSp := 9.0; END_IF;
    END_IF;
    IF PIC_HPB_MODE <> 0 THEN PIC_HPB_SP := hpbSp; ELSE hpbSp := pms; END_IF;
    IF PIC_LPB_MODE <> 0 THEN PIC_LPB_SP := lpbSp; END_IF;
    PIC_HPB(PV_IN := pms, TRK := lpbIlk, TRK_VAL := 0.0,
            DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 200.0, DIRECT := TRUE, SP_TRACK := FALSE,
            SP := PIC_HPB_SP, OUT := PIC_HPB_OUT, MODE := PIC_HPB_MODE, KP := PIC_HPB_KP, TI := PIC_HPB_TI, TD := PIC_HPB_TD,
            PV := PIC_HPB_PV, CSP := PIC_HPB_CSP, STS := PIC_HPB_STS);
    Q_HPB_DMD := PIC_HPB.Q;
    PIC_LPB(PV_IN := I_HRH_PRESS, TRK := lpbIlk, TRK_VAL := 0.0,
            DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 50.0, DIRECT := TRUE, SP_TRACK := FALSE,
            SP := PIC_LPB_SP, OUT := PIC_LPB_OUT, MODE := PIC_LPB_MODE, KP := PIC_LPB_KP, TI := PIC_LPB_TI, TD := PIC_LPB_TD,
            PV := PIC_LPB_PV, CSP := PIC_LPB_CSP, STS := PIC_LPB_STS);
    Q_LPB_DMD := PIC_LPB.Q;

    (* SH start-up vent: open while raising pressure from cold, closed above 5 bar *)
    fired := IO_COMM_BMS AND P_BMS_FUEL_IN_SERVICE;
    pd := I_DRUM_PRESS;
    SH_VENT(OPENED_FB := I_SH_VENT_OPEN, AUTO_OPEN := fired AND pd < 3.0, AUTO_CLOSE := pd > 5.0, SYNC := init,
            OPEN := SH_VENT_OPEN, CLOSE := SH_VENT_CLOSE, MODE := SH_VENT_MODE, CMD := Q_SH_VENT_CMD,
            OPENED := SH_VENT_OPENED, CLOSED := SH_VENT_CLOSED, PERM := SH_VENT_PERM, ILK := SH_VENT_ILK);

    (* ---------------------------------------------------------------- status *)
    TRIPPED := NOT latch;
    LATCHED := latch;
    MODE := dehMode;
    TRIP_CAUSE := cause;
    AT_SPEED := dehMode = M_SPEED AND ABS(n - RPM) < 18.0;
    REM_READY := latch AND gcb AND remoteSel;
  END_IF;

  (* watchdog to the hardwired turbine trip: the field trips the turbine if this stops changing *)
  Q_DEH_WD := HEARTBEAT;

  RESET := FALSE;
  TRIP_PB := FALSE;
  GO := FALSE;
  HOLD := FALSE;
END_PROGRAM
