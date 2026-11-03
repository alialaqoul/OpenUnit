(* Manual / auto loading station (<station>_OUT/_MODE/_BIAS/_IN/_FB/_STS).
   AUTO: output = auto demand + bias; the bias is computed on the transfer to AUTO so the
   change is bumpless.  STS bits: 1 interlock (forced manual), 2 tracking.
   INIT (initial condition) forgets the previous mode, so a station found in AUTO recomputes
   its bias; with INIT_KEEP (values restored from a snapshot) the bias is kept.  JOIN puts the
   station in AUTO on the master demand with zero bias (auto-started standby unit). *)
FUNCTION_BLOCK FB_STATION
  VAR_INPUT
    AUTO_IN : REAL;            (* auto demand *)
    FB_IN : REAL;              (* position feedback, for display *)
    FORCE_MAN : BOOL;
    TRK : BOOL;
    TRK_VAL : REAL;
    LO : REAL := -1.0E30;      (* output limits; default = station range *)
    HI : REAL := 1.0E30;
    RATE : REAL := 1.0E30;     (* rate limit in AUTO, units/s *)
    DTS : REAL;
    INIT : BOOL;               (* initial condition *)
    INIT_KEEP : BOOL;          (* ... keep the bias (values came from a snapshot) *)
    JOIN : BOOL;               (* go to AUTO with zero bias *)
    OUT_MIN : REAL := 0.0;
    OUT_MAX : REAL := 100.0;
  END_VAR
  VAR_IN_OUT
    OUT : REAL;
    MODE : DINT;
    BIAS : REAL;
    IN_TAG : REAL;
    FB_TAG : REAL;
    STS : DINT;
  END_VAR
  VAR_OUTPUT
    Q : REAL;
    AUTO : BOOL;
  END_VAR
  VAR
    prevMode : DINT;
    m : DINT;
    stsW : DINT;
    cur : REAL;
    o : REAL;
    lo2 : REAL;
    hi2 : REAL;
  END_VAR

  IF INIT THEN
    IF INIT_KEEP AND MODE = 1 THEN
      prevMode := 1;
    ELSE
      prevMode := 0;
    END_IF;
  END_IF;
  IF JOIN THEN
    MODE := 1;
    BIAS := 0.0;
    prevMode := 1;
  END_IF;
  m := 0;
  IF MODE = 1 THEN
    m := 1;
  END_IF;
  stsW := 0;
  IF FORCE_MAN THEN
    m := 0;
    stsW := 1;
  END_IF;
  cur := OUT;
  IF TRK THEN
    o := TRK_VAL;
    stsW := stsW + 2;
  ELSIF m = 1 THEN
    IF prevMode <> 1 THEN
      BIAS := LIMIT(-50.0, cur - AUTO_IN, 50.0);
    END_IF;
    o := AUTO_IN + BIAS;
    IF RATE < 1.0E29 THEN
      o := cur + LIMIT(-RATE * DTS, o - cur, RATE * DTS);
    END_IF;
  ELSE
    o := cur;
  END_IF;
  lo2 := OUT_MIN;
  IF LO > -1.0E29 THEN
    lo2 := LO;
  END_IF;
  hi2 := OUT_MAX;
  IF HI < 1.0E29 THEN
    hi2 := HI;
  END_IF;
  o := LIMIT(lo2, o, hi2);
  prevMode := m;
  OUT := o;
  MODE := m;
  IN_TAG := AUTO_IN;
  FB_TAG := FB_IN;
  STS := stsW;
  Q := o;
  AUTO := m = 1;
END_FUNCTION_BLOCK
