"""Таблицы входов: 15-мин [день, слот, станция] и часовые [день, час, станция]."""
import os
import numpy as np
import pandas as pd
import line

ROOT = os.path.join(os.path.dirname(__file__), "..")
SLOT = 15
SLOTS = np.arange(0, 24 * 60, SLOT)        # 96 слотов суток
N = len(line.STATIONS)


def load_15min():
    q = pd.read_csv(os.path.join(ROOT, "data", "entries_15min.csv.gz"), parse_dates=["date"])
    q["st"] = q.vestibule.map(line.station_of)
    g = q.groupby(["date", "minute", "st"]).entries.sum()
    days = pd.DatetimeIndex(sorted(q.date.unique()))
    X = np.zeros((len(days), len(SLOTS), N))
    di = {d: i for i, d in enumerate(days)}
    si = {s: i for i, s in enumerate(line.STATIONS)}
    for (d, m, s), v in g.items():
        X[di[d], m // SLOT, si[s]] = v
    return days, X


def load_hourly():
    h = pd.read_csv(os.path.join(ROOT, "data", "entries_hourly.csv.gz"), parse_dates=["ts"])
    h = h[h.ts < "2026-09-30"]                     # 30.09 в часовом файле только 00 ч
    h["st"] = h.vestibule.map(line.station_of)
    h["d"] = h.ts.dt.normalize()
    g = h.groupby(["d", h.ts.dt.hour, "st"]).entries.sum()
    days = pd.DatetimeIndex(sorted(h.d.unique()))
    H = np.zeros((len(days), 24, N))
    di = {d: i for i, d in enumerate(days)}
    si = {s: i for i, s in enumerate(line.STATIONS)}
    for (d, hr, s), v in g.items():
        H[di[d], hr, si[s]] = v
    return days, H
