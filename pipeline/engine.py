"""Оценка достаточности и корректировка насыщения линии.

Вход в момент t: факт входов до t, прогноз на 8 слотов (120 мин), «обычный день» и лист графика.
Выход: загрузка на критических перегонах, статус, рекомендация с проверкой ограничений, эффект.
"""
import math
import numpy as np
import line, data

SEC = {k: np.array([line.STATIONS.index(s) for s in v["stations"]]) for k, v in line.SECTORS.items()}
LAGS = {k: np.array([line.lag_min(s, k) for s in v["stations"]]) for k, v in line.SECTORS.items()}
TRAIN_KM_PER_H = 2 * line.LINE_KM * 60 / line.TURNOVER_MIN      # ≈35,9 км/ч на состав в обороте
NORM = line.NORM_TRAIN
HOT = sum(line.HOT_RESERVE.values())
W = 8                                                            # окно прогноза, слотов
MORNING_END = 44        # слот 11:00: загрузку «к центру» по входам считаем только утром, для вечера нужны выходы
CUT_HOURS = (10, 15)    # снимать составы по входам разумно только в дневной провал


def pairs_profile(sched):
    """Пар/ч на каждый 15-мин слот. В 05 ч движение начинается около 05:30."""
    p = np.array([line.pairs_at(sched, int(m)) for m in data.SLOTS], dtype=float)
    p[20:22] = 0.0
    p[22:24] *= 2
    return p


def trains_on_line(pairs):
    return np.round(pairs * line.TURNOVER_MIN / 60)


def section_flow(E, sector, alpha=line.ALPHA, edge=None):
    """Входы [слот, станция] -> поток через критический перегон к центру [слот], со сдвигом на время в пути."""
    S = E.shape[0]
    out = np.zeros(S)
    lags = LAGS[sector] if edge is None else np.array([2.0 + abs(s - edge) * line.SEG_MIN for s in SEC[sector]])
    for st, lag in zip(SEC[sector], lags):
        k, f = divmod(lag / 15.0, 1.0)
        k = int(k)
        src = E[:, st]
        if k < S:
            out[k:] += (1 - f) * src[:S - k]
        if k + 1 < S:
            out[k + 1:] += f * src[:S - k - 1]
    return alpha * out


def per_train(flow, pairs):
    n = pairs / 4.0
    return np.where(n > 0, flow / np.maximum(n, 1e-9), 0.0)


def t_str(slot):
    m = int(slot) * 15
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def trains_for(pairs):
    return math.ceil(pairs * line.TURNOVER_MIN / 60 - 1e-9)


def pairs_for(trains):
    return math.floor(trains * 60 / line.TURNOVER_MIN + 1e-9)


