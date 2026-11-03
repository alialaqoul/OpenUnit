(* On/off valve or breaker device block (<dev>_OPEN/_CLOSE pulses, _MODE, _OPENED/_CLOSED,
   _PERM, _ILK).  ILK_OPEN / ILK_CLOSE are protective interlocks; RESET_ON_LOSS drops the
   command when the device leaves the open position by itself (e.g. a breaker trip). *)
FUNCTION_BLOCK FB_ONOFF
  VAR_INPUT
    OPENED_FB : BOOL;          (* field: open / closed position *)
    CLOSED_FB : BOOL;
    HAS_CLOSED : BOOL;         (* a separate closed limit switch exists *)
    PERMIT : BOOL := TRUE;     (* open permissive *)
    CLOSE_PERMIT : BOOL := TRUE;
    ILK_CLOSE : BOOL;
    ILK_OPEN : BOOL;
    AUTO_OPEN : BOOL;
    AUTO_CLOSE : BOOL;
    RESET_ON_LOSS : BOOL;
    SYNC : BOOL;
    CMD_SET : BOOL;
    CMD_VAL : BOOL;
  END_VAR
  VAR_IN_OUT
    OPEN : BOOL;               (* operator pulse *)
    CLOSE : BOOL;              (* operator pulse *)
    MODE : DINT;
    CMD : BOOL;                (* field command *)
    OPENED : BOOL;
    CLOSED : BOOL;
    PERM : BOOL;
    ILK : BOOL;
  END_VAR
  VAR_OUTPUT
    IS_OPEN : BOOL;
    IS_CLOSED : BOOL;
    Q_CMD : BOOL;
    REJECTED : BOOL;
  END_VAR
  VAR
    cmdS : BOOL;
    was : BOOL;
    autoM : BOOL;
  END_VAR

  IF SYNC THEN
    cmdS := OPENED_FB;
    was := OPENED_FB;
  END_IF;
  IF CMD_SET THEN
    cmdS := CMD_VAL;
  END_IF;
  IS_OPEN := OPENED_FB;
  IF HAS_CLOSED THEN
    IS_CLOSED := CLOSED_FB;
  ELSE
    IS_CLOSED := NOT OPENED_FB;
  END_IF;
  autoM := MODE = 1;
  IF RESET_ON_LOSS AND cmdS AND was AND NOT OPENED_FB THEN
    cmdS := FALSE;
  END_IF;
  IF OPEN THEN
    IF PERMIT AND NOT ILK_CLOSE THEN
      cmdS := TRUE;
      REJECTED := FALSE;
    ELSE
      REJECTED := TRUE;
    END_IF;
  END_IF;
  IF CLOSE THEN
    IF CLOSE_PERMIT THEN
      cmdS := FALSE;
      REJECTED := FALSE;
    ELSE
      REJECTED := TRUE;
    END_IF;
  END_IF;
  IF autoM AND AUTO_OPEN AND PERMIT AND NOT ILK_CLOSE THEN
    cmdS := TRUE;
  END_IF;
  IF autoM AND AUTO_CLOSE THEN
    cmdS := FALSE;
  END_IF;
  IF ILK_OPEN THEN
    cmdS := TRUE;
  END_IF;
  IF ILK_CLOSE THEN
    cmdS := FALSE;
  END_IF;
  was := OPENED_FB;
  OPEN := FALSE;
  CLOSE := FALSE;
  CMD := cmdS;
  OPENED := IS_OPEN;
  CLOSED := IS_CLOSED;
  PERM := PERMIT;
  ILK := ILK_CLOSE OR ILK_OPEN;
  Q_CMD := cmdS;
END_FUNCTION_BLOCK
