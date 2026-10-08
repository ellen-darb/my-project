"""Прогноз для всех дней по схеме leave-one-month-out (модель не видела проверяемый месяц)."""
import sys, numpy as np, pandas as pd
from core import *
from forecast import *

src, out = sys.argv[1], sys.argv[2]
days, X = to_matrix(pd.read_csv(src, parse_dates=["date"]))
S = len(SLOTS)
PRED = np.full((len(days), S, 9, N), np.nan, dtype=np.float32)   # [день, слот выдачи, горизонт, станция]
BASE_ALL = np.zeros_like(X)
for mth in sorted(set(d.month for d in days)):
    test = np.array([d.month == mth for d in days])
    B = baseline(days, X, exclude=test)
    BASE_ALL[test] = B[test]
    tr, te = np.where(~test)[0], np.where(test)[0]
    Rtr, ytr, mtr = build(days, X, B, tr)
    Rte, yte, mte = build(days, X, B, te)
    w = np.array([B[d, s + h, k] + 5 for d, s, h, k in mtr])
    m = fit(Rtr, ytr, w)
    p = predict(m, Rte) * (np.array([B[d, s + h, k] for d, s, h, k in mte]) + 5) - 5
    for (d, s, h, k), v in zip(mte, p):
        PRED[d, s, h, k] = max(v, 0)
    print("month", mth, "done", flush=True)
np.savez_compressed(out, PRED=PRED, BASE=BASE_ALL, X=X, days=np.array([str(d.date()) for d in days]))
