(* First-out: number of the first TRUE input (C1 first), 0 when none is TRUE. The cause a first-out
   annunciator shows when several trip conditions come up in the same scan. Inputs left
   unconnected are FALSE. *)
FUNCTION FIRST_OUT : DINT
  VAR_INPUT
    C1 : BOOL := FALSE;
    C2 : BOOL := FALSE;
    C3 : BOOL := FALSE;
    C4 : BOOL := FALSE;
    C5 : BOOL := FALSE;
    C6 : BOOL := FALSE;
    C7 : BOOL := FALSE;
    C8 : BOOL := FALSE;
    C9 : BOOL := FALSE;
    C10 : BOOL := FALSE;
    C11 : BOOL := FALSE;
    C12 : BOOL := FALSE;
    C13 : BOOL := FALSE;
    C14 : BOOL := FALSE;
    C15 : BOOL := FALSE;
    C16 : BOOL := FALSE;
    C17 : BOOL := FALSE;
    C18 : BOOL := FALSE;
  END_VAR
  FIRST_OUT := 0;
  IF C18 THEN FIRST_OUT := 18; END_IF;
  IF C17 THEN FIRST_OUT := 17; END_IF;
  IF C16 THEN FIRST_OUT := 16; END_IF;
  IF C15 THEN FIRST_OUT := 15; END_IF;
  IF C14 THEN FIRST_OUT := 14; END_IF;
  IF C13 THEN FIRST_OUT := 13; END_IF;
  IF C12 THEN FIRST_OUT := 12; END_IF;
  IF C11 THEN FIRST_OUT := 11; END_IF;
  IF C10 THEN FIRST_OUT := 10; END_IF;
  IF C9 THEN FIRST_OUT := 9; END_IF;
  IF C8 THEN FIRST_OUT := 8; END_IF;
  IF C7 THEN FIRST_OUT := 7; END_IF;
  IF C6 THEN FIRST_OUT := 6; END_IF;
  IF C5 THEN FIRST_OUT := 5; END_IF;
  IF C4 THEN FIRST_OUT := 4; END_IF;
  IF C3 THEN FIRST_OUT := 3; END_IF;
  IF C2 THEN FIRST_OUT := 2; END_IF;
  IF C1 THEN FIRST_OUT := 1; END_IF;
END_FUNCTION
