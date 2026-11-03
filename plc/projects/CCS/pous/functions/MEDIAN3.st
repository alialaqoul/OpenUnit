(* Median of three redundant transmitters (mid-value selection). *)
FUNCTION MEDIAN3 : REAL
  VAR_INPUT
    A : REAL;
    B : REAL;
    C : REAL;
  END_VAR
  MEDIAN3 := MAX(MIN(A, B), MIN(MAX(A, B), C));
END_FUNCTION
