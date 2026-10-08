"""Проверки финансовой части и оценки α. Первые три не требуют данных ментора."""
import os, sys
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import line, data, economics  # noqa: E402

HAS_DATA = os.path.exists(os.path.join(data.ROOT, "data", "entries_hourly.csv.gz"))


def test_year_has_all_days():
    yd = economics.year_days(2026)
    assert sum(yd.values()) == 365
    assert yd["holiday"] > 0 and yd["weekend"] > 90


def test_unit_costs_are_consistent():
    u = economics.unit_costs()
    # консервативный дороже базового, снятие дешевле добавления (машинист на смене всё равно)
    assert u["add_train_h"]["cons"] > u["add_train_h"]["base"] > u["cut_train_h"]["base"] > u["cut_train_h"]["cons"]
    # предельная цена — малая часть полной себестоимости часа
    assert u["add_train_h"]["base"] < 0.3 * u["add_train_h"]["full_cost"]
    # 287 вагоно-км в час работы состава: 8 вагонов × 59,2 км за 99 мин
    assert abs(u["car_km_per_train_h"] - 8 * 2 * line.LINE_KM * 60 / line.TURNOVER_MIN) < 1e-9


def test_every_source_has_link():
    for k, s in economics.SOURCES.items():
        assert s["u"].startswith("https://"), k
        assert len(s["t"]) > 10, k


@pytest.mark.skipif(not HAS_DATA, reason="нет данных ментора (data/ не в репозитории)")
def test_alpha_estimate_brackets_assumption():
    import export
    hd, H = data.load_hourly()
    est = export.alpha_estimate(hd, H)
    # оценка сверху не ниже принятого α и в разумных пределах
    for sec in ("north", "south"):
        assert line.ALPHA <= est[sec] < 1.0, (sec, est)
    assert 2 < est["metro_to_line1"] < 5
