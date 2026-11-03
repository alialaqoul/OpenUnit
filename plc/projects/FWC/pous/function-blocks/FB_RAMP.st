(* Ramp generator: OUT moves towards TARGET at RATE units/s (simulation time).
   INIT loads INIT_VAL (initial condition / bumpless start). *)
FUNCTION_BLOCK FB_RAMP
  VAR_INPUT
    TARGET : REAL;
    RATE : REAL;
    DTS : REAL;
    INIT : BOOL;
    INIT_VAL : REAL;
  END_VAR
  VAR_OUTPUT
    OUT : REAL;
  END_VAR
  VAR
    stepV : REAL;
  END_VAR
  IF INIT THEN
    OUT := INIT_VAL;
  END_IF;
  stepV := RATE * DTS;
  OUT := OUT + LIMIT(-stepV, TARGET - OUT, stepV);
END_FUNCTION_BLOCK
