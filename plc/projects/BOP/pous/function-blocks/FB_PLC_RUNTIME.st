(* Controller runtime services, called first in every scan:
   - simulation time step DTS from the plant clock (SIM_TIME_MS), so freeze and fast time
     are honoured by every timer, ramp and PID;
   - initial-condition (IC) commands from the I/O bridge: a new IC_SEQ makes IC_INIT TRUE for
     one scan, the program then resets its internal state; IC_BUILTIN asks for the built-in
     defaults (no snapshot was restored).  The command is acknowledged in IC_ACK;
   - heartbeat, scan counter and a 6 s grace period after start-up / IC load.
   READY stays FALSE until the bridge has initialised the controller once. *)
FUNCTION_BLOCK FB_PLC_RUNTIME
  VAR_INPUT
    SIM_MS : UDINT;            (* plant simulation clock, ms *)
    IC_SEQ : DINT;             (* IC command sequence from the bridge *)
    IC_ID : DINT;              (* IC number *)
    IC_SNAP : BOOL;            (* controller values were restored from a snapshot *)
    CYCLE_MS : REAL := 50.0;   (* task interval, for SCAN_MS *)
  END_VAR
  VAR_IN_OUT
    HEARTBEAT : DINT;
    SCAN_COUNT : UDINT;
    SCAN_MS : REAL;
    SIM_DT : REAL;
    IC_APPLIED : DINT;
    IC_ACK : DINT;
  END_VAR
  VAR_OUTPUT
    DTS : REAL;
    IC_INIT : BOOL;
    IC_BUILTIN : BOOL;
    RESYNC : BOOL;
    GRACE : BOOL;
    READY : BOOL;
  END_VAR
  VAR
    prevMs : UDINT;
    havePrev : BOOL;
    lastSeq : DINT;
    first : BOOL := TRUE;
    graceTmr : TON;
  END_VAR

  (* simulation time step *)
  DTS := 0.0;
  IF havePrev THEN
    DTS := UDINT_TO_REAL(SIM_MS - prevMs) / 1000.0;
    IF DTS < 0.0 OR DTS > 5.0 THEN
      DTS := 0.0;
    END_IF;
  END_IF;
  prevMs := SIM_MS;
  havePrev := TRUE;
  SIM_DT := DTS;

  (* initial condition command *)
  IC_INIT := FALSE;
  IF IC_SEQ <> lastSeq AND IC_SEQ <> 0 THEN
    lastSeq := IC_SEQ;
    IC_INIT := TRUE;
    IC_APPLIED := IC_ID;
    IC_ACK := IC_SEQ;
  END_IF;
  IC_BUILTIN := IC_INIT AND NOT IC_SNAP;
  READY := IC_ACK <> 0;
  RESYNC := IC_INIT OR first;
  first := FALSE;

  graceTmr(IN := NOT IC_INIT, PT := T#6s);
  GRACE := NOT graceTmr.Q;

  HEARTBEAT := HEARTBEAT + 1;
  IF HEARTBEAT > 65535 THEN
    HEARTBEAT := 0;
  END_IF;
  SCAN_COUNT := SCAN_COUNT + 1;
  SCAN_MS := CYCLE_MS;
END_FUNCTION_BLOCK
