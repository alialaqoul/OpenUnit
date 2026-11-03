(* 2-out-of-3 voting of boolean trip channels. *)
FUNCTION VOTE2OO3 : BOOL
  VAR_INPUT
    A : BOOL;
    B : BOOL;
    C : BOOL;
  END_VAR
  VOTE2OO3 := (A AND B) OR (A AND C) OR (B AND C);
END_FUNCTION
