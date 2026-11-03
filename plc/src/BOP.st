(* BOP - Balance of Plant / Turbine Auxiliaries
   Circulating water, condenser vacuum, condensate pumps, lube oil / jacking oil / turning
   gear, gland steam, vacuum breaker, hotwell level (condenser make-up).
   Naming: I_* field inputs, Q_* field outputs, P_<PEER>_* peer status, IO_* bridge signals;
   all other located variables are this controller's own Modbus registers (HMI faceplates). *)
PROGRAM BOP_MAIN
(*@IO*)
  VAR
    RT : FB_PLC_RUNTIME;
    CWP_A : FB_MOTOR;
    CWP_B : FB_MOTOR;
    VP_A : FB_MOTOR;
    VP_B : FB_MOTOR;
    CEP_A : FB_MOTOR;
    CEP_B : FB_MOTOR;
    AOP : FB_MOTOR;
    EOP : FB_MOTOR;
    JOP : FB_MOTOR;
    TG : FB_MOTOR;
    GLAND : FB_ONOFF;
    VB : FB_ONOFF;
    HW_DUMP : FB_ONOFF;
    LIC_HW : FB_LOOP;
    CEP_LOWP_TMR : FB_TONS;
    dts : REAL;
    init : BOOL;
    speed : REAL;
    condP : REAL;
    loP : REAL;
    hwLvl : REAL;
    vacPoor : BOOL;
    cepPermit : BOOL;
    cepLowP : BOOL;
    tgPermit : BOOL;
    dehTripped : BOOL;
    tripCwpA : BOOL;
    tripCwpB : BOOL;
    tripVpA : BOOL;
    tripVpB : BOOL;
    tripCepA : BOOL;
    tripCepB : BOOL;
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

  (* ---------------------------------------------------------------- built-in initial condition *)
  IF RT.IC_BUILTIN THEN
    CWP_A_MODE := 1; CWP_B_MODE := 1; VP_A_MODE := 1; VP_B_MODE := 1; CEP_A_MODE := 1; CEP_B_MODE := 1;
    AOP_MODE := 1; EOP_MODE := 1; JOP_MODE := 1; TG_MODE := 1;
    HW_DUMP_MODE := 1;
    LIC_HW_OUT := I_MAKEUP_FB;
    IF IO_IC_ID >= 2 THEN
      LIC_HW_MODE := 1;
    ELSE
      LIC_HW_MODE := 0;
    END_IF;
  END_IF;

  IF RT.READY THEN
    speed := MEDIAN3(I_SPEED_A, I_SPEED_B, I_SPEED_C);
    condP := I_COND_PRESS;
    loP := I_LO_PRESS;
    hwLvl := I_HW_LVL;

    (* Standby pumps start on the latched trip of the duty pump (cleared by the operator's STOP) *)
    tripCwpA := I_CWP_A_TRIP OR (CWP_A.LATCHED AND NOT init);
    tripCwpB := I_CWP_B_TRIP OR (CWP_B.LATCHED AND NOT init);
    tripVpA := I_VP_A_TRIP OR (VP_A.LATCHED AND NOT init);
    tripVpB := I_VP_B_TRIP OR (VP_B.LATCHED AND NOT init);
    tripCepA := I_CEP_A_TRIP OR (CEP_A.LATCHED AND NOT init);
    tripCepB := I_CEP_B_TRIP OR (CEP_B.LATCHED AND NOT init);

    (* ---- circulating water: the standby pump starts when the duty pump trips *)
    CWP_A(RUN_FB := I_CWP_A_RUN, TRIP_FB := I_CWP_A_TRIP, AUTO_START := tripCwpB, SYNC := init,
          START := CWP_A_START, STOP := CWP_A_STOP, MODE := CWP_A_MODE, CMD := Q_CWP_A_CMD,
          RUN := CWP_A_RUN, TRIP := CWP_A_TRIP, PERM := CWP_A_PERM, ILK_T := CWP_A_ILK);
    CWP_B(RUN_FB := I_CWP_B_RUN, TRIP_FB := I_CWP_B_TRIP, AUTO_START := tripCwpA, SYNC := init,
          START := CWP_B_START, STOP := CWP_B_STOP, MODE := CWP_B_MODE, CMD := Q_CWP_B_CMD,
          RUN := CWP_B_RUN, TRIP := CWP_B_TRIP, PERM := CWP_B_PERM, ILK_T := CWP_B_ILK);

    (* ---- vacuum pumps: standby starts on partner trip or poor vacuum *)
    vacPoor := condP > 150.0 AND I_GLAND_ON;
    VP_A(RUN_FB := I_VP_A_RUN, TRIP_FB := I_VP_A_TRIP, AUTO_START := tripVpB OR (vacPoor AND I_VP_B_RUN), SYNC := init,
         START := VP_A_START, STOP := VP_A_STOP, MODE := VP_A_MODE, CMD := Q_VP_A_CMD,
         RUN := VP_A_RUN, TRIP := VP_A_TRIP, PERM := VP_A_PERM, ILK_T := VP_A_ILK);
    VP_B(RUN_FB := I_VP_B_RUN, TRIP_FB := I_VP_B_TRIP, AUTO_START := tripVpA OR (vacPoor AND I_VP_A_RUN), SYNC := init,
         START := VP_B_START, STOP := VP_B_STOP, MODE := VP_B_MODE, CMD := Q_VP_B_CMD,
         RUN := VP_B_RUN, TRIP := VP_B_TRIP, PERM := VP_B_PERM, ILK_T := VP_B_ILK);

    (* ---- condensate pumps: need hotwell level; standby starts on trip or low discharge pressure *)
    cepPermit := hwLvl > 300.0;
    CEP_LOWP_TMR(IN := I_CEP_PRESS < 12.0 AND (I_CEP_A_RUN OR I_CEP_B_RUN), PT := 5.0, DTS := dts, INIT := init);
    cepLowP := CEP_LOWP_TMR.Q;
    CEP_A(RUN_FB := I_CEP_A_RUN, TRIP_FB := I_CEP_A_TRIP, PERMIT := cepPermit, AUTO_START := tripCepB OR (cepLowP AND I_CEP_B_RUN), SYNC := init,
          START := CEP_A_START, STOP := CEP_A_STOP, MODE := CEP_A_MODE, CMD := Q_CEP_A_CMD,
          RUN := CEP_A_RUN, TRIP := CEP_A_TRIP, PERM := CEP_A_PERM, ILK_T := CEP_A_ILK);
    CEP_B(RUN_FB := I_CEP_B_RUN, TRIP_FB := I_CEP_B_TRIP, PERMIT := cepPermit, AUTO_START := tripCepA OR (cepLowP AND I_CEP_A_RUN), SYNC := init,
          START := CEP_B_START, STOP := CEP_B_STOP, MODE := CEP_B_MODE, CMD := Q_CEP_B_CMD,
          RUN := CEP_B_RUN, TRIP := CEP_B_TRIP, PERM := CEP_B_PERM, ILK_T := CEP_B_ILK);

    (* ---- lube oil, jacking oil, turning gear *)
    AOP(RUN_FB := I_AOP_RUN, TRIP_FB := I_AOP_TRIP, AUTO_START := loP < 1.0, SYNC := init,
        START := AOP_START, STOP := AOP_STOP, MODE := AOP_MODE, CMD := Q_AOP_CMD,
        RUN := AOP_RUN, TRIP := AOP_TRIP, PERM := AOP_PERM, ILK_T := AOP_ILK);
    EOP(RUN_FB := I_EOP_RUN, TRIP_FB := I_EOP_TRIP, AUTO_START := loP < 0.7, SYNC := init,
        START := EOP_START, STOP := EOP_STOP, MODE := EOP_MODE, CMD := Q_EOP_CMD,
        RUN := EOP_RUN, TRIP := EOP_TRIP, PERM := EOP_PERM, ILK_T := EOP_ILK);
    JOP(RUN_FB := I_JOP_RUN, TRIP_FB := I_JOP_TRIP, AUTO_START := speed < 600.0 AND loP > 0.5, AUTO_STOP := speed > 700.0, SYNC := init,
        START := JOP_START, STOP := JOP_STOP, MODE := JOP_MODE, CMD := Q_JOP_CMD,
        RUN := JOP_RUN, TRIP := JOP_TRIP, PERM := JOP_PERM, ILK_T := JOP_ILK);
    tgPermit := speed < 5.0 AND I_JOP_RUN AND loP > 1.0;
    TG(RUN_FB := I_TG_RUN, TRIP_FB := I_TG_TRIP, PERMIT := tgPermit OR I_TG_RUN, AUTO_START := tgPermit, ILK := loP < 0.5, SYNC := init,
       START := TG_START, STOP := TG_STOP, MODE := TG_MODE, CMD := Q_TG_CMD,
       RUN := TG_RUN, TRIP := TG_TRIP, PERM := TG_PERM, ILK_T := TG_ILK);

    (* ---- gland steam, vacuum breaker (only with the turbine tripped and below 2400 rpm), hotwell dump *)
    GLAND(OPENED_FB := I_GLAND_ON, SYNC := init,
          OPEN := GLAND_OPEN, CLOSE := GLAND_CLOSE, MODE := GLAND_MODE, CMD := Q_GLAND_CMD,
          OPENED := GLAND_OPENED, CLOSED := GLAND_CLOSED, PERM := GLAND_PERM, ILK := GLAND_ILK);
    IF IO_COMM_DEH THEN
      dehTripped := P_DEH_TRIPPED;
    ELSE
      dehTripped := TRUE;
    END_IF;
    VB(OPENED_FB := I_VB_OPEN, PERMIT := dehTripped AND speed < 2400.0, SYNC := init,
       OPEN := VB_OPEN, CLOSE := VB_CLOSE, MODE := VB_MODE, CMD := Q_VB_CMD,
       OPENED := VB_OPENED, CLOSED := VB_CLOSED, PERM := VB_PERM, ILK := VB_ILK);
    HW_DUMP(OPENED_FB := I_HW_DUMP_OPEN, AUTO_OPEN := hwLvl > 1100.0, AUTO_CLOSE := hwLvl < 900.0, SYNC := init,
            OPEN := HW_DUMP_OPEN, CLOSE := HW_DUMP_CLOSE, MODE := HW_DUMP_MODE, CMD := Q_HW_DUMP_CMD,
            OPENED := HW_DUMP_OPENED, CLOSED := HW_DUMP_CLOSED, PERM := HW_DUMP_PERM, ILK := HW_DUMP_ILK);

    (* ---- hotwell level via condenser make-up *)
    LIC_HW(PV_IN := hwLvl, DTS := dts, RESYNC := RT.RESYNC, PV_MIN := 0.0, PV_MAX := 1500.0,
           SP := LIC_HW_SP, OUT := LIC_HW_OUT, MODE := LIC_HW_MODE, KP := LIC_HW_KP, TI := LIC_HW_TI, TD := LIC_HW_TD,
           PV := LIC_HW_PV, CSP := LIC_HW_CSP, STS := LIC_HW_STS);
    Q_MAKEUP_DMD := LIC_HW.Q;

    VAC_OK := condP < 200.0;
    CW_OK := I_CWP_A_RUN OR I_CWP_B_RUN;
    LO_OK := loP > 1.0;
    COND_PRESS := condP;
  END_IF;
END_PROGRAM
