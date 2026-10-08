"""Прогноз входов по станциям на 15..120 мин: база по типу дня + ML-поправка по свежему отклонению."""
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from core import *

HORIZONS = list(range(1, 9))          # слотов по 15 мин -> 15..120 мин
CODE = {"wd": 0, "fri": 1, "sat": 2, "sun": 3, "pre": 4, "hol": 5}


def recent_ratio(X, B, d, s, k=None, n=4):
    lo = max(0, s - n + 1)
    a = X[d, lo:s + 1]; b = B[d, lo:s + 1]
    if k is None:
        return (a.sum() + 1) / (b.sum() + 1)
    return (a[:, k].sum() + 1) / (b[:, k].sum() + 1)


def feats(days, X, B, d, s, h, k, lr4, lr1, sr4):
    t = s + h
    return [B[d, t, k], B[d, s, k], lr4, lr1, sr4, h, SLOTS[s] / 60.0, SLOTS[t] / 60.0, k,
            CODE[day_type(days[d])], B[d, t].sum()]


def build(days, X, B, didx, s_range=None):
    rows, ys, meta = [], [], []
    S = len(SLOTS)
    for d in didx:
        for s in (s_range or range(4, S - 1)):
            lr4 = recent_ratio(X, B, d, s); lr1 = recent_ratio(X, B, d, s, n=1)
            sr = [recent_ratio(X, B, d, s, k) for k in range(N)]
            for h in HORIZONS:
                t = s + h
                if t >= S:
                    break
                for k in range(N):
                    rows.append(feats(days, X, B, d, s, h, k, lr4, lr1, sr[k]))
                    ys.append(X[d, t, k] / (B[d, t, k] + 5.0))
                    meta.append((d, s, h, k))
    return np.array(rows, dtype=np.float32), np.array(ys, dtype=np.float32), np.array(meta)


def fit(rows, ys, wts):
    m = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.06, max_leaf_nodes=24,
                                      l2_regularization=1.0, random_state=0)
    m.fit(rows, ys, sample_weight=wts)
    return m


def predict(m, rows):
    r = m.predict(rows)
    return np.clip(r, 0.3, 3.0)
