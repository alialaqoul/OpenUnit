(* On-delay timer running on SIMULATION time (DTS), so it honours freeze and fast time.
   Q goes TRUE once IN has been TRUE for PT seconds.  ET is the elapsed time (s). *)
FUNCTION_BLOCK FB_TONS
  VAR_INPUT
    IN : BOOL;
    PT : REAL;                 (* preset, s *)
    DTS : REAL;
    INIT : BOOL;
  END_VAR
  VAR_OUTPUT
    Q : BOOL;
    ET : REAL;
  END_VAR
  IF INIT THEN
    ET := 0.0;
  END_IF;
  IF IN THEN
    ET := MIN(PT, ET + DTS);
  ELSE
    ET := 0.0;
  END_IF;
  Q := IN AND ET >= PT;
END_FUNCTION_BLOCK
