(* FWC - Feedwater & Condensate Control
   Drum level: 1-element (level -> FW valve) at low load, 3-element (level master trims a steam
   flow feed-forward, FW flow slave) above 25 % steam flow, bumpless transfer between them.
   Boiler feed pumps: valve differential pressure master (PIC_FWDP) -> speed stations, standby
   pump auto start on a partner trip (it joins the master demand), runback request if fewer than
   two pumps run above 58 % load.  Deaerator level and pegging steam, blowdown, HP heaters.
   Naming: I_* field inputs, Q_* field outputs, P_<PEER>_* peer status, IO_* bridge signals. *)
PROGRAM FWC_MAIN
(*@IO*)
  VAR
    RT : FB_PLC_RUNTIME;
    BFP_A : FB_MOTOR;
    BFP_B : FB_MOTOR;
    BFP_C : FB_MOTOR;
    EBD : FB_ONOFF;
    HPH : FB_ONOFF;
    LIC_DRUM : FB_LOOP;
    FIC_FW : FB_LOOP;
    PIC_FWDP : FB_LOOP;
    SC_BFPA : FB_STATION;
    SC_BFPB : FB_STATION;
    SC_BFPC : FB_STATION;
    LIC_DA : FB_LOOP;
    PIC_DA : FB_LOOP;
    HIC_CBD : FB_STATION;
    T_LTDEV : FB_TONS;
    T_RBBFP : FB_TONS;
    dts : REAL;
    init : BOOL;
    keep : BOOL;
    keepCbd : BOOL;
    lvl : REAL;
    steam : REAL;
    spray : REAL;
    fw : REAL;
    ff : REAL;
    steamPct : REAL;
    e3 : BOOL;
    e3Latch : BOOL;
    e3Changed : BOOL;
    e3Trk : REAL;
    ficCas : BOOL;
    nRun : DINT;
    daLvl : REAL;
    dp : REAL;
    dpSp : REAL;
    anyAuto : BOOL;
    avgScoop : REAL;
    master : REAL;
    tripA : BOOL;
    tripB : BOOL;
    tripC : BOOL;
    runPrevA : BOOL;
    runPrevB : BOOL;
    runPrevC : BOOL;
    joinA : BOOL;
    joinB : BOOL;
    joinC : BOOL;
    cep : BOOL;
  END_VAR
  VAR CONSTANT
    MCR_STEAM : REAL := 2149.0;   (* t/h *)
    TRIM_GAIN : REAL := 12.0;     (* t/h per % of level master output in 3-element mode *)
  END_VAR

  (* ---------------------------------------------------------------- runtime services *)
  RT(SIM_MS := I_SIM_TIME_MS, IC_SEQ := IO_IC_SEQ, IC_ID := IO_IC_ID, IC_SNAP := IO_IC_SNAP, CYCLE_MS := 50.0,
     HEARTBEAT := HEARTBEAT, SCAN_COUNT := SCAN_COUNT, SCAN_MS := SCAN_MS, SIM_DT := SIM_DT,
     IC_APPLIED := IC_APPLIED, IC_ACK := IC_ACK);
  dts := RT.DTS;
  init := RT.IC_INIT;
  keep := IO_IC_SNAP;
  keepCbd := IO_IC_SNAP;
  HEALTHY := IO_COMM_PLANT AND RT.READY;
  COMM_PLANT := IO_COMM_PLANT OR NOT RT.READY;   (* not reported before the bridge has initialised the PLC *)
  COMM_BMS := IO_COMM_BMS OR RT.GRACE OR NOT RT.READY;
  COMM_DEH := IO_COMM_DEH OR RT.GRACE OR NOT RT.READY;

  steam := I_STEAM_FLOW;
  spray := I_SH_SPRAY_FLOW;
  fw := I_FW_FLOW;
  ff := MAX(0.0, steam - spray);
  steamPct := steam / MCR_STEAM * 100.0;
  e3Trk := LIMIT(0.0, 50.0 + (fw - ff) / TRIM_GAIN, 100.0);   (* level master output for a bumpless 3-element start *)

  IF init THEN
    (* element selection as it stands, so the IC does not cause a transfer *)
    IF ELEM_SEL = 1 THEN e3Latch := FALSE; ELSIF ELEM_SEL = 2 THEN e3Latch := TRUE; ELSE e3Latch := steamPct > 25.0; END_IF;
    runPrevA := FALSE; runPrevB := FALSE; runPrevC := FALSE;
    joinA := FALSE; joinB := FALSE; joinC := FALSE;
  END_IF;

  (* ---------------------------------------------------------------- built-in initial condition *)
  IF RT.IC_BUILTIN THEN
    keep := TRUE;   (* BFP stations below are set explicitly *)
    EBD_MODE := 1;
    IF I_BFP_A_RUN THEN BFP_A_MODE := 0; SC_BFPA_OUT := LIMIT(0.0, (I_BFP_A_SPEED - 1500.0) / 39.0, 100.0); ELSE BFP_A_MODE := 1; SC_BFPA_OUT := 0.0; END_IF;
    IF I_BFP_B_RUN THEN BFP_B_MODE := 0; SC_BFPB_OUT := LIMIT(0.0, (I_BFP_B_SPEED - 1500.0) / 39.0, 100.0); ELSE BFP_B_MODE := 1; SC_BFPB_OUT := 0.0; END_IF;
    IF I_BFP_C_RUN THEN BFP_C_MODE := 0; SC_BFPC_OUT := LIMIT(0.0, (I_BFP_C_SPEED - 1500.0) / 39.0, 100.0); ELSE BFP_C_MODE := 1; SC_BFPC_OUT := 0.0; END_IF;
    IF I_BFP_A_RUN AND IO_IC_ID >= 2 THEN SC_BFPA_MODE := 1; ELSE SC_BFPA_MODE := 0; END_IF;
    IF I_BFP_B_RUN AND IO_IC_ID >= 2 THEN SC_BFPB_MODE := 1; ELSE SC_BFPB_MODE := 0; END_IF;
    IF I_BFP_C_RUN AND IO_IC_ID >= 2 THEN SC_BFPC_MODE := 1; ELSE SC_BFPC_MODE := 0; END_IF;
    IF I_BFP_A_RUN THEN PIC_FWDP_OUT := SC_BFPA_OUT;
    ELSIF I_BFP_B_RUN THEN PIC_FWDP_OUT := SC_BFPB_OUT;
    ELSIF I_BFP_C_RUN THEN PIC_FWDP_OUT := SC_BFPC_OUT;
    ELSE PIC_FWDP_OUT := 0.0;
    END_IF;
    FIC_FW_OUT := I_FCV_FB;
    LIC_DA_OUT := I_DA_CV_FB;
    PIC_DA_OUT := I_PEG_FB;
    e3Latch := steamPct > 25.0;
    IF e3Latch THEN LIC_DRUM_OUT := e3Trk; ELSE LIC_DRUM_OUT := I_FCV_FB; END_IF;
    IF IO_IC_ID >= 2 THEN
      LIC_DRUM_MODE := 1; FIC_FW_MODE := 2; PIC_FWDP_MODE := 2; LIC_DA_MODE := 1; PIC_DA_MODE := 1;
    ELSE
      LIC_DRUM_MODE := 0; FIC_FW_MODE := 0; PIC_FWDP_MODE := 0; LIC_DA_MODE := 0; PIC_DA_MODE := 0;
    END_IF;
  END_IF;

  IF RT.READY THEN
    lvl := MEDIAN3(I_DRUM_LVL_A, I_DRUM_LVL_B, I_DRUM_LVL_C);
    DRUM_LVL_SEL := lvl;
    T_LTDEV(IN := ABS(I_DRUM_LVL_A - lvl) > 50.0 OR ABS(I_DRUM_LVL_B - lvl) > 50.0 OR ABS(I_DRUM_LVL_C - lvl) > 50.0,
            PT := 5.0, DTS := dts, INIT := init);
    LT_DEVIATION := T_LTDEV.Q;
    STEAM_FLOW_PCT := steamPct;

    (* ---- drum level: 1-element / 3-element with bumpless transfer *)
    IF ELEM_SEL = 1 THEN
      e3 := FALSE;
    ELSIF ELEM_SEL = 2 THEN
      e3 := TRUE;
    ELSIF e3Latch THEN
      e3 := steamPct > 20.0;
    ELSE
      e3 := steamPct > 25.0;
    END_IF;
    e3Changed := e3 <> e3Latch;
    IF e3Changed THEN
      e3Latch := e3;
      IF e3 THEN LIC_DRUM_OUT := e3Trk; ELSE LIC_DRUM_OUT := I_FCV_FB; END_IF;
    END_IF;
    E3_ACTIVE := e3;
    ficCas := FIC_FW_MODE = 2;
    IF NOT e3 THEN
      (* 1-element: the level controller positions the valve through the flow loop *)
      LIC_DRUM(PV_IN := lvl, TRK := NOT ficCas, TRK_VAL := I_FCV_FB,
               DTS := dts, RESYNC := RT.RESYNC OR e3Changed, PV_MIN := -500.0, PV_MAX := 500.0,
               SP := LIC_DRUM_SP, OUT := LIC_DRUM_OUT, MODE := LIC_DRUM_MODE, KP := LIC_DRUM_KP, TI := LIC_DRUM_TI, TD := LIC_DRUM_TD,
               PV := LIC_DRUM_PV, CSP := LIC_DRUM_CSP, STS := LIC_DRUM_STS);
      FIC_FW(PV_IN := fw, CSP_IN := fw, CSP_OK := TRUE, TRK := ficCas, TRK_VAL := LIC_DRUM.Q,
             DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 2600.0, CAS_CFG := TRUE,
             SP := FIC_FW_SP, OUT := FIC_FW_OUT, MODE := FIC_FW_MODE, KP := FIC_FW_KP, TI := FIC_FW_TI, TD := FIC_FW_TD,
             PV := FIC_FW_PV, CSP := FIC_FW_CSP, STS := FIC_FW_STS);
    ELSE
      (* 3-element: level master trims the steam flow feed-forward, flow loop is the slave *)
      LIC_DRUM(PV_IN := lvl, TRK := NOT ficCas, TRK_VAL := e3Trk,
               DTS := dts, RESYNC := RT.RESYNC OR e3Changed, PV_MIN := -500.0, PV_MAX := 500.0,
               SP := LIC_DRUM_SP, OUT := LIC_DRUM_OUT, MODE := LIC_DRUM_MODE, KP := LIC_DRUM_KP, TI := LIC_DRUM_TI, TD := LIC_DRUM_TD,
               PV := LIC_DRUM_PV, CSP := LIC_DRUM_CSP, STS := LIC_DRUM_STS);
      FIC_FW(PV_IN := fw, CSP_IN := LIMIT(0.0, ff + (LIC_DRUM.Q - 50.0) * TRIM_GAIN, 2600.0), CSP_OK := TRUE, TRK := FALSE,
             DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 2600.0, CAS_CFG := TRUE,
             SP := FIC_FW_SP, OUT := FIC_FW_OUT, MODE := FIC_FW_MODE, KP := FIC_FW_KP, TI := FIC_FW_TI, TD := FIC_FW_TD,
             PV := FIC_FW_PV, CSP := FIC_FW_CSP, STS := FIC_FW_STS);
    END_IF;
    Q_FCV_DMD := FIC_FW.Q;
    LVL_AUTO := LIC_DRUM.AUTO AND ficCas;

    (* ---- boiler feed pumps: standby start on a partner trip (latched until the operator's STOP) *)
    nRun := 0;
    IF I_BFP_A_RUN THEN nRun := nRun + 1; END_IF;
    IF I_BFP_B_RUN THEN nRun := nRun + 1; END_IF;
    IF I_BFP_C_RUN THEN nRun := nRun + 1; END_IF;
    BFP_RUNNING := nRun;
    daLvl := I_DA_LVL;
    tripA := I_BFP_A_TRIP OR (BFP_A.LATCHED AND NOT init);
    tripB := I_BFP_B_TRIP OR (BFP_B.LATCHED AND NOT init);
    tripC := I_BFP_C_TRIP OR (BFP_C.LATCHED AND NOT init);
    BFP_A(RUN_FB := I_BFP_A_RUN, TRIP_FB := I_BFP_A_TRIP, PERMIT := daLvl > 1200.0 AND SC_BFPA_OUT <= 10.0,
          AUTO_START := (tripB OR tripC) AND nRun < 3, SYNC := init,
          START := BFP_A_START, STOP := BFP_A_STOP, MODE := BFP_A_MODE, CMD := Q_BFP_A_CMD,
          RUN := BFP_A_RUN, TRIP := BFP_A_TRIP, PERM := BFP_A_PERM, ILK_T := BFP_A_ILK);
    IF I_BFP_A_RUN AND NOT runPrevA AND BFP_A.IS_AUTO AND (tripB OR tripC) THEN joinA := TRUE; END_IF;
    runPrevA := I_BFP_A_RUN;
    tripA := I_BFP_A_TRIP OR BFP_A.LATCHED;
    BFP_B(RUN_FB := I_BFP_B_RUN, TRIP_FB := I_BFP_B_TRIP, PERMIT := daLvl > 1200.0 AND SC_BFPB_OUT <= 10.0,
          AUTO_START := (tripA OR tripC) AND nRun < 3, SYNC := init,
          START := BFP_B_START, STOP := BFP_B_STOP, MODE := BFP_B_MODE, CMD := Q_BFP_B_CMD,
          RUN := BFP_B_RUN, TRIP := BFP_B_TRIP, PERM := BFP_B_PERM, ILK_T := BFP_B_ILK);
    IF I_BFP_B_RUN AND NOT runPrevB AND BFP_B.IS_AUTO AND (tripA OR tripC) THEN joinB := TRUE; END_IF;
    runPrevB := I_BFP_B_RUN;
    tripB := I_BFP_B_TRIP OR BFP_B.LATCHED;
    BFP_C(RUN_FB := I_BFP_C_RUN, TRIP_FB := I_BFP_C_TRIP, PERMIT := daLvl > 1200.0 AND SC_BFPC_OUT <= 10.0,
          AUTO_START := (tripA OR tripB) AND nRun < 3, SYNC := init,
          START := BFP_C_START, STOP := BFP_C_STOP, MODE := BFP_C_MODE, CMD := Q_BFP_C_CMD,
          RUN := BFP_C_RUN, TRIP := BFP_C_TRIP, PERM := BFP_C_PERM, ILK_T := BFP_C_ILK);
    IF I_BFP_C_RUN AND NOT runPrevC AND BFP_C.IS_AUTO AND (tripA OR tripB) THEN joinC := TRUE; END_IF;
    runPrevC := I_BFP_C_RUN;

    (* ---- BFP master: feedwater valve differential pressure *)
    dp := I_FW_HDR_PRESS - I_DRUM_PRESS;
    FW_DP := dp;
    anyAuto := (I_BFP_A_RUN AND SC_BFPA_MODE = 1) OR (I_BFP_B_RUN AND SC_BFPB_MODE = 1) OR (I_BFP_C_RUN AND SC_BFPC_MODE = 1);
    avgScoop := 0.0;
    IF I_BFP_A_RUN THEN avgScoop := avgScoop + SC_BFPA_OUT; END_IF;
    IF I_BFP_B_RUN THEN avgScoop := avgScoop + SC_BFPB_OUT; END_IF;
    IF I_BFP_C_RUN THEN avgScoop := avgScoop + SC_BFPC_OUT; END_IF;
    IF nRun > 0 THEN avgScoop := avgScoop / DINT_TO_REAL(nRun); END_IF;
    (* DP setpoint program: 10 bar at no load, 12 bar at 30 %, 20 bar at 100 % steam flow *)
    IF steamPct <= 30.0 THEN
      dpSp := 10.0 + LIMIT(0.0, steamPct, 30.0) / 30.0 * 2.0;
    ELSE
      dpSp := 12.0 + (MIN(steamPct, 100.0) - 30.0) / 70.0 * 8.0;
    END_IF;
    PIC_FWDP(PV_IN := dp, CSP_IN := dpSp, CSP_OK := DP_SP_MODE = 1, TRK := nRun = 0 OR NOT anyAuto, TRK_VAL := avgScoop,
             DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 50.0, CAS_CFG := TRUE,
             SP := PIC_FWDP_SP, OUT := PIC_FWDP_OUT, MODE := PIC_FWDP_MODE, KP := PIC_FWDP_KP, TI := PIC_FWDP_TI, TD := PIC_FWDP_TD,
             PV := PIC_FWDP_PV, CSP := PIC_FWDP_CSP, STS := PIC_FWDP_STS);
    master := PIC_FWDP.Q;
    BFP_MASTER := master;
    SC_BFPA(AUTO_IN := master, FB_IN := LIMIT(0.0, (I_BFP_A_SPEED - 1500.0) / 39.0, 100.0), FORCE_MAN := NOT I_BFP_A_RUN,
            TRK := NOT I_BFP_A_RUN, TRK_VAL := 0.0, RATE := 3.0, DTS := dts, INIT := init, INIT_KEEP := keep, JOIN := joinA,
            OUT := SC_BFPA_OUT, MODE := SC_BFPA_MODE, BIAS := SC_BFPA_BIAS, IN_TAG := SC_BFPA_IN, FB_TAG := SC_BFPA_FB, STS := SC_BFPA_STS);
    SC_BFPB(AUTO_IN := master, FB_IN := LIMIT(0.0, (I_BFP_B_SPEED - 1500.0) / 39.0, 100.0), FORCE_MAN := NOT I_BFP_B_RUN,
            TRK := NOT I_BFP_B_RUN, TRK_VAL := 0.0, RATE := 3.0, DTS := dts, INIT := init, INIT_KEEP := keep, JOIN := joinB,
            OUT := SC_BFPB_OUT, MODE := SC_BFPB_MODE, BIAS := SC_BFPB_BIAS, IN_TAG := SC_BFPB_IN, FB_TAG := SC_BFPB_FB, STS := SC_BFPB_STS);
    SC_BFPC(AUTO_IN := master, FB_IN := LIMIT(0.0, (I_BFP_C_SPEED - 1500.0) / 39.0, 100.0), FORCE_MAN := NOT I_BFP_C_RUN,
            TRK := NOT I_BFP_C_RUN, TRK_VAL := 0.0, RATE := 3.0, DTS := dts, INIT := init, INIT_KEEP := keep, JOIN := joinC,
            OUT := SC_BFPC_OUT, MODE := SC_BFPC_MODE, BIAS := SC_BFPC_BIAS, IN_TAG := SC_BFPC_IN, FB_TAG := SC_BFPC_FB, STS := SC_BFPC_STS);
    joinA := FALSE; joinB := FALSE; joinC := FALSE;
    Q_BFP_A_SPD_DMD := SC_BFPA.Q;
    Q_BFP_B_SPD_DMD := SC_BFPB.Q;
    Q_BFP_C_SPD_DMD := SC_BFPC.Q;
    (* runback only if the standby pump has not restored two running pumps within 10 s *)
    T_RBBFP(IN := nRun < 2 AND steamPct > 58.0 AND I_GCB_CLOSED, PT := 10.0, DTS := dts, INIT := init);
    RB_BFP := T_RBBFP.Q;

    (* ---- deaerator level and pressure *)
    cep := I_CEP_A_RUN OR I_CEP_B_RUN;
    LIC_DA(PV_IN := daLvl, TRK := NOT cep, TRK_VAL := 0.0,
           DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 3000.0,
           SP := LIC_DA_SP, OUT := LIC_DA_OUT, MODE := LIC_DA_MODE, KP := LIC_DA_KP, TI := LIC_DA_TI, TD := LIC_DA_TD,
           PV := LIC_DA_PV, CSP := LIC_DA_CSP, STS := LIC_DA_STS);
    Q_DA_CV_DMD := LIC_DA.Q;
    PIC_DA(PV_IN := I_DA_PRESS,
           DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 10.0,
           SP := PIC_DA_SP, OUT := PIC_DA_OUT, MODE := PIC_DA_MODE, KP := PIC_DA_KP, TI := PIC_DA_TI, TD := PIC_DA_TD,
           PV := PIC_DA_PV, CSP := PIC_DA_CSP, STS := PIC_DA_STS);
    Q_PEG_DMD := PIC_DA.Q;

    (* ---- blowdown and HP heaters *)
    EBD(OPENED_FB := I_EBD_OPEN, AUTO_OPEN := lvl > 150.0, AUTO_CLOSE := lvl < 50.0, SYNC := init,
        OPEN := EBD_OPEN, CLOSE := EBD_CLOSE, MODE := EBD_MODE, CMD := Q_EBD_CMD,
        OPENED := EBD_OPENED, CLOSED := EBD_CLOSED, PERM := EBD_PERM, ILK := EBD_ILK);
    HPH(OPENED_FB := I_HPH_IN_SERVICE, SYNC := init,
        OPEN := HPH_OPEN, CLOSE := HPH_CLOSE, MODE := HPH_MODE, CMD := Q_HPH_CMD,
        OPENED := HPH_OPENED, CLOSED := HPH_CLOSED, PERM := HPH_PERM, ILK := HPH_ILK);
    HIC_CBD(AUTO_IN := 0.0, FB_IN := I_CBD_FB, DTS := dts, INIT := init, INIT_KEEP := keepCbd,
            OUT := HIC_CBD_OUT, MODE := HIC_CBD_MODE, BIAS := HIC_CBD_BIAS, IN_TAG := HIC_CBD_IN, FB_TAG := HIC_CBD_FB, STS := HIC_CBD_STS);
    Q_CBD_DMD := HIC_CBD.Q;
  END_IF;
END_PROGRAM
