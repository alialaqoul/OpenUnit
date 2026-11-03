(* Function generator: piecewise linear f(X) through up to five points (X1,Y1)..(X5,Y5) with
   ascending X; constant beyond the end points.  For fewer points repeat the last one. *)
FUNCTION FGEN5 : REAL
  VAR_INPUT
    X : REAL;
    X1 : REAL;
    Y1 : REAL;
    X2 : REAL;
    Y2 : REAL;
    X3 : REAL;
    Y3 : REAL;
    X4 : REAL;
    Y4 : REAL;
    X5 : REAL;
    Y5 : REAL;
  END_VAR
  IF X <= X1 THEN
    FGEN5 := Y1;
  ELSIF X <= X2 THEN
    FGEN5 := Y1 + (Y2 - Y1) * (X - X1) / (X2 - X1);
  ELSIF X <= X3 THEN
    FGEN5 := Y2 + (Y3 - Y2) * (X - X2) / (X3 - X2);
  ELSIF X <= X4 THEN
    FGEN5 := Y3 + (Y4 - Y3) * (X - X3) / (X4 - X3);
  ELSIF X <= X5 THEN
    FGEN5 := Y4 + (Y5 - Y4) * (X - X4) / (X5 - X4);
  ELSE
    FGEN5 := Y5;
  END_IF;
END_FUNCTION
