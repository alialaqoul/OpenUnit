(* PID loop bound to its faceplate tags (<loop>_PV/_SP/_OUT/_MODE/_KP/_TI/_TD/_CSP/_STS).
   Ideal (ISA) PID working in % of span, back-calculation anti-windup, derivative on
   measurement with a 0.1*TD filter, feed-forward and bumpless MAN/AUTO/CAS transfer.
   MODE: 0 MAN, 1 AUTO, 2 CAS.  STS bits: 1 interlock, 2 tracking, 4 high limit, 8 low limit,
   16 cascade setpoint available.  Mirrors Loop + PID in the JavaScript controller runtime. *)
FUNCTION_BLOCK FB_LOOP
  VAR_INPUT
    PV_IN : REAL;              (* process value, engineering units *)
    CSP_IN : REAL;             (* cascade / remote setpoint *)
    CSP_OK : BOOL;             (* remote setpoint supplied and available *)
    FF : REAL;                 (* feed-forward, output engineering units *)
    FORCE_MAN : BOOL;          (* interlock: force manual *)
    TRK : BOOL;                (* track TRK_VAL *)
    TRK_VAL : REAL;
    OUT_HI : REAL := 1.0E30;   (* dynamic output limits, engineering units *)
    OUT_LO : REAL := -1.0E30;
    SP_LO : REAL := -1.0E30;
    SP_HI : REAL := 1.0E30;
    DTS : REAL;                (* simulation time step, s *)
    RESYNC : BOOL;             (* first scan after start-up / initial condition *)
    PV_MIN : REAL := 0.0;      (* configuration from the register map *)
    PV_MAX : REAL := 100.0;
    OUT_MIN : REAL := 0.0;
    OUT_MAX : REAL := 100.0;
    DIRECT : BOOL;             (* direct acting: output rises when PV > SP *)
    SP_TRACK : BOOL := TRUE;   (* setpoint tracks PV in manual *)
    CAS_CFG : BOOL;            (* loop has a cascade input *)
    REF_DT : REAL;             (* > 0: detune when the step exceeds REF_DT (fast time) *)
  END_VAR
  VAR_IN_OUT
    SP : REAL;
    OUT : REAL;
    MODE : DINT;
    KP : REAL;
    TI : REAL;
    TD : REAL;
    PV : REAL;
    CSP : REAL;
    STS : DINT;
  END_VAR
  VAR_OUTPUT
    Q : REAL;                  (* output, engineering units *)
    AUTO : BOOL;               (* not in manual *)
  END_VAR
  VAR
    integ : REAL;
    outPct : REAL;
    prevPv : REAL;
    havePrev : BOOL;
    dState : REAL;
    lastMode : DINT;
    wasTracking : BOOL;
    slow : REAL;
    kpE : REAL;
    tiE : REAL;
    tdE : REAL;
    m : DINT;
    stsW : DINT;
    casOk : BOOL;
    spv : REAL;
    spanO : REAL;
    spanP : REAL;
    ffPct : REAL;
    hiPct : REAL;
    loPct : REAL;
    err : REAL;
    trkPct : REAL;
    p : REAL;
    d : REAL;
    dpv : REAL;
    raw : REAL;
    alpha : REAL;
    hi : REAL;
    lo : REAL;
    unc : REAL;
    doTrack : BOOL;
  END_VAR

  slow := 1.0;
  IF REF_DT > 0.0 AND DTS > REF_DT THEN
    slow := REF_DT / DTS;
  END_IF;
  kpE := MAX(0.0, KP) * slow;
  tiE := MAX(0.0, TI) / slow;
  tdE := MAX(0.0, TD);

  m := MODE;
  IF m > 2 OR m < 0 THEN
    m := 0;
  END_IF;
  stsW := 0;
  IF FORCE_MAN THEN
    m := 0;
    stsW := stsW + 1;
  END_IF;
  casOk := CAS_CFG AND CSP_OK;
  IF casOk THEN
    stsW := stsW + 16;
  END_IF;
  IF m = 2 AND NOT casOk THEN
    m := 1;
  END_IF;
  spv := SP;
  IF m = 2 THEN
    spv := CSP_IN;
  END_IF;
  spv := LIMIT(SP_LO, spv, SP_HI);

  spanO := OUT_MAX - OUT_MIN;
  IF spanO = 0.0 THEN
    spanO := 1.0;
  END_IF;
  spanP := PV_MAX - PV_MIN;
  IF spanP = 0.0 THEN
    spanP := 1.0;
  END_IF;
  ffPct := FF / spanO * 100.0;
  hiPct := 100.0;
  IF OUT_HI < 1.0E29 THEN
    hiPct := (MIN(OUT_HI, OUT_MAX) - OUT_MIN) / spanO * 100.0;
  END_IF;
  loPct := 0.0;
  IF OUT_LO > -1.0E29 THEN
    loPct := (MAX(OUT_LO, OUT_MIN) - OUT_MIN) / spanO * 100.0;
  END_IF;
  err := (spv - PV_IN) / spanP * 100.0;
  IF DIRECT THEN
    err := -err;
  END_IF;

  (* Tracking / manual: force the output and back-calculate the integrator *)
  doTrack := FALSE;
  IF TRK THEN
    trkPct := (TRK_VAL - OUT_MIN) / spanO * 100.0;
    doTrack := TRUE;
    stsW := stsW + 2;
  ELSIF m = 0 THEN
    trkPct := LIMIT(loPct, (OUT - OUT_MIN) / spanO * 100.0, hiPct);
    doTrack := TRUE;
  ELSIF RESYNC OR lastMode = 0 OR wasTracking THEN
    trkPct := (OUT - OUT_MIN) / spanO * 100.0;
    doTrack := TRUE;
  END_IF;
  IF doTrack THEN
    outPct := LIMIT(0.0, trkPct, 100.0);
    integ := outPct - kpE * err - ffPct;
    prevPv := PV_IN;
    havePrev := TRUE;
    dState := 0.0;
  END_IF;

  IF TRK THEN
    IF m = 0 AND SP_TRACK THEN
      spv := PV_IN;
    END_IF;
  ELSIF m = 0 THEN
    IF SP_TRACK THEN
      spv := LIMIT(SP_LO, PV_IN, SP_HI);
    END_IF;
  ELSE
    (* Automatic: PID update *)
    IF DTS > 0.0 THEN
      p := kpE * err;
      IF tiE > 0.0 THEN
        integ := integ + kpE * err * DTS / tiE;
      END_IF;
      d := 0.0;
      IF tdE > 0.0 AND havePrev THEN
        dpv := ((PV_IN - prevPv) / spanP * 100.0) / DTS;
        IF DIRECT THEN
          raw := kpE * tdE * dpv;
        ELSE
          raw := -kpE * tdE * dpv;
        END_IF;
        alpha := DTS / (0.1 * tdE + DTS);
        dState := dState + alpha * (raw - dState);
        d := dState;
      END_IF;
      prevPv := PV_IN;
      havePrev := TRUE;
      hi := MIN(hiPct, 100.0);
      lo := MAX(loPct, 0.0);
      unc := p + integ + d + ffPct;
      outPct := LIMIT(lo, unc, hi);
      IF unc <> outPct THEN
        integ := outPct - p - d - ffPct;
      END_IF;
      IF tiE <= 0.0 THEN
        integ := LIMIT(-1.0E6, integ, 1.0E6);
      END_IF;
    END_IF;
    IF outPct >= hiPct - 0.000001 THEN
      stsW := stsW + 4;
    END_IF;
    IF outPct <= loPct + 0.000001 THEN
      stsW := stsW + 8;
    END_IF;
  END_IF;

  wasTracking := TRK;
  Q := OUT_MIN + outPct / 100.0 * spanO;
  PV := PV_IN;
  SP := spv;
  OUT := Q;
  MODE := m;
  IF CSP_OK THEN
    CSP := CSP_IN;
  ELSE
    CSP := spv;
  END_IF;
  STS := stsW;
  lastMode := m;
  AUTO := m <> 0;
END_FUNCTION_BLOCK
