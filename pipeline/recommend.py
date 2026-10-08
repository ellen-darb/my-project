"""Правила рекомендаций с ограничениями линии 1 + проверка на фактических данных."""
import math
import numpy as np
from core import *

WARN_UTIL = 0.85              # прогноз выше 85% нормы -> сигнал; порог выбран по thresholds.json (охват 11 из 11)
UTIL_TARGET = 0.95            # после коррекции расчётная загрузка не выше 95% нормы
LOW_UTIL = 0.40               # ниже 40% нормы на самом нагруженном перегоне: можно снять составы
SAFE_AFTER_REMOVE = 0.80      # после снятия не выше 80% нормы
MAX_REMOVE_SHARE = 0.25
TRAINS_PER_PAIR = TURNOVER_MIN / 60.0


def floor_pairs(hour):
    """Мин. парность по макс. допустимому интервалу будней из графика с 01.09.2026:
    5:45-8:00 -> 8:00, 8-9 -> 3:30, 9-17 -> 5:30, 17-19 -> 4:00, 19-24 -> 9:00."""
    mx = 8.0 if hour < 8 else 3.5 if hour < 9 else 5.5 if hour < 17 else 4.0 if hour < 19 else 9.0
    return math.ceil(60.0 / mx)


def slot_flows(e, P_t):
    """входы [станция] в слоте -> пик по перегонам [направление]."""
    T = e[:, None] * P_t
    up = max(T[: s + 1, s + 1:].sum() for s in range(N - 1))
    dn = max(T[s + 1:, : s + 1].sum() for s in range(N - 1))
    return np.array([up, dn])


def recommend(peak_flow, plan_pairs_h, hour=12, reserve=RESERVE_TRAINS):
    """peak_flow [2]: прогноз пассажиров на самом нагруженном перегоне за слот по направлениям.
    Возвращает (изменение числа составов на линии, пар/ч после, причина)."""
    f = float(np.max(peak_flow))
    plan_tr = plan_pairs_h * SLOT / 60.0
    if plan_tr <= 0:
        return 0, plan_pairs_h, "нет движения"
    load = f / plan_tr
    if load > WARN_UTIL * NORM_TRAIN:
        need_tr = f / (UTIL_TARGET * NORM_TRAIN)
        need_pairs = min(need_tr * 60 / SLOT, MAX_PAIRS_H)
        k = math.ceil((need_pairs - plan_pairs_h) * TRAINS_PER_PAIR - 1e-9)
        k = int(min(max(k, 1), reserve, math.floor((MAX_PAIRS_H - plan_pairs_h) * TRAINS_PER_PAIR + 1e-9)))
        k = max(k, 0)
        return k, plan_pairs_h + k / TRAINS_PER_PAIR, "перегруз"
    if load < LOW_UTIL * NORM_TRAIN and plan_pairs_h > floor_pairs(hour):
        need_tr = f / (SAFE_AFTER_REMOVE * NORM_TRAIN)
        new_pairs = max(need_tr * 60 / SLOT, floor_pairs(hour), plan_pairs_h * (1 - MAX_REMOVE_SHARE))
        k = -int(math.floor((plan_pairs_h - new_pairs) * TRAINS_PER_PAIR + 1e-9))
        return k, plan_pairs_h + k / TRAINS_PER_PAIR, "недогруз"
    return 0, plan_pairs_h, "норма"


def smooth_removals(whys, ks, plans):
    """Снятие составов только если сигнал держится >=2 из 3 слотов подряд; k берётся наименьший по модулю.
    Считается по исходным (несглаженным) сигналам, поэтому слот не влияет на соседей."""
    out_k, out_why = list(ks), list(whys)
    for i, w in enumerate(whys):
        if w != "недогруз":
            continue
        win = [ks[j] for j in range(max(0, i - 2), i + 1) if whys[j] == "недогруз"]
        if len(win) < 2:
            out_k[i], out_why[i] = 0, "норма"
        else:
            out_k[i] = max(win)
    return out_why, out_k
