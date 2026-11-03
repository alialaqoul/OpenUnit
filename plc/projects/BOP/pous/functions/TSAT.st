(* Saturation temperature [degC] at pressure P [MPa abs] - IAPWS-IF97 derived table
   interpolated on ln(P), identical to tsat() in src/common/steamTable.js (generated from it). *)
FUNCTION TSAT : REAL
  VAR_INPUT
    P : REAL;
  END_VAR
  VAR
    PTAB : ARRAY[0..41] OF REAL := [0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.008, 0.01, 0.015, 0.02, 0.03, 0.05, 0.07, 0.101325, 0.15, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0, 20.0, 21.0, 21.8];
    TTAB : ARRAY[0..41] OF REAL := [6.97, 17.5, 24.08, 28.96, 32.88, 36.16, 41.51, 45.81, 53.97, 60.06, 69.1, 81.32, 89.95, 99.97, 111.35, 120.21, 133.52, 151.83, 164.95, 179.88, 198.29, 212.38, 233.86, 250.36, 263.94, 275.59, 285.83, 295.01, 303.35, 311.0, 318.08, 324.68, 330.86, 336.67, 342.16, 347.36, 352.29, 356.99, 361.47, 365.75, 369.83, 373.0];
    pc : REAL;
    x : REAL;
    i : INT;
    f : REAL;
  END_VAR
  pc := LIMIT(PTAB[0], P, PTAB[41]);
  x := LN(pc);
  i := 1;
  WHILE i < 41 AND LN(PTAB[i]) < x DO
    i := i + 1;
  END_WHILE;
  f := (x - LN(PTAB[i - 1])) / (LN(PTAB[i]) - LN(PTAB[i - 1]));
  TSAT := TTAB[i - 1] + f * (TTAB[i] - TTAB[i - 1]);
END_FUNCTION
