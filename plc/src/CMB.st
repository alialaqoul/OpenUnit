(* CMB - Combustion & Draft Control
   Fuel master (gas flow -> gas control valve) on the CCS boiler demand with air/fuel
   cross-limiting and elevation capacity limit; total air flow (FD master) with O2 trim and
   minimum (purge) air; furnace pressure (ID master) with FD feed-forward and an MFT kicker;
   fan start permissives and interlocks; fuel runback kicker and fan runback request.
   Naming: I_* field inputs, Q_* field outputs, P_<PEER>_* peer status, IO_* bridge signals.
   BLR_DMD_REM / CCS_BM_AUTO / CCS_HB are written into this PLC by CCS. *)
PROGRAM CMB_MAIN
(*@IO*)
  VAR
    RT : FB_PLC_RUNTIME;
    APH_A : FB_MOTOR;
    APH_B : FB_MOTOR;
    ID_A : FB_MOTOR;
    ID_B : FB_MOTOR;
    FD_A : FB_MOTOR;
    FD_B : FB_MOTOR;
    FIC_GAS : FB_LOOP;
    FIC_AIR : FB_LOOP;
    AIC_O2 : FB_LOOP;
    PIC_FURN : FB_LOOP;
    SC_FDA : FB_STATION;
    SC_FDB : FB_STATION;
    SC_IDA : FB_STATION;
    SC_IDB : FB_STATION;
    T_KICK : FB_TONS;
    dts : REAL;
    init : BOOL;
    keep : BOOL;
    bmsOk : BOOL;
    mft : BOOL;
    elevIn : DINT;
    trainOpen : BOOL;
    aph : BOOL;
    idAny : BOOL;
    fdBoth : BOOL;
    idTripPrevA : BOOL;
    idTripPrevB : BOOL;
    blrLatch : REAL;
    blr : REAL;
    gasFlow : REAL;
    air : REAL;
    capacity : REAL;
    gasByAir : REAL;
    gasRaw : REAL;
    gasDmd : REAL;
    hdr : REAL;
    gfcv : REAL;
    fuelTrk : BOOL;
    fuelTrkVal : REAL;
    fansNow : DINT;
    fansPrev : DINT;
    steamPct : REAL;
    o2Prog : REAL;
    airCas : BOOL;
    airDmd : REAL;
    nFdRun : DINT;
    nFdAuto : DINT;
    fdAvg : REAL;
    fdMaster : REAL;
    fp : REAL;
    kicking : BOOL;
    nIdRun : DINT;
    nIdAuto : DINT;
    idAvg : REAL;
    fdRef : REAL;
    ffFurn : REAL;
    gasLo : REAL;
    gasHi : REAL;
  END_VAR
  VAR CONSTANT
    GAS_LHV : REAL := 49.0;       (* MJ/kg *)
    HEAT_MCR : REAL := 1620.0;       (* MW fuel heat at 100 % boiler demand *)
    GAS_MCR : REAL := 119.0204;   (* t/h at 100 % boiler demand = HEAT_MCR / GAS_LHV * 3.6 *)
    AIR_MCR : REAL := 2247.0;     (* t/h at 100 % boiler demand *)
    STOICH : REAL := 17.15;       (* kg air / kg gas *)
    ELEV_CAP : REAL := 39.3649;   (* t/h per burner elevation in service = 0.3 * GAS_MCR *)
    MCR_STEAM : REAL := 2149.0;
  END_VAR

  (* ---------------------------------------------------------------- runtime services *)
  RT(SIM_MS := I_SIM_TIME_MS, IC_SEQ := IO_IC_SEQ, IC_ID := IO_IC_ID, IC_SNAP := IO_IC_SNAP, CYCLE_MS := 50.0,
     HEARTBEAT := HEARTBEAT, SCAN_COUNT := SCAN_COUNT, SCAN_MS := SCAN_MS, SIM_DT := SIM_DT,
     IC_APPLIED := IC_APPLIED, IC_ACK := IC_ACK);
  dts := RT.DTS;
  init := RT.IC_INIT;
  keep := IO_IC_SNAP;
  HEALTHY := IO_COMM_PLANT AND RT.READY;
  COMM_PLANT := IO_COMM_PLANT OR NOT RT.READY;   (* not reported before the bridge has initialised the PLC *)
  COMM_BMS := IO_COMM_BMS OR RT.GRACE OR NOT RT.READY;
  COMM_CCS := IO_COMM_CCS OR RT.GRACE OR NOT RT.READY;

  IF init THEN
    blrLatch := I_FUEL_HEAT / HEAT_MCR * 100.0;
    idTripPrevA := FALSE;
    idTripPrevB := FALSE;
    fansPrev := -1;
    fdRef := FIC_AIR_OUT;
  END_IF;

  (* ---------------------------------------------------------------- built-in initial condition *)
  IF RT.IC_BUILTIN THEN
    keep := TRUE;   (* fan stations: mode set here, keep their bias *)
    SC_FDA_OUT := I_FD_A_PITCH_FB;
    SC_FDB_OUT := I_FD_B_PITCH_FB;
    SC_IDA_OUT := I_ID_A_VANE_FB;
    SC_IDB_OUT := I_ID_B_VANE_FB;
    IF I_FD_A_RUN THEN SC_FDA_MODE := 1; ELSE SC_FDA_MODE := 0; END_IF;
    IF I_FD_B_RUN THEN SC_FDB_MODE := 1; ELSE SC_FDB_MODE := 0; END_IF;
    IF I_ID_A_RUN THEN SC_IDA_MODE := 1; ELSE SC_IDA_MODE := 0; END_IF;
    IF I_ID_B_RUN THEN SC_IDB_MODE := 1; ELSE SC_IDB_MODE := 0; END_IF;
    FIC_GAS_OUT := I_GFCV_FB;
    FIC_AIR_OUT := (I_FD_A_PITCH_FB + I_FD_B_PITCH_FB) / 2.0;
    PIC_FURN_OUT := (I_ID_A_VANE_FB + I_ID_B_VANE_FB) / 2.0;
    AIC_O2_OUT := 100.0;
    IF IO_IC_ID >= 4 THEN FIC_GAS_MODE := 2; AIC_O2_MODE := 1; ELSE FIC_GAS_MODE := 0; AIC_O2_MODE := 0; END_IF;
    IF IO_IC_ID >= 2 THEN FIC_AIR_MODE := 2; PIC_FURN_MODE := 1; ELSE FIC_AIR_MODE := 0; PIC_FURN_MODE := 0; END_IF;
    fdRef := FIC_AIR_OUT;
  END_IF;

  IF RT.READY THEN
    bmsOk := IO_COMM_BMS;
    IF bmsOk THEN mft := P_BMS_MFT; elevIn := P_BMS_ELEV_INSERV; ELSE mft := TRUE; elevIn := 0; END_IF;
    trainOpen := bmsOk AND P_BMS_GAS_TRAIN_OPENED;

    (* ---- fans: air heaters -> ID fans -> FD fans, vanes / pitch closed to start *)
    aph := I_APH_A_RUN OR I_APH_B_RUN;
    APH_A(RUN_FB := I_APH_A_RUN, TRIP_FB := I_APH_A_TRIP, SYNC := init,
          START := APH_A_START, STOP := APH_A_STOP, MODE := APH_A_MODE, CMD := Q_APH_A_CMD,
          RUN := APH_A_RUN, TRIP := APH_A_TRIP, PERM := APH_A_PERM, ILK_T := APH_A_ILK);
    APH_B(RUN_FB := I_APH_B_RUN, TRIP_FB := I_APH_B_TRIP, SYNC := init,
          START := APH_B_START, STOP := APH_B_STOP, MODE := APH_B_MODE, CMD := Q_APH_B_CMD,
          RUN := APH_B_RUN, TRIP := APH_B_TRIP, PERM := APH_B_PERM, ILK_T := APH_B_ILK);
    ID_A(RUN_FB := I_ID_A_RUN, TRIP_FB := I_ID_A_TRIP, PERMIT := aph AND SC_IDA_OUT <= 5.0, SYNC := init,
         START := ID_A_START, STOP := ID_A_STOP, MODE := ID_A_MODE, CMD := Q_ID_A_CMD,
         RUN := ID_A_RUN, TRIP := ID_A_TRIP, PERM := ID_A_PERM, ILK_T := ID_A_ILK);
    ID_B(RUN_FB := I_ID_B_RUN, TRIP_FB := I_ID_B_TRIP, PERMIT := aph AND SC_IDB_OUT <= 5.0, SYNC := init,
         START := ID_B_START, STOP := ID_B_STOP, MODE := ID_B_MODE, CMD := Q_ID_B_CMD,
         RUN := ID_B_RUN, TRIP := ID_B_TRIP, PERM := ID_B_PERM, ILK_T := ID_B_ILK);
    idAny := I_ID_A_RUN OR I_ID_B_RUN;
    fdBoth := I_FD_A_RUN AND I_FD_B_RUN;
    (* losing an ID fan stops its paired FD fan when both FD fans are running *)
    FD_A(RUN_FB := I_FD_A_RUN, TRIP_FB := I_FD_A_TRIP, PERMIT := idAny AND SC_FDA_OUT <= 5.0, ILK := NOT idAny,
         CMD_SET := I_ID_A_TRIP AND NOT idTripPrevA AND fdBoth, CMD_VAL := FALSE, SYNC := init,
         START := FD_A_START, STOP := FD_A_STOP, MODE := FD_A_MODE, CMD := Q_FD_A_CMD,
         RUN := FD_A_RUN, TRIP := FD_A_TRIP, PERM := FD_A_PERM, ILK_T := FD_A_ILK);
    FD_B(RUN_FB := I_FD_B_RUN, TRIP_FB := I_FD_B_TRIP, PERMIT := idAny AND SC_FDB_OUT <= 5.0, ILK := NOT idAny,
         CMD_SET := I_ID_B_TRIP AND NOT idTripPrevB AND fdBoth, CMD_VAL := FALSE, SYNC := init,
         START := FD_B_START, STOP := FD_B_STOP, MODE := FD_B_MODE, CMD := Q_FD_B_CMD,
         RUN := FD_B_RUN, TRIP := FD_B_TRIP, PERM := FD_B_PERM, ILK_T := FD_B_ILK);
    idTripPrevA := I_ID_A_TRIP;
    idTripPrevB := I_ID_B_TRIP;

    (* ---- boiler demand from the CCS boiler master (held while CCS is not writing) *)
    IF IO_COMM_CCS THEN blrLatch := BLR_DMD_REM; END_IF;
    blr := LIMIT(0.0, blrLatch, 115.0);
    BLR_DMD := blr;

    (* ---- fuel master with cross-limiting *)
    gasFlow := I_GAS_FLOW;
    air := I_AIR_FLOW;
    capacity := DINT_TO_REAL(elevIn) * ELEV_CAP;
    gasByAir := air / (STOICH * 1.07);
    gasRaw := blr / 100.0 * GAS_MCR;
    gasDmd := MAX(0.0, MIN(gasRaw, MIN(gasByAir, capacity)));
    GAS_DMD := gasDmd;
    GAS_CAPACITY := capacity;
    CROSS_LIMIT := elevIn > 0 AND gasRaw > gasByAir + 2.0;
    FUEL_HEAT_EST := gasFlow / 3.6 * GAS_LHV;
    hdr := I_GAS_HDR_PRESS;
    gfcv := I_GFCV_FB;
    fuelTrk := FALSE;
    fuelTrkVal := 0.0;
    IF mft OR NOT trainOpen THEN
      fuelTrk := TRUE;
      fuelTrkVal := 0.0;
    ELSIF elevIn = 0 THEN
      fuelTrk := TRUE;
      fuelTrkVal := LIGHTOFF_POS;
    END_IF;
    (* fuel runback kicker: losing an FD or ID fan at load cuts the gas valve at once *)
    fansNow := 0;
    IF I_FD_A_RUN THEN fansNow := fansNow + 1; END_IF;
    IF I_FD_B_RUN THEN fansNow := fansNow + 1; END_IF;
    IF I_ID_A_RUN THEN fansNow := fansNow + 1; END_IF;
    IF I_ID_B_RUN THEN fansNow := fansNow + 1; END_IF;
    IF fansPrev < 0 THEN fansPrev := fansNow; END_IF;
    IF fansNow < fansPrev AND gasFlow > 0.55 * GAS_MCR AND NOT fuelTrk THEN
      fuelTrk := TRUE;
      fuelTrkVal := FIC_GAS_OUT * 0.6;
    END_IF;
    fansPrev := fansNow;
    IF elevIn > 0 THEN gasLo := MIN_FIRE_POS; ELSE gasLo := 0.0; END_IF;
    IF hdr > 3600.0 THEN gasHi := gfcv; ELSE gasHi := 100.0; END_IF;
    FIC_GAS(PV_IN := gasFlow, CSP_IN := gasDmd, CSP_OK := TRUE, TRK := fuelTrk, TRK_VAL := fuelTrkVal, OUT_LO := gasLo, OUT_HI := gasHi,
            DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 180.0, CAS_CFG := TRUE,
            SP := FIC_GAS_SP, OUT := FIC_GAS_OUT, MODE := FIC_GAS_MODE, KP := FIC_GAS_KP, TI := FIC_GAS_TI, TD := FIC_GAS_TD,
            PV := FIC_GAS_PV, CSP := FIC_GAS_CSP, STS := FIC_GAS_STS);
    Q_GFCV_DMD := FIC_GAS.Q;
    FM_AUTO := FIC_GAS_MODE = 2 AND elevIn > 0;

    (* ---- air flow with O2 trim *)
    steamPct := I_STEAM_FLOW / MCR_STEAM * 100.0;
    o2Prog := FGEN5(X := steamPct, X1 := 0.0, Y1 := 5.0, X2 := 30.0, Y2 := 4.0, X3 := 60.0, Y3 := 2.6, X4 := 100.0, Y4 := 2.0, X5 := 100.0, Y5 := 2.0);
    IF AIC_O2_MODE <> 0 THEN AIC_O2_SP := o2Prog + O2_BIAS; END_IF;
    O2_SP_PROG := o2Prog;
    airCas := FIC_AIR_MODE = 2;
    AIC_O2(PV_IN := I_O2, TRK := mft OR elevIn = 0 OR blr < 20.0 OR NOT airCas, TRK_VAL := 100.0,
           DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 10.0, OUT_MIN := 80.0, OUT_MAX := 120.0, SP_TRACK := FALSE,
           SP := AIC_O2_SP, OUT := AIC_O2_OUT, MODE := AIC_O2_MODE, KP := AIC_O2_KP, TI := AIC_O2_TI, TD := AIC_O2_TD,
           PV := AIC_O2_PV, CSP := AIC_O2_CSP, STS := AIC_O2_STS);
    airDmd := MAX(FGEN5(X := blr, X1 := 0.0, Y1 := 30.0, X2 := 30.0, Y2 := 38.0, X3 := 60.0, Y3 := 64.0, X4 := 100.0, Y4 := 100.0, X5 := 110.0, Y5 := 110.0)
                  / 100.0 * AIR_MCR * (AIC_O2.Q / 100.0),
                  MAX(gasFlow * STOICH * 1.1, PURGE_AIR));
    AIR_DMD := airDmd;
    nFdRun := 0; nFdAuto := 0; fdAvg := 0.0;
    IF I_FD_A_RUN THEN nFdRun := nFdRun + 1; fdAvg := fdAvg + SC_FDA_OUT; IF SC_FDA_MODE = 1 THEN nFdAuto := nFdAuto + 1; END_IF; END_IF;
    IF I_FD_B_RUN THEN nFdRun := nFdRun + 1; fdAvg := fdAvg + SC_FDB_OUT; IF SC_FDB_MODE = 1 THEN nFdAuto := nFdAuto + 1; END_IF; END_IF;
    IF nFdRun > 0 THEN fdAvg := fdAvg / DINT_TO_REAL(nFdRun); END_IF;
    FIC_AIR(PV_IN := air, CSP_IN := airDmd, CSP_OK := TRUE, TRK := nFdAuto = 0, TRK_VAL := fdAvg,
            DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 3200.0, CAS_CFG := TRUE,
            SP := FIC_AIR_SP, OUT := FIC_AIR_OUT, MODE := FIC_AIR_MODE, KP := FIC_AIR_KP, TI := FIC_AIR_TI, TD := FIC_AIR_TD,
            PV := FIC_AIR_PV, CSP := FIC_AIR_CSP, STS := FIC_AIR_STS);
    fdMaster := FIC_AIR.Q;
    SC_FDA(AUTO_IN := fdMaster, FB_IN := I_FD_A_PITCH_FB, FORCE_MAN := NOT I_FD_A_RUN, TRK := NOT I_FD_A_RUN, TRK_VAL := 0.0,
           RATE := 4.0, DTS := dts, INIT := init, INIT_KEEP := keep,
           OUT := SC_FDA_OUT, MODE := SC_FDA_MODE, BIAS := SC_FDA_BIAS, IN_TAG := SC_FDA_IN, FB_TAG := SC_FDA_FB, STS := SC_FDA_STS);
    SC_FDB(AUTO_IN := fdMaster, FB_IN := I_FD_B_PITCH_FB, FORCE_MAN := NOT I_FD_B_RUN, TRK := NOT I_FD_B_RUN, TRK_VAL := 0.0,
           RATE := 4.0, DTS := dts, INIT := init, INIT_KEEP := keep,
           OUT := SC_FDB_OUT, MODE := SC_FDB_MODE, BIAS := SC_FDB_BIAS, IN_TAG := SC_FDB_IN, FB_TAG := SC_FDB_FB, STS := SC_FDB_STS);
    Q_FD_A_PITCH_DMD := SC_FDA.Q;
    Q_FD_B_PITCH_DMD := SC_FDB.Q;
    AIR_AUTO := airCas AND nFdAuto > 0;

    (* ---- furnace pressure (ID master) with FD feed-forward and MFT kicker *)
    fp := MEDIAN3(I_FURN_PRESS_A, I_FURN_PRESS_B, I_FURN_PRESS_C);
    FURN_PRESS_SEL := fp;
    kicking := mft AND T_KICK.ET < 10.0;   (* first 10 s after a master fuel trip *)
    T_KICK(IN := mft, PT := 10.0, DTS := dts, INIT := init);
    nIdRun := 0; nIdAuto := 0; idAvg := 0.0;
    IF I_ID_A_RUN THEN nIdRun := nIdRun + 1; idAvg := idAvg + SC_IDA_OUT; IF SC_IDA_MODE = 1 THEN nIdAuto := nIdAuto + 1; END_IF; END_IF;
    IF I_ID_B_RUN THEN nIdRun := nIdRun + 1; idAvg := idAvg + SC_IDB_OUT; IF SC_IDB_MODE = 1 THEN nIdAuto := nIdAuto + 1; END_IF; END_IF;
    IF nIdRun > 0 THEN idAvg := idAvg / DINT_TO_REAL(nIdRun); END_IF;
    ffFurn := 0.25 * (fdMaster - fdRef);
    IF kicking THEN ffFurn := ffFurn - 12.0; END_IF;
    IF RT.RESYNC OR nIdAuto = 0 THEN fdRef := fdMaster; END_IF;
    fdRef := fdRef + (fdMaster - fdRef) * MIN(1.0, dts / 60.0);
    PIC_FURN(PV_IN := fp, FF := ffFurn, TRK := nIdAuto = 0, TRK_VAL := idAvg,
             DTS := dts, RESYNC := RT.RESYNC, PV_MIN := -15.0, PV_MAX := 15.0, DIRECT := TRUE, SP_TRACK := FALSE,
             SP := PIC_FURN_SP, OUT := PIC_FURN_OUT, MODE := PIC_FURN_MODE, KP := PIC_FURN_KP, TI := PIC_FURN_TI, TD := PIC_FURN_TD,
             PV := PIC_FURN_PV, CSP := PIC_FURN_CSP, STS := PIC_FURN_STS);
    SC_IDA(AUTO_IN := PIC_FURN.Q, FB_IN := I_ID_A_VANE_FB, FORCE_MAN := NOT I_ID_A_RUN, TRK := NOT I_ID_A_RUN, TRK_VAL := 0.0,
           RATE := 6.0, DTS := dts, INIT := init, INIT_KEEP := keep,
           OUT := SC_IDA_OUT, MODE := SC_IDA_MODE, BIAS := SC_IDA_BIAS, IN_TAG := SC_IDA_IN, FB_TAG := SC_IDA_FB, STS := SC_IDA_STS);
    SC_IDB(AUTO_IN := PIC_FURN.Q, FB_IN := I_ID_B_VANE_FB, FORCE_MAN := NOT I_ID_B_RUN, TRK := NOT I_ID_B_RUN, TRK_VAL := 0.0,
           RATE := 6.0, DTS := dts, INIT := init, INIT_KEEP := keep,
           OUT := SC_IDB_OUT, MODE := SC_IDB_MODE, BIAS := SC_IDB_BIAS, IN_TAG := SC_IDB_IN, FB_TAG := SC_IDB_FB, STS := SC_IDB_STS);
    Q_ID_A_VANE_DMD := SC_IDA.Q;
    Q_ID_B_VANE_DMD := SC_IDB.Q;
    FURN_AUTO := PIC_FURN.AUTO AND nIdAuto > 0;

    RB_FAN := (nIdRun < 2 OR nFdRun < 2) AND steamPct > 55.0 AND I_GCB_CLOSED;
  END_IF;
END_PROGRAM
