(* STC - Steam Temperature Control
   Main steam: cascade TIC_MS (master, sets the desuperheater outlet temperature) ->
   TIC_DSH (slave, SH spray valve), with a superheat margin above saturation.
   Reheat: burner tilt TIC_RH is the primary control, TIC_RHS spray is a high-limit backstop.
   Naming: I_* field inputs, Q_* field outputs, P_<PEER>_* peer status, IO_* bridge signals. *)
PROGRAM STC_MAIN
(*@IO*)
  VAR
    RT : FB_PLC_RUNTIME;
    SPRAY_BLOCK : FB_ONOFF;
    TIC_MS : FB_LOOP;
    TIC_DSH : FB_LOOP;
    TIC_RH : FB_LOOP;
    TIC_RHS : FB_LOOP;
    dts : REAL;
    init : BOOL;
    steamPct : REAL;
    mft : BOOL;
    turbTrip : BOOL;
    permit : BOOL;
    permitLatch : BOOL;
    pmsAbs : REAL;
    tSatMs : REAL;
    dshMin : REAL;
    sprayOk : BOOL;
    dshCas : BOOL;
    rhPermit : BOOL;
  END_VAR
  VAR CONSTANT
    MCR_STEAM : REAL := 2149.0;   (* t/h at 100 % *)
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
  COMM_DEH := IO_COMM_DEH OR RT.GRACE OR NOT RT.READY;
  COMM_CCS := IO_COMM_CCS OR RT.GRACE OR NOT RT.READY;

  steamPct := I_STEAM_FLOW / MCR_STEAM * 100.0;
  IF init THEN
    permitLatch := steamPct > 20.0;
  END_IF;

  (* ---------------------------------------------------------------- built-in initial condition *)
  IF RT.IC_BUILTIN THEN
    TIC_DSH_OUT := I_SH_SPRAY_FB;
    TIC_MS_OUT := I_DSH_OUT_TEMP;
    TIC_RH_OUT := I_TILT_FB;
    TIC_RHS_OUT := I_RH_SPRAY_FB;
    SPRAY_BLOCK_MODE := 1;
    IF IO_IC_ID >= 2 THEN
      TIC_MS_MODE := 1; TIC_DSH_MODE := 2; TIC_RH_MODE := 1; TIC_RHS_MODE := 1;
    ELSE
      TIC_MS_MODE := 0; TIC_DSH_MODE := 0; TIC_RH_MODE := 0; TIC_RHS_MODE := 0;
    END_IF;
  END_IF;

  IF RT.READY THEN
    IF IO_COMM_BMS THEN mft := P_BMS_MFT; ELSE mft := TRUE; END_IF;
    IF IO_COMM_DEH THEN turbTrip := P_DEH_TRIPPED; ELSE turbTrip := TRUE; END_IF;

    (* spray permitted above 20 % steam flow (drops out below 15 %) and without MFT *)
    IF permitLatch THEN
      permit := NOT mft AND steamPct > 15.0;
    ELSE
      permit := NOT mft AND steamPct > 20.0;
    END_IF;
    permitLatch := permit;
    SPRAY_PERMIT := permit;

    SPRAY_BLOCK(OPENED_FB := I_SPRAY_BLOCK_OPEN, AUTO_OPEN := permit, AUTO_CLOSE := NOT permit, ILK_CLOSE := mft, SYNC := init,
                OPEN := SPRAY_BLOCK_OPEN, CLOSE := SPRAY_BLOCK_CLOSE, MODE := SPRAY_BLOCK_MODE, CMD := Q_SPRAY_BLOCK_CMD,
                OPENED := SPRAY_BLOCK_OPENED, CLOSED := SPRAY_BLOCK_CLOSED, PERM := SPRAY_BLOCK_PERM, ILK := SPRAY_BLOCK_ILK);

    (* superheat margin: the DSH outlet must stay 15 K above saturation *)
    pmsAbs := I_MS_PRESS / 10.0 + 0.1013;   (* bar(g) -> MPa(a) *)
    tSatMs := TSAT(P := pmsAbs);
    dshMin := tSatMs + 15.0;
    DSH_SP_MIN := dshMin;
    MS_SUPERHEAT := I_MS_TEMP - tSatMs;

    (* ---- cascade: TIC_MS (master) -> TIC_DSH (slave) -> SH spray valve *)
    sprayOk := permit AND SPRAY_BLOCK.IS_OPEN;
    dshCas := TIC_DSH_MODE = 2 AND sprayOk;
    TIC_MS(PV_IN := I_MS_TEMP, OUT_LO := dshMin, TRK := NOT dshCas, TRK_VAL := I_DSH_OUT_TEMP,
           DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 300.0, PV_MAX := 600.0, OUT_MIN := 300.0, OUT_MAX := 530.0, SP_TRACK := FALSE,
           SP := TIC_MS_SP, OUT := TIC_MS_OUT, MODE := TIC_MS_MODE, KP := TIC_MS_KP, TI := TIC_MS_TI, TD := TIC_MS_TD,
           PV := TIC_MS_PV, CSP := TIC_MS_CSP, STS := TIC_MS_STS);
    TIC_DSH(PV_IN := I_DSH_OUT_TEMP, CSP_IN := TIC_MS.Q, CSP_OK := TRUE, SP_LO := dshMin, TRK := NOT sprayOk, TRK_VAL := 0.0,
            DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 200.0, PV_MAX := 600.0, DIRECT := TRUE, CAS_CFG := TRUE,
            SP := TIC_DSH_SP, OUT := TIC_DSH_OUT, MODE := TIC_DSH_MODE, KP := TIC_DSH_KP, TI := TIC_DSH_TI, TD := TIC_DSH_TD,
            PV := TIC_DSH_PV, CSP := TIC_DSH_CSP, STS := TIC_DSH_STS);
    Q_SH_SPRAY_DMD := TIC_DSH.Q;

    (* ---- reheat: burner tilt primary, spray as backstop a few degrees above the RH setpoint *)
    rhPermit := permit AND NOT turbTrip;
    TIC_RH(PV_IN := I_HRH_TEMP, TRK := NOT rhPermit, TRK_VAL := 0.0,
           DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 300.0, PV_MAX := 600.0, OUT_MIN := -30.0, OUT_MAX := 30.0, SP_TRACK := FALSE,
           SP := TIC_RH_SP, OUT := TIC_RH_OUT, MODE := TIC_RH_MODE, KP := TIC_RH_KP, TI := TIC_RH_TI, TD := TIC_RH_TD,
           PV := TIC_RH_PV, CSP := TIC_RH_CSP, STS := TIC_RH_STS);
    Q_TILT_DMD := TIC_RH.Q;
    IF TIC_RHS_MODE <> 0 THEN
      TIC_RHS_SP := TIC_RH_SP + RHS_OFFSET;
    END_IF;
    TIC_RHS(PV_IN := I_HRH_TEMP, TRK := NOT rhPermit, TRK_VAL := 0.0,
            DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 300.0, PV_MAX := 600.0, DIRECT := TRUE, SP_TRACK := FALSE,
            SP := TIC_RHS_SP, OUT := TIC_RHS_OUT, MODE := TIC_RHS_MODE, KP := TIC_RHS_KP, TI := TIC_RHS_TI, TD := TIC_RHS_TD,
            PV := TIC_RHS_PV, CSP := TIC_RHS_CSP, STS := TIC_RHS_STS);
    Q_RH_SPRAY_DMD := TIC_RHS.Q;
  END_IF;
END_PROGRAM