def decide(pairs, weekend, E, Bd, t, line_ratio, plan=None, alpha=line.ALPHA):
    """Решение в момент t по прогнозу E (факт до t, прогноз после). pairs — действующая парность
    (с уже принятыми мерами), plan — исходный лист графика. Возвращает статус и меры.
    Ограничения линии жёсткие: интервал 1:53, 53 состава, горячий резерв 2+2, холодный выход 30 мин."""
    plan = pairs if plan is None else plan
    win = np.arange(t + 1, min(t + 1 + W, 96))
    out = {"t": int(t), "status": "ok", "sectors": {}, "measures": [], "checks": []}
    worst = None
    mwin = win[win < MORNING_END]
    for sec in ("north", "south"):
        Lf = per_train(section_flow(E, sec, alpha), pairs)[win]
        Lt = per_train(section_flow(Bd, sec, alpha), pairs)[win]
        out["sectors"][sec] = {"fc": Lf.round(0).tolist(), "typ": Lt.round(0).tolist()}
        ok = win < MORNING_END
        over = (Lf > NORM) & ok
        anomal = over & (Lf > 1.08 * Lt)
        if over.sum() >= 2:
            score = (anomal.sum(), Lf.max())
            if worst is None or score > worst[0]:
                worst = (score, sec, over, anomal, Lf)
    rel = "high" if line_ratio > 1.15 else ("low" if line_ratio < 0.85 else None)
    hour = int(data.SLOTS[t + 1] // 60)

    if worst is None:
        if rel == "high":
            peak = max([max(v["fc"][:len(mwin)] or [0]) for v in out["sectors"].values()])
            out["status"] = "watch"
            out["window"] = {"sector": "line", "from": int(win[0]), "to": int(win[-1]), "lead_min": 15, "peak": int(round(peak))}
            txt = (f"Составы не добавлять: к центру до {peak:.0f} чел. в составе ({peak / NORM:.0%} нормы)" if len(mwin) else
                   "Людей больше обычного, загрузку составов по входам оценить нельзя")
            out["measures"].append({"type": "watch", "text": txt,
                "why": "поток выше обычного, но там, где загрузку можно оценить, место есть; по центру и вечером — доклады дежурных станций"})
        elif rel == "low" and CUT_HOURS[0] <= hour < CUT_HOURS[1]:
            Lmax = max(max(v["fc"]) for v in out["sectors"].values())
            p_now = float(pairs[t + 1])
            floor = line.min_pairs(hour, weekend)
            target = max(math.ceil(floor), math.ceil(p_now * line_ratio / 0.95))
            cut = int(p_now - target)
            if cut >= 2 and Lmax < 0.7 * NORM:
                tr = math.floor(cut * line.TURNOVER_MIN / 60)
                out["status"] = "low"
                out["measures"].append({"type": "cut", "pairs": cut, "trains": tr, "from": int(t + 1), "to": int(win[-1]),
                    "text": f"Снять {tr} сост. в депо, −{cut} пар/ч",
                    "why": f"поток {round((line_ratio - 1) * 100)}% к обычному дню; загрузка остаётся ниже 70% нормы, интервал в пределах графика"})
        return out

    _, sec, over, anomal, Lf = worst
    idx = np.where(over)[0]
    s0, s1 = int(win[idx[0]]), int(win[idx[-1]])
    mult = float(Lf[idx].max() / NORM)
    out["status"] = "anomaly" if anomal.sum() >= 2 else "structural"
    lead = (s0 - t - 1) * 15                       # минут от «сейчас» до начала перегрузки
    p_now, p_s0 = float(pairs[t]), float(pairs[s0])
    need = max(0, math.ceil(p_s0 * mult) - p_s0)
    out["window"] = {"sector": sec, "from": s0, "to": s1, "lead_min": lead, "pairs": p_s0,
                     "trains": int(trains_on_line(p_s0)), "need_pairs": need, "peak": round(mult * NORM)}
    # 1) не снимать составы, если график снижает парность внутри окна перегрузки
    if pairs[s0:s1 + 1].min() < p_now:
        out["measures"].append({"type": "hold", "pairs": p_now, "from": int(t + 1), "to": s1,
            "text": f"Не снимать составы до {t_str(s1 + 1)}: держать {p_now:.0f} пар/ч",
            "why": "по графику парность снижается, а поток ещё выше нормы; составы уже на линии, ввод не нужен"})
        p_s0 = max(p_s0, p_now)
    # 2) выпуск: первый слот, с которого состав реально выйдет на линию (резерв 20 мин)
    first = t + 1 + math.ceil(line.HOT_LEAD_MIN / 15)
    start = max(s0, first)
    headroom = math.floor(line.MAX_PAIRS) - p_s0
    free = int(line.MAX_TRAINS - trains_on_line(p_s0))
    # горячий резерв (2+2) выходит за 15–20 мин, холодные составы за 30; слоты по 15 мин, поэтому первый слот
    # выпуска для тех и других — через 30 мин, и предел даёт только линия: 53 состава и интервал 1:53
    add = int(min(need, max(headroom, 0), pairs_for(max(free, 0))))
    out["checks"] = [
        {"rule": "Запас по интервалу 1:53", "ok": headroom > 0, "note": f"{p_s0:.0f} из 31,9 пар/ч"},
        {"rule": "Свободные составы", "ok": free > 0, "note": f"на линии {int(trains_on_line(p_s0))} из 53"},
        {"rule": "Резерв успевает", "ok": start <= s1 and lead >= line.HOT_LEAD_MIN, "note": f"{lead} мин до начала, выход 15–20"},
    ]
    if start > s1 and need > 0 and headroom > 0 and free > 0:
        out["measures"].append({"type": "late",
            "text": f"Резерв не успеет: тесно станет через {lead} мин, состав выйдет не раньше {t_str(first)}",
            "why": "предупредите станции участка и дежурных по станции; выпуск новых составов уже не поможет"})
    elif add > 0:
        tr = trains_for(add)
        depot = {"north": "Северное", "south": "Автово"}.get(sec, "Автово и Северное")
        early = trains_on_line(plan[min(s0 + 4, 95)]) - trains_on_line(plan[s0]) >= tr
        text = (f"Выпустить {tr} сост. раньше графика из депо {depot}, +{add} пар/ч" if early
                else f"Выдать {tr} сост. из резерва депо {depot}, +{add} пар/ч")
        why = (f"резерв выходит за 15–20 мин и успевает; начало с {t_str(start)}" if lead >= line.HOT_LEAD_MIN
               else f"тесно станет через {lead} мин: резерв успеет к {t_str(start)}, дальше окно ещё идёт")
        out["measures"].append({"type": "add", "pairs": add, "trains": tr, "depot": depot, "from": int(start), "to": s1,
                                "hot": min(tr, HOT), "on_time": lead >= line.HOT_LEAD_MIN, "early": bool(early),
                                "text": text, "why": why})
    elif not out["measures"] or headroom <= 0 or free <= 0:
        out["measures"].append({"type": "limit",
            "text": "Составы не добавить: линия на пределе пропускной способности",
            "why": "предупредить станции сектора и подготовить регулирование входа на самых загруженных вестибюлях"})
    return out
