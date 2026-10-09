"""Жёсткие ограничения линии и связь расчёта с решением диспетчера. Тесты ловят порчу констант и логики."""
import os, sys, subprocess, shutil
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import line, data, baseline, engine, simulate  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
needs_data = pytest.mark.skipif(not os.path.exists(os.path.join(data.ROOT, "data", "entries_15min.csv.gz")), reason="нет данных")


def test_constants():
    assert line.MIN_HEADWAY_S == 113 and line.MAX_TRAINS == 53 and line.TURNOVER_MIN == 99
    assert line.NORM_TRAIN == 960 and line.MAX_TRAIN == 1458 and line.ALPHA == 0.85
    assert abs(line.MAX_PAIRS - 31.86) < 0.01


def test_flow_scales_with_alpha():
    E = np.ones((96, len(line.STATIONS))) * 100
    a = engine.section_flow(E, "north", 0.75)[50]
    b = engine.section_flow(E, "north", 1.0)[50]
    assert abs(a / b - 0.75) < 1e-9


def _decide(pairs, E, B, t, lr=1.2):
    return engine.decide(pairs, False, E, B, t, lr, pairs.copy())


def _jam(t, mult=1.6):
    """Утро с сильным потоком на севере: база 300 на станцию, факт в mult раз выше."""
    B = np.zeros((96, len(line.STATIONS)))
    B[:, line.STATIONS.index("Девяткино"):] = 300
    for s in line.NORTH:
        B[:, line.STATIONS.index(s)] = 300
    return B, B * mult


def test_reserve_cannot_come_earlier_than_20_minutes():
    pairs = engine.pairs_profile("weekday_sep")
    B, E = _jam(28)
    for t in range(24, 33):
        dec = _decide(pairs, E, B, t)
        for m in dec["measures"]:
            if m["type"] == "add":
                assert (m["from"] - (t + 1)) * 15 >= line.HOT_LEAD_MIN


def test_add_never_needs_more_trains_than_free():
    pairs = np.full(96, 26.0)
    B, E = _jam(28, 3.0)
    for t in range(24, 33):
        for m in _decide(pairs, E, B, t)["measures"]:
            if m["type"] == "add":
                assert engine.trains_on_line(pairs[m["from"]]) + m["trains"] <= line.MAX_TRAINS + 1
                assert pairs[m["from"]] + m["pairs"] <= np.floor(line.MAX_PAIRS)


def test_never_exceeds_interval_or_train_limit():
    pairs = np.full(96, 31.0)
    B, E = _jam(28, 2.5)
    for t in range(24, 40):
        for m in _decide(pairs, E, B, t)["measures"]:
            assert m["type"] != "add"          # линия на пределе: добавлять нельзя


def test_no_overload_claims_after_morning():
    pairs = engine.pairs_profile("weekday_sep")
    B, E = _jam(50, 6.0)
    dec = _decide(pairs, E, B, 50)
    assert dec["status"] in ("watch", "ok")
    assert all(m["type"] in ("watch",) for m in dec["measures"])


def test_cut_only_in_day_hours():
    pairs = engine.pairs_profile("weekday_sep")
    B = np.ones((96, len(line.STATIONS))) * 100
    for t in (30, 70, 80):
        dec = engine.decide(pairs, False, B * 0.5, B, t, 0.5, pairs.copy())
        assert not any(m["type"] == "cut" for m in dec["measures"]), t


@needs_data
def test_limits_hold_on_every_day():
    days, X = data.load_15min()
    hd, H = data.load_hourly()
    B, _ = baseline.build(days, X, hd, H)
    B = np.round(B)
    adds = 0
    for i, d in enumerate(days):
        sched, plan, P, log = simulate.run_day(d, X[i], B[i])
        assert P.max() <= max(plan.max(), np.floor(line.MAX_PAIRS)), d
        assert engine.trains_on_line(P).max() <= line.MAX_TRAINS, d
        for dec in log:
            for m in dec["measures"]:
                if m["type"] == "add":
                    adds += 1
                    assert (m["from"] - (dec["t"] + 1)) * 15 >= line.HOT_LEAD_MIN
                if m["type"] == "cut":
                    assert 10 <= (dec["t"] + 1) // 4 < 15
    assert adds > 20          # ограничения не «глушат» все советы


@needs_data
@pytest.mark.skipif(shutil.which("node") is None, reason="нет node")
def test_browser_engine_matches_python():
    r = subprocess.run(["node", os.path.join(ROOT, "tests", "parity.mjs")], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
