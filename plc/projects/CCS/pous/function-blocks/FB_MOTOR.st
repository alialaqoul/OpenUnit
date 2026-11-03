(* Motor / pump / fan device block.  Drives the field command from START/STOP pulses
   (cleared after use), auto start/stop logic and the protective interlock.  A trip of the
   drive is latched (TRIP) until the operator presses STOP, so a standby unit can start on it.
   SYNC (initial condition) aligns the command with the running feedback.  CMD_SET forces the
   command from a sequence, like an operator start without the permissive check. *)
FUNCTION_BLOCK FB_MOTOR
  VAR_INPUT
    RUN_FB : BOOL;             (* field: running *)
    TRIP_FB : BOOL;            (* field: tripped *)
    PERMIT : BOOL := TRUE;     (* start permissive *)
    ILK : BOOL;                (* protective interlock (stops and blocks) *)
    AUTO_START : BOOL;
    AUTO_STOP : BOOL;
    SYNC : BOOL;
    CMD_SET : BOOL;
    CMD_VAL : BOOL;
  END_VAR
  VAR_IN_OUT
    START : BOOL;              (* operator pulse *)
    STOP : BOOL;               (* operator pulse *)
    MODE : DINT;               (* 0 MAN, 1 AUTO / standby *)
    CMD : BOOL;                (* field command *)
    RUN : BOOL;
    TRIP : BOOL;
    PERM : BOOL;
    ILK_T : BOOL;
  END_VAR
  VAR_OUTPUT
    RUNNING : BOOL;
    LATCHED : BOOL;            (* trip latch (cleared by STOP) *)
    TRIPPED : BOOL;            (* field trip or latched trip *)
    IS_AUTO : BOOL;
    REJECTED : BOOL;           (* last start request refused *)
  END_VAR
  VAR
    cmdS : BOOL;
    tripS : BOOL;
  END_VAR

  IF SYNC THEN
    cmdS := RUN_FB;
    tripS := FALSE;
  END_IF;
  IF CMD_SET THEN
    cmdS := CMD_VAL;
    IF CMD_VAL THEN
      tripS := FALSE;
    END_IF;
  END_IF;
  IS_AUTO := MODE = 1;
  IF TRIP_FB THEN
    cmdS := FALSE;
    tripS := TRUE;
  END_IF;
  IF STOP THEN
    cmdS := FALSE;
    tripS := FALSE;
  END_IF;
  IF START THEN
    IF PERMIT AND NOT ILK AND NOT TRIP_FB THEN
      cmdS := TRUE;
      tripS := FALSE;
      REJECTED := FALSE;
    ELSE
      REJECTED := TRUE;
    END_IF;
  END_IF;
  IF IS_AUTO AND AUTO_START AND PERMIT AND NOT ILK AND NOT TRIP_FB AND NOT tripS THEN
    cmdS := TRUE;
  END_IF;
  IF IS_AUTO AND AUTO_STOP THEN
    cmdS := FALSE;
  END_IF;
  IF ILK THEN
    cmdS := FALSE;
  END_IF;
  START := FALSE;
  STOP := FALSE;
  CMD := cmdS;
  RUN := RUN_FB;
  TRIP := tripS;
  PERM := PERMIT;
  ILK_T := ILK;
  RUNNING := RUN_FB;
  LATCHED := tripS;
  TRIPPED := TRIP_FB OR tripS;
END_FUNCTION_BLOCK
