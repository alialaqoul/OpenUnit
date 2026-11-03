(* BMS - Burner Management System (NFPA 85 style)
   Master fuel trip (MFT) with first-out cause, furnace purge (5 min) with permissives, gas
   fuel train (main gas trip valves / vent: double block and bleed), four burner elevation
   light-off sequences (igniter -> main flame proving -> in service, flame failure trips the
   elevation), light-off time limit, watchdog to the hardwired MFT relay in the field.
   The four elevations A..D are processed in a FOR loop over arrays 1..4: their field I/O is
   copied in at the top and out at the bottom.
   Naming: I_* field inputs, Q_* field outputs, P_<PEER>_* peer status, IO_* bridge signals. *)
PROGRAM BMS_MAIN
(*@IO*)
  VAR
    RT : FB_PLC_RUNTIME;
    T_AIRLOW : FB_TONS;
    T_LVLHH : FB_TONS;
    T_LVLLL : FB_TONS;
    T_FLAMELOSS : FB_TONS;
    T_FUELLOSS : FB_TONS;
    T_BFPLOSS : FB_TONS;
    T_HDRLL : FB_TONS;
    T_HDRHH : FB_TONS;
    T_SUPLOW : FB_TONS;
    dts : REAL;
    init : BOOL;
    (* process values *)
    idRun : BOOL;
    fdRun : BOOL;
    airPct : REAL;
    fp : REAL;
    lvl : REAL;
    hdr : REAL;
    sup : REAL;
    anyFlame : BOOL;
    anyBrnOpen : BOOL;
    nInService : DINT;
    bfpAny : BOOL;
    dehTripped : BOOL;
    dehTripPrev : BOOL;
    mgtvOpen : BOOL;
    (* MFT *)
    c : ARRAY[1..18] OF BOOL;   (* MFT conditions, by first-out cause number *)
    firstOut : DINT;
    mftOn : BOOL;
    cause : DINT;
    fuelWas : BOOL;
    lightoffT : REAL;
    lastFuel : REAL;
    (* purge *)
    ppFans : BOOL;
    ppAir : BOOL;
    ppFuelOff : BOOL;
    ppFurn : BOOL;
    ppDrum : BOOL;
    ppNoTrip : BOOL;
    ready : BOOL;
    purgeActive : BOOL;
    purgeT : REAL;
    purgeComplete : BOOL;
    (* gas train: 0 CLOSED, 1 OPENING, 2 OPEN, 3 TRIPPED *)
    trainState : DINT;
    trainT : REAL;
    trainPerm : BOOL;
    trainCmd : BOOL;
    trainOpen : BOOL;
    (* elevations: state 0 OFF, 1 STARTING, 2 IN SERVICE, 3 STOPPING, 4 FLAME FAIL *)
    x : INT;
    elevPerm : BOOL;
    eState : ARRAY[1..4] OF DINT;
    eT : ARRAY[1..4] OF REAL;
    eIgn : ARRAY[1..4] OF BOOL;
    eBrn : ARRAY[1..4] OF BOOL;
    eLossT : ARRAY[1..4] OF REAL;
    flame : ARRAY[1..4] OF BOOL;
    ignFlame : ARRAY[1..4] OF BOOL;
    brnOpen : ARRAY[1..4] OF BOOL;
    startPb : ARRAY[1..4] OF BOOL;
    stopPb : ARRAY[1..4] OF BOOL;
    fired : BOOL;
  END_VAR
  VAR CONSTANT
    AIR_MCR : REAL := 2247.0;       (* t/h *)
    PURGE_TIME : REAL := 300.0;     (* s *)
    LIGHTOFF_TIME : REAL := 900.0;  (* s *)
    S_OFF : DINT := 0;
    S_STARTING : DINT := 1;
    S_IN_SERVICE : DINT := 2;
    S_STOPPING : DINT := 3;
    S_FAIL : DINT := 4;
    TR_CLOSED : DINT := 0;
    TR_OPENING : DINT := 1;
    TR_OPEN : DINT := 2;
    TR_TRIPPED : DINT := 3;
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

  (* field I/O of the four elevations -> arrays *)
  flame[1] := I_FLAME_A; flame[2] := I_FLAME_B; flame[3] := I_FLAME_C; flame[4] := I_FLAME_D;
  ignFlame[1] := I_IGN_A_FLAME; ignFlame[2] := I_IGN_B_FLAME; ignFlame[3] := I_IGN_C_FLAME; ignFlame[4] := I_IGN_D_FLAME;
  brnOpen[1] := I_BRN_A_OPEN; brnOpen[2] := I_BRN_B_OPEN; brnOpen[3] := I_BRN_C_OPEN; brnOpen[4] := I_BRN_D_OPEN;
  startPb[1] := ELEV_A_START; startPb[2] := ELEV_B_START; startPb[3] := ELEV_C_START; startPb[4] := ELEV_D_START;
  stopPb[1] := ELEV_A_STOP; stopPb[2] := ELEV_B_STOP; stopPb[3] := ELEV_C_STOP; stopPb[4] := ELEV_D_STOP;

  (* ---------------------------------------------------------------- initial condition *)
  (* The firing state follows the plant: a fired boiler is on line with its burning elevations
     in service, otherwise the BMS starts tripped (cause 15, power-up) and needs a purge. *)
  IF init THEN
    fired := I_FLAME_A OR I_FLAME_B OR I_FLAME_C OR I_FLAME_D;
    purgeActive := FALSE;
    purgeT := 0.0;
    purgeComplete := FALSE;
    lightoffT := 0.0;
    dehTripPrev := FALSE;
    IF fired THEN
      mftOn := FALSE;
      cause := 0;
      fuelWas := TRUE;
      trainState := TR_OPEN;
    ELSE
      mftOn := TRUE;
      cause := 15;
      fuelWas := FALSE;
      trainState := TR_TRIPPED;
    END_IF;
    trainT := 0.0;
    FOR x := 1 TO 4 DO
      IF flame[x] THEN eState[x] := S_IN_SERVICE; ELSE eState[x] := S_OFF; END_IF;
      eT[x] := 60.0;
      eIgn[x] := FALSE;
      eBrn[x] := flame[x];
      eLossT[x] := 0.0;
    END_FOR;
    lastFuel := I_FUEL_HEAT;
  END_IF;

  IF RT.READY THEN
    idRun := I_ID_A_RUN OR I_ID_B_RUN;
    fdRun := I_FD_A_RUN OR I_FD_B_RUN;
    airPct := I_AIR_FLOW / AIR_MCR * 100.0;
    fp := MEDIAN3(I_FURN_PRESS_A, I_FURN_PRESS_B, I_FURN_PRESS_C);
    lvl := MEDIAN3(I_DRUM_LVL_A, I_DRUM_LVL_B, I_DRUM_LVL_C);
    hdr := I_GAS_HDR_PRESS;
    sup := I_GAS_SUPPLY_PRESS;
    anyFlame := FALSE;
    anyBrnOpen := FALSE;
    nInService := 0;
    FOR x := 1 TO 4 DO
      anyFlame := anyFlame OR flame[x];
      anyBrnOpen := anyBrnOpen OR brnOpen[x] OR eBrn[x];
      IF eState[x] = S_IN_SERVICE THEN nInService := nInService + 1; END_IF;
    END_FOR;
    bfpAny := I_BFP_A_RUN OR I_BFP_B_RUN OR I_BFP_C_RUN;
    dehTripped := IO_COMM_DEH AND P_DEH_TRIPPED;
    mgtvOpen := I_MGTV_OPEN;

    (* ---------------------------------------------------------------- MFT conditions *)
    T_AIRLOW(IN := airPct < 25.0, PT := 3.0, DTS := dts, INIT := init);
    T_LVLHH(IN := VOTE2OO3(I_DRUM_LVL_A > 250.0, I_DRUM_LVL_B > 250.0, I_DRUM_LVL_C > 250.0), PT := 3.0, DTS := dts, INIT := init);
    T_LVLLL(IN := VOTE2OO3(I_DRUM_LVL_A < -300.0, I_DRUM_LVL_B < -300.0, I_DRUM_LVL_C < -300.0), PT := 3.0, DTS := dts, INIT := init);
    T_FLAMELOSS(IN := anyBrnOpen AND NOT anyFlame, PT := 5.0, DTS := dts, INIT := init);
    T_FUELLOSS(IN := fuelWas AND NOT anyBrnOpen, PT := 2.0, DTS := dts, INIT := init);
    T_BFPLOSS(IN := fuelWas AND NOT bfpAny, PT := 10.0, DTS := dts, INIT := init);
    T_HDRLL(IN := nInService > 0 AND hdr < 120.0, PT := 2.0, DTS := dts, INIT := init);
    T_HDRHH(IN := mgtvOpen AND hdr > 4500.0, PT := 1.0, DTS := dts, INIT := init);
    T_SUPLOW(IN := mgtvOpen AND sup < 12.0, PT := 3.0, DTS := dts, INIT := init);
    c[1] := MFT_PB;                                                              (* manual *)
    c[2] := NOT idRun;                                                           (* both ID fans off *)
    c[3] := NOT fdRun;                                                           (* both FD fans off *)
    c[4] := T_AIRLOW.Q;                                                          (* air flow < 25 % *)
    c[5] := VOTE2OO3(I_FURN_PRESS_A > 20.0, I_FURN_PRESS_B > 20.0, I_FURN_PRESS_C > 20.0);    (* furnace HH *)
    c[6] := VOTE2OO3(I_FURN_PRESS_A < -25.0, I_FURN_PRESS_B < -25.0, I_FURN_PRESS_C < -25.0); (* furnace LL *)
    c[7] := T_LVLHH.Q;                                                           (* drum level HH *)
    c[8] := T_LVLLL.Q;                                                           (* drum level LL *)
    c[9] := T_FLAMELOSS.Q;                                                       (* loss of all flame *)
    c[10] := T_FUELLOSS.Q;                                                       (* loss of all fuel *)
    c[11] := dehTripped AND NOT dehTripPrev AND lastFuel > 0.4 * 1620.0;         (* turbine trip, firing > bypass *)
    c[12] := T_BFPLOSS.Q;                                                        (* all BFPs off *)
    c[13] := NOT mftOn AND NOT fuelWas AND lightoffT > LIGHTOFF_TIME;              (* light-off time expired *)
    c[14] := I_BMS_WD_FAIL;                                                      (* watchdog / field I/O *)
    c[15] := FALSE;                                                              (* power-up: set at initialisation *)
    c[16] := T_HDRLL.Q;                                                          (* gas header LL *)
    c[17] := T_HDRHH.Q;                                                          (* gas header HH *)
    c[18] := T_SUPLOW.Q;                                                         (* gas supply low *)
    dehTripPrev := dehTripped;
    lastFuel := I_FUEL_HEAT;
    IF NOT mftOn THEN
      lightoffT := lightoffT + dts;
      firstOut := FIRST_OUT(C1 := c[1], C2 := c[2], C3 := c[3], C4 := c[4], C5 := c[5], C6 := c[6], C7 := c[7], C8 := c[8], C9 := c[9],
                            C10 := c[10], C11 := c[11], C12 := c[12], C13 := c[13], C14 := c[14], C15 := c[15], C16 := c[16], C17 := c[17],
                            C18 := c[18]);
      IF firstOut > 0 THEN
        (* trip: first-out cause, purge lost, all elevations off *)
        mftOn := TRUE;
        cause := firstOut;
        purgeActive := FALSE;
        purgeT := 0.0;
        purgeComplete := FALSE;
        fuelWas := FALSE;
        FOR x := 1 TO 4 DO
          eState[x] := S_OFF;
          eIgn[x] := FALSE;
          eBrn[x] := FALSE;
        END_FOR;
      END_IF;
    END_IF;

    (* ---------------------------------------------------------------- purge *)
    ppFans := idRun AND fdRun;
    ppAir := airPct >= 25.0 AND airPct <= 40.0;
    ppFuelOff := I_MGTV_CLOSED;
    FOR x := 1 TO 4 DO
      ppFuelOff := ppFuelOff AND NOT brnOpen[x] AND NOT eIgn[x];
    END_FOR;
    ppFurn := ABS(fp) < 5.0;
    ppDrum := lvl > -250.0 AND lvl < 200.0;
    ppNoTrip := NOT (c[2] OR c[3] OR c[5] OR c[6] OR c[7] OR c[8] OR c[14]);
    PP_FANS := ppFans;
    PP_AIR := ppAir;
    PP_FUEL_OFF := ppFuelOff;
    PP_FURN := ppFurn;
    PP_DRUM := ppDrum;
    PP_NO_TRIP := ppNoTrip;
    ready := mftOn AND ppFans AND ppAir AND ppFuelOff AND ppFurn AND ppDrum AND ppNoTrip;
    IF PURGE_START AND ready AND NOT purgeComplete THEN
      purgeActive := TRUE;
      purgeT := 0.0;
      purgeComplete := FALSE;
    END_IF;
    IF purgeActive THEN
      IF NOT ready THEN
        purgeActive := FALSE;
      ELSE
        purgeT := purgeT + dts;
        IF purgeT >= PURGE_TIME THEN
          purgeActive := FALSE;
          purgeT := PURGE_TIME;
          purgeComplete := TRUE;
        END_IF;
      END_IF;
    END_IF;
    IF MFT_RESET AND mftOn AND purgeComplete AND ppNoTrip THEN
      mftOn := FALSE;
      cause := 0;
      purgeActive := FALSE;
      purgeT := 0.0;
      purgeComplete := FALSE;
      lightoffT := 0.0;
      fuelWas := FALSE;
      trainState := TR_CLOSED;
      trainT := 0.0;
    END_IF;

    (* ---------------------------------------------------------------- gas fuel train *)
    trainPerm := NOT mftOn AND sup > 16.0 AND I_MGTV_CLOSED;
    IF GAS_TRAIN_OPEN AND trainPerm AND trainState = TR_CLOSED THEN
      trainState := TR_OPENING;
      trainT := 0.0;
    END_IF;
    IF GAS_TRAIN_CLOSE AND nInService = 0 THEN
      trainState := TR_CLOSED;
      trainT := 0.0;
    END_IF;
    IF mftOn AND trainState <> TR_TRIPPED THEN
      trainState := TR_TRIPPED;
      trainT := 0.0;
    END_IF;
    IF trainState = TR_OPENING THEN
      trainT := trainT + dts;
      IF mgtvOpen THEN
        trainState := TR_OPEN;
      ELSIF trainT > 10.0 THEN
        trainState := TR_CLOSED;
        trainT := 0.0;
      END_IF;
    END_IF;
    trainCmd := trainState = TR_OPENING OR trainState = TR_OPEN;
    Q_MGTV_CMD := trainCmd;
    Q_GAS_VENT_CMD := NOT trainCmd;
    trainOpen := trainState = TR_OPEN AND mgtvOpen AND NOT I_GAS_VENT_OPEN;
    GAS_TRAIN_STATE := trainState;
    GAS_TRAIN_PERM := trainPerm;
    GAS_TRAIN_OPENED := trainOpen;

    (* ---------------------------------------------------------------- burner elevations *)
    elevPerm := NOT mftOn AND trainOpen AND airPct > 25.0 AND hdr > 150.0 AND hdr < 3000.0 AND ABS(fp) < 10.0;
    FOR x := 1 TO 4 DO
      IF startPb[x] AND elevPerm AND (eState[x] = S_OFF OR eState[x] = S_FAIL) THEN
        eState[x] := S_STARTING;
        eT[x] := 0.0;
      END_IF;
      IF stopPb[x] THEN
        IF eState[x] = S_STARTING OR eState[x] = S_IN_SERVICE THEN
          eState[x] := S_STOPPING;
          eT[x] := 0.0;
        ELSIF eState[x] = S_FAIL THEN
          eState[x] := S_OFF;
        END_IF;
      END_IF;
      eT[x] := eT[x] + dts;
      CASE eState[x] OF
        1: (* STARTING: igniter, then main burner valves once the igniter flame is proven *)
          eIgn[x] := TRUE;
          IF eT[x] > 6.0 AND NOT ignFlame[x] THEN
            eState[x] := S_FAIL; eIgn[x] := FALSE; eBrn[x] := FALSE; eT[x] := 0.0;   (* igniter flame not proven *)
          ELSIF ignFlame[x] THEN
            eBrn[x] := TRUE;
          END_IF;
          IF eState[x] = S_STARTING AND eBrn[x] AND flame[x] AND eT[x] > 5.0 THEN
            eState[x] := S_IN_SERVICE;
            eT[x] := 0.0;
          ELSIF eState[x] = S_STARTING AND eT[x] > 15.0 THEN
            eState[x] := S_FAIL; eIgn[x] := FALSE; eBrn[x] := FALSE; eT[x] := 0.0;   (* main flame not proven *)
          END_IF;
        2: (* IN SERVICE: igniter off after 10 s, 2 s loss of flame trips the elevation *)
          eBrn[x] := TRUE;
          eIgn[x] := eT[x] < 10.0;
          IF NOT flame[x] THEN eLossT[x] := MIN(2.0, eLossT[x] + dts); ELSE eLossT[x] := 0.0; END_IF;
          IF NOT flame[x] AND eLossT[x] >= 2.0 THEN
            eState[x] := S_FAIL; eIgn[x] := FALSE; eBrn[x] := FALSE; eT[x] := 0.0;   (* loss of flame *)
          END_IF;
        3: (* STOPPING *)
          eBrn[x] := FALSE;
          eIgn[x] := FALSE;
          IF eT[x] > 3.0 THEN eState[x] := S_OFF; END_IF;
      ELSE
        eBrn[x] := FALSE;
        eIgn[x] := FALSE;
      END_CASE;
      IF eState[x] <> S_IN_SERVICE THEN eLossT[x] := 0.0; END_IF;
      IF mftOn THEN
        eBrn[x] := FALSE;
        eIgn[x] := FALSE;
        IF eState[x] <> S_FAIL THEN eState[x] := S_OFF; END_IF;
      END_IF;
    END_FOR;
    nInService := 0;
    FOR x := 1 TO 4 DO
      IF eState[x] = S_IN_SERVICE THEN nInService := nInService + 1; END_IF;
    END_FOR;
    IF nInService > 0 THEN fuelWas := TRUE; END_IF;

    (* arrays -> field outputs and faceplate status *)
    Q_IGN_A_CMD := eIgn[1]; Q_IGN_B_CMD := eIgn[2]; Q_IGN_C_CMD := eIgn[3]; Q_IGN_D_CMD := eIgn[4];
    Q_BRN_A_CMD := eBrn[1]; Q_BRN_B_CMD := eBrn[2]; Q_BRN_C_CMD := eBrn[3]; Q_BRN_D_CMD := eBrn[4];
    ELEV_A_STATE := eState[1]; ELEV_B_STATE := eState[2]; ELEV_C_STATE := eState[3]; ELEV_D_STATE := eState[4];
    ELEV_A_INSERV := eState[1] = S_IN_SERVICE; ELEV_B_INSERV := eState[2] = S_IN_SERVICE;
    ELEV_C_INSERV := eState[3] = S_IN_SERVICE; ELEV_D_INSERV := eState[4] = S_IN_SERVICE;
    ELEV_A_FAIL := eState[1] = S_FAIL; ELEV_B_FAIL := eState[2] = S_FAIL;
    ELEV_C_FAIL := eState[3] = S_FAIL; ELEV_D_FAIL := eState[4] = S_FAIL;
    ELEV_A_PERM := elevPerm; ELEV_B_PERM := elevPerm; ELEV_C_PERM := elevPerm; ELEV_D_PERM := elevPerm;

    (* ---------------------------------------------------------------- outputs & status *)
    Q_MFT_TRIP := mftOn;
    MFT := mftOn;
    MFT_CAUSE := cause;
    PURGE_READY := ready;
    PURGE_ACTIVE := purgeActive;
    PURGE_COMPLETE := purgeComplete;
    IF purgeComplete THEN PURGE_REMAIN := 0.0; ELSE PURGE_REMAIN := PURGE_TIME - purgeT; END_IF;
    IF mftOn OR fuelWas THEN LIGHTOFF_REMAIN := 0.0; ELSE LIGHTOFF_REMAIN := MAX(0.0, LIGHTOFF_TIME - lightoffT); END_IF;
    FUEL_IN_SERVICE := nInService > 0;
    ELEV_INSERV := nInService;
    IF anyFlame THEN FIREBALL := MIN(100.0, I_FUEL_HEAT / 1620.0 * 110.0); ELSE FIREBALL := 0.0; END_IF;
  END_IF;

  (* watchdog to the hardwired MFT relay: the field trips the boiler if this stops changing *)
  Q_BMS_WD := HEARTBEAT;

  (* operator pulses are consumed in the scan they arrive *)
  MFT_PB := FALSE;
  PURGE_START := FALSE;
  MFT_RESET := FALSE;
  GAS_TRAIN_OPEN := FALSE;
  GAS_TRAIN_CLOSE := FALSE;
  ELEV_A_START := FALSE; ELEV_B_START := FALSE; ELEV_C_START := FALSE; ELEV_D_START := FALSE;
  ELEV_A_STOP := FALSE; ELEV_B_STOP := FALSE; ELEV_C_STOP := FALSE; ELEV_D_STOP := FALSE;
END_PROGRAM
