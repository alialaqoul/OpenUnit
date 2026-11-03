(* GEN - Generator, Excitation & Synchronising
   Generator protection with lockout relay 86G (first-out cause), field breaker (41) and
   generator breaker (52G), automatic synchroniser (speed matching via DEH, voltage matching
   via the AVR, advance-angle closing), AVR with MVAr / power-factor control and over / under
   excitation limiters, field forcing to no-load excitation on load rejection.
   Naming: I_* field inputs, Q_* field outputs, P_<PEER>_* peer status, W_<PEER>_* writes to
   a peer, IO_* bridge signals. *)
PROGRAM GEN_MAIN
(*@IO*)
  VAR
    RT : FB_PLC_RUNTIME;
    FCB : FB_ONOFF;
    GCB : FB_ONOFF;
    AVR : FB_LOOP;
    T_OOS : FB_TONS;           (* loss of field / pole slip *)
    T_REVP : FB_TONS;          (* reverse power *)
    T_OV : FB_TONS;            (* overvoltage *)
    T_FREQ : FB_TONS;          (* over / under frequency *)
    T_VHZ : FB_TONS;           (* over-excitation V/Hz *)
    T_OC : FB_TONS;            (* overcurrent *)
    T_LFP : FB_TONS;           (* low forward power after turbine trip *)
    dts : REAL;
    init : BOOL;
    speed : REAL;
    freq : REAL;
    vPu : REAL;
    gPu : REAL;
    vhzV : REAL;
    gcbIn : BOOL;
    fcbIn : BOOL;
    mw : REAL;
    slip : REAL;
    phase : REAL;
    ifPu : REAL;
    dV : REAL;
    dehOk : BOOL;
    dehLatched : BOOL;
    dehTripped : BOOL;
    dehSpeedMode : BOOL;
    c : ARRAY[1..10] OF BOOL;  (* protection functions, by trip cause number *)
    firstOut : DINT;
    lock : BOOL;
    cause : DINT;
    faultActive : BOOL;
    syncCheck : BOOL;
    syncPerm : BOOL;
    sync : DINT;               (* 0 OFF, 1 WAIT, 2 MATCH, 3 CLOSING, 4 DONE *)
    syncT : REAL;
    autoClose : BOOL;
    adj : REAL;
    vTarget : REAL;
    advance : REAL;
    qTarget : REAL;
    qErr : REAL;
    oel : BOOL;
    uel : BOOL;
    gcbPrev : BOOL;
    gcbOpened : BOOL;
    excHi : REAL;
    excLo : REAL;
  END_VAR
  VAR CONSTANT
    SLIP_TARGET : REAL := 0.08;   (* Hz, generator slightly faster than the grid *)
    RATED_KA : REAL := 21.6;       (* kA *)
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

  IF init THEN
    lock := FALSE;
    cause := 0;
    sync := 0;
    syncT := 0.0;
    gcbPrev := FALSE;
  END_IF;

  (* ---------------------------------------------------------------- built-in initial condition *)
  IF RT.IC_BUILTIN THEN
    IF I_FCB_CLOSED THEN
      AVR_OUT := I_FIELD_AMPS / 2400.0;
      AVR_SP := I_GEN_KV;
      AVR_MODE := 1;
    ELSE
      AVR_OUT := 0.0;
      AVR_SP := 22.0;
      AVR_MODE := 0;
    END_IF;
    FCB_MODE := 0;
    GCB_MODE := 0;
  END_IF;

  IF RT.READY THEN
    speed := I_SPEED_B;
    freq := MAX(1.0, speed / 60.0);
    vPu := I_GEN_KV / 22.0;
    gPu := I_GRID_KV / 400.0;
    vhzV := vPu / (freq / 60.0);
    gcbIn := I_GCB_CLOSED;
    fcbIn := I_FCB_CLOSED;
    mw := I_GEN_MW;
    slip := I_SYNC_SLIP;
    phase := I_SYNC_PHASE;
    ifPu := I_FIELD_AMPS / 2400.0;
    dehOk := IO_COMM_DEH;
    dehLatched := dehOk AND P_DEH_LATCHED;
    IF dehOk THEN dehTripped := P_DEH_TRIPPED; ELSE dehTripped := TRUE; END_IF;
    dehSpeedMode := dehOk AND P_DEH_MODE = 1;
    V_PU := vPu;
    GRID_V_PU := gPu;
    VHZ := vhzV;
    dV := (vPu - gPu) * 100.0;
    DV_PCT := dV;

    (* ---------------------------------------------------------------- protection (86G lockout) *)
    T_OOS(IN := gcbIn AND (I_OUT_OF_STEP OR ifPu < 0.15), PT := 0.5, DTS := dts, INIT := init);
    IF dehTripped THEN
      T_REVP(IN := gcbIn AND mw < -4.0, PT := 2.0, DTS := dts, INIT := init);
    ELSE
      T_REVP(IN := gcbIn AND mw < -4.0, PT := 5.0, DTS := dts, INIT := init);
    END_IF;
    T_OV(IN := fcbIn AND vPu > 1.18, PT := 5.0, DTS := dts, INIT := init);
    T_FREQ(IN := gcbIn AND (freq < 57.5 OR freq > 61.8), PT := 5.0, DTS := dts, INIT := init);
    T_VHZ(IN := fcbIn AND vhzV > 1.12, PT := 5.0, DTS := dts, INIT := init);
    T_OC(IN := I_GEN_KA > 1.3 * RATED_KA, PT := 10.0, DTS := dts, INIT := init);
    T_LFP(IN := dehTripped AND gcbIn AND mw < 10.0, PT := 20.0, DTS := dts, INIT := init);
    c[1] := TRIP_86;                       (* manual trip *)
    c[2] := I_GEN_DIFF_RELAY;              (* 87G *)
    c[3] := T_OOS.Q;                       (* 40 / 78 *)
    c[4] := T_REVP.Q;                      (* 32 *)
    c[5] := T_OV.Q OR vPu > 1.4;           (* 59, instantaneous above 1.4 pu *)
    c[6] := T_FREQ.Q;                      (* 81 *)
    c[7] := T_VHZ.Q;                       (* 24 *)
    c[8] := I_STATOR_TEMP > 125.0;
    c[9] := T_OC.Q;                        (* 51 *)
    c[10] := T_LFP.Q;                      (* sequential tripping *)
    REV_POWER := gcbIn AND mw < -2.0;
    firstOut := FIRST_OUT(C1 := c[1], C2 := c[2], C3 := c[3], C4 := c[4], C5 := c[5], C6 := c[6], C7 := c[7], C8 := c[8], C9 := c[9],
                          C10 := c[10]);
    IF NOT lock AND firstOut > 0 THEN
      lock := TRUE;
      cause := firstOut;
      sync := 0;
    END_IF;
    IF RESET_86 THEN
      faultActive := c[2] OR c[3] OR c[5] OR c[7] OR c[8];
      IF lock AND NOT faultActive THEN
        lock := FALSE;
        cause := 0;
      END_IF;
    END_IF;

    (* ---------------------------------------------------------------- breakers *)
    syncCheck := NOT gcbIn AND fcbIn AND ABS(slip) < 0.2 AND ABS(phase) < 15.0 AND ABS(dV) < 5.0;
    SYNC_CHECK := syncCheck;
    FCB(OPENED_FB := fcbIn, PERMIT := speed > 3420.0 AND NOT lock AND dehLatched, ILK_CLOSE := lock OR speed < 3000.0,
        RESET_ON_LOSS := TRUE, SYNC := init,
        OPEN := FCB_OPEN, CLOSE := FCB_CLOSE, MODE := FCB_MODE, CMD := Q_FCB_CMD,
        OPENED := FCB_OPENED, CLOSED := FCB_CLOSED, PERM := FCB_PERM, ILK := FCB_ILK);

    (* ---------------------------------------------------------------- auto synchroniser *)
    autoClose := FALSE;
    adj := 0.0;
    IF SYNC_ON AND NOT gcbIn THEN sync := 1; END_IF;
    IF SYNC_OFF THEN sync := 0; END_IF;
    syncPerm := dehLatched AND dehSpeedMode AND speed > 3540.0 AND fcbIn AND AVR_MODE <> 0 AND NOT lock AND NOT gcbIn;
    CASE sync OF
      1: (* waiting for permissives *)
        IF syncPerm THEN sync := 2; END_IF;
      2: (* matching speed and voltage *)
        IF NOT syncPerm THEN
          sync := 1;
        ELSE
          adj := LIMIT(-4.0, (SLIP_TARGET - slip) * 60.0 * 0.6, 4.0);
          vTarget := gPu * 22.0 * 1.005;
          AVR_SP := AVR_SP + LIMIT(-0.2 * dts, vTarget - AVR_SP, 0.2 * dts);
          advance := 360.0 * slip * 0.08;   (* breaker closing time 80 ms *)
          IF slip > 0.02 AND slip < 0.2 AND ABS(dV) < 2.0 AND phase < -advance + 4.0 AND phase > -advance - 6.0 THEN
            autoClose := TRUE;
            sync := 3;
            syncT := 0.0;
          END_IF;
        END_IF;
      3: (* closing *)
        autoClose := TRUE;
        syncT := syncT + dts;
        IF gcbIn THEN
          sync := 4;
          syncT := 0.0;
        ELSIF syncT > 2.0 THEN
          sync := 2;
        END_IF;
      4: (* synchronised *)
        syncT := syncT + dts;
        IF syncT > 5.0 THEN sync := 0; END_IF;
    END_CASE;
    IF gcbIn AND sync <> 4 AND sync <> 0 THEN sync := 4; END_IF;
    SYNC_STATE := sync;
    W_DEH_SYNC_ADJ := adj;
    IF sync = 2 OR sync = 3 THEN W_DEH_SYNC_ACTIVE := 1; ELSE W_DEH_SYNC_ACTIVE := 0; END_IF;

    GCB(OPENED_FB := gcbIn, PERMIT := (syncCheck OR gcbIn) AND NOT lock AND dehLatched, ILK_CLOSE := lock,
        RESET_ON_LOSS := TRUE, CMD_SET := autoClose, CMD_VAL := TRUE, SYNC := init,
        OPEN := GCB_OPEN, CLOSE := GCB_CLOSE, MODE := GCB_MODE, CMD := Q_GCB_CMD,
        OPENED := GCB_OPENED, CLOSED := GCB_CLOSED, PERM := GCB_PERM, ILK := GCB_ILK);

    (* ---------------------------------------------------------------- AVR & limiters *)
    (* on line: MVAr or power-factor control trims the voltage setpoint slowly *)
    IF gcbIn AND AVR_MODE <> 0 AND EXC_MODE > 0 THEN
      IF EXC_MODE = 1 THEN
        qTarget := MVAR_SP;
      ELSE
        qTarget := mw * TAN(ACOS(LIMIT(0.7, PF_SP, 1.0)));
      END_IF;
      qErr := qTarget - I_GEN_MVAR;
      AVR_SP := LIMIT(20.0, AVR_SP + LIMIT(-1.0, qErr / 300.0, 1.0) * 0.05 * dts, 24.2);
    END_IF;
    (* off line: V/Hz limiter *)
    IF NOT gcbIn AND AVR_MODE <> 0 THEN
      AVR_SP := MIN(AVR_SP, 22.0 * 1.05 * (freq / 60.0));
    END_IF;
    oel := ifPu > 2.1;
    uel := gcbIn AND I_GEN_MVAR < -0.3 * MAX(0.0, mw) - 120.0;
    OEL_ACTIVE := oel;
    UEL_ACTIVE := uel;
    (* load rejection: force the field down to no-load excitation so the voltage stays near rated *)
    gcbOpened := NOT gcbIn AND gcbPrev;
    gcbPrev := gcbIn;
    IF gcbOpened AND AVR_MODE <> 0 THEN
      AVR_OUT := 1.0;
      AVR_SP := 22.0;
      AVR_MODE := 1;
      EXC_MODE := 0;
    END_IF;
    IF oel THEN excHi := ifPu; ELSE excHi := 2.3; END_IF;
    IF uel THEN excLo := ifPu + 0.005; ELSE excLo := 0.0; END_IF;
    AVR(PV_IN := I_GEN_KV, TRK := NOT fcbIn, TRK_VAL := 0.0, OUT_HI := excHi, OUT_LO := excLo,
        DTS := dts, RESYNC := RT.RESYNC OR gcbOpened, PV_MIN := 0.0, PV_MAX := 30.0, OUT_MIN := 0.0, OUT_MAX := 2.3,
        SP_TRACK := FALSE, REF_DT := 0.15,
        SP := AVR_SP, OUT := AVR_OUT, MODE := AVR_MODE, KP := AVR_KP, TI := AVR_TI, TD := AVR_TD,
        PV := AVR_PV, CSP := AVR_CSP, STS := AVR_STS);
    Q_EXC_DMD := AVR.Q;

    LOCKOUT_86 := lock;
    TRIP_CAUSE := cause;
  END_IF;

  (* operator pulses are consumed in the scan they arrive *)
  SYNC_ON := FALSE;
  SYNC_OFF := FALSE;
  RESET_86 := FALSE;
  TRIP_86 := FALSE;
END_PROGRAM
