"""Проверки, которые должны выполняться на любом дне: ограничения линии и отсутствие подглядывания в будущее."""
import os, sys
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import line, data, baseline, engine, simulate  # noqa: E402

pytestmark = pytest.mark.skipif(not os.path.exists(os.path.join(data.ROOT, "data", "entries_15min.csv.gz")),
                                reason="нет данных ментора (data/ не в репозитории)")


@pytest.fixture(scope="module")
def world():
    days, X = data.load_15min()
    hd, H = data.load_hourly()
    B, _ = baseline.build(days, X, hd, H)
    return days, X, B


def test_limits_hold_on_every_day(world):
    days, X, B = world
    for i, d in enumerate(days):
        sched, plan, P, log = simulate.run_day(d, X[i], B[i])
        assert P.max() <= max(plan.max(), np.floor(line.MAX_PAIRS)), d       # интервал не меньше 1:53
        assert engine.trains_on_line(P).max() <= line.MAX_TRAINS, d          # не больше 53 составов
        for t in range(96):
            if P[t] < plan[t]:                                               # сняли — не ниже максимального интервала
                assert P[t] >= line.min_pairs(t // 4, sched == "weekend") - 1e-9, (d, t)


def test_forecast_does_not_look_ahead(world):
    days, X, B = world
    i, t = 10, 40
    Xa = X[i].copy()
    Xb = X[i].copy(); Xb[t + 1:] *= 3                                        # меняем будущее
    Ea, _ = simulate.forecast(Xa, B[i], t)
    Eb, _ = simulate.forecast(Xb, B[i], t)
    assert np.allclose(Ea[t + 1:], Eb[t + 1:])


def test_baseline_uses_only_past(world):
    days, X, B = world
    hd, H = data.load_hourly()
    d = days[-1]
    H2 = H.copy(); H2[[j for j, e in enumerate(hd) if e >= d]] *= 5
    a, _ = baseline.hourly_baseline(hd, H, d)
    b, _ = baseline.hourly_baseline(hd, H2, d)
    assert np.allclose(a, b)


def test_no_trains_added_when_measured_load_is_low(world):
    days, X, B = world
    for i, d in enumerate(days):
        if line.schedule_for(d) != "weekend":
            continue
        _, _, _, log = simulate.run_day(d, X[i], B[i])
        for dec in log:
            if any(m["type"] == "add" for m in dec["measures"]):
                peak = max(max(v["fc"]) for v in dec["sectors"].values())
                assert peak >= 0.85 * engine.NORM, (d, dec["t"])
