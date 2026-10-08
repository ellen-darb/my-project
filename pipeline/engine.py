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


def pairs_profile(sched):
    """Пар/ч на каждый 15-мин слот. В 05 ч движение начинается около 05:30."""
    p = np.array([line.pairs_at(sched, int(m)) for m in data.SLOTS], dtype=float)
    p[20:22] = 0.0
    p[22:24] *= 2
    return p


def trains_on_line(pairs):
    return np.round(pairs * line.TURNOVER_MIN / 60)


def section_flow(E, sector, alpha=line.ALPHA):
    """Входы [слот, станция] -> поток через критический перегон к центру [слот], со сдвигом на время в пути."""
    S = E.shape[0]
    out = np.zeros(S)
    for st, lag in zip(SEC[sector], LAGS[sector]):
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


def decide(pairs, weekend, E, Bd, t, line_ratio, plan=None):
    """Решение в момент t по прогнозу E (факт до t, прогноз после). pairs — действующая парность
    (с уже принятыми мерами), plan — исходный лист графика. Возвращает статус и меры."""
    plan = pairs if plan is None else plan
    win = np.arange(t + 1, min(t + 1 + W, 96))
    out = {"t": int(t), "status": "ok", "sectors": {}, "measures": [], "checks": []}
    worst = None
    for sec in ("north", "south"):
        Lf = per_train(section_flow(E, sec), pairs)[win]
        Lt = per_train(section_flow(Bd, sec), pairs)[win]
        over = Lf > NORM
        anomal = over & (Lf > 1.08 * Lt)
        out["sectors"][sec] = {"fc": Lf.round(0).tolist(), "typ": Lt.round(0).tolist()}
        if over.sum() >= 2:
            score = (anomal.sum(), Lf.max())
            if worst is None or score > worst[0]:
                worst = (score, sec, over, anomal, Lf)
    rel = None
    if line_ratio > 1.15:
        rel = "high"
    elif line_ratio < 0.85:
        rel = "low"

    Lmax_all = max(max(v["fc"]) for v in out["sectors"].values())
    if worst is None and rel == "high" and Lmax_all < 0.85 * NORM:
        # поток выше обычного, но там, где загрузку можно измерить, места хватает: составы не добавляем
        out["status"] = "anomaly"
        out["window"] = {"sector": "line", "from": int(win[0]), "to": int(win[-1]), "lead_min": 15, "pairs": float(pairs[t + 1]),
                         "trains": int(trains_on_line(pairs[t + 1])), "need_pairs": 0, "peak": round(Lmax_all)}
        out["measures"].append({"type": "watch",
                                "text": f"Составы не добавлять: к центру до {Lmax_all:.0f} чел. в составе ({Lmax_all / NORM:.0%} нормы)",
                                "why": "поток выше обычного, но на перегонах, где загрузку можно оценить, место есть; "
                                       "по центру — доклады дежурных станций"})
        return out
    if worst is not None or rel == "high":
        if worst is not None:
            _, sec, over, anomal, Lf = worst
            idx = np.where(over)[0]
            s0, s1 = int(win[idx[0]]), int(win[idx[-1]])
            mult = float(Lf[idx].max() / NORM)
            out["status"] = "anomaly" if anomal.sum() >= 2 else "structural"
        else:
            sec, s0, s1, mult = "line", int(win[0]), int(win[-1]), line_ratio
            out["status"] = "anomaly"
        lead = (s0 - t) * 15
        p_now, p_s0 = float(pairs[t]), float(pairs[s0])
        need = max(0, math.ceil(p_s0 * mult) - p_s0)
        out["window"] = {"sector": sec, "from": s0, "to": s1, "lead_min": lead, "pairs": p_s0,
                         "trains": int(trains_on_line(p_s0)), "need_pairs": need, "peak": round(mult * NORM)}
        # 1) не снимать составы, если график снижает парность внутри окна перегрузки
        if pairs[s0:s1 + 1].min() < p_now and out["status"] != "ok":
            keep = p_now
            out["measures"].append({"type": "hold", "pairs": keep, "from": int(t + 1), "to": s1,
                                    "text": f"Не снимать составы до {t_str(s1 + 1)}: держать {keep:.0f} пар/ч",
                                    "why": "по графику парность снижается, а поток ещё выше нормы; составы уже на линии, ввод не нужен"})
            p_s0 = max(p_s0, keep)
        headroom = math.floor(line.MAX_PAIRS) - p_s0
        free = int(line.MAX_TRAINS - trains_on_line(p_s0))
        add = int(min(need, max(headroom, 0), max(free, 0) * 60 / line.TURNOVER_MIN))
        out["checks"] = [
            {"rule": "Запас по интервалу 1:53", "ok": headroom > 0, "note": f"{p_s0:.0f} из 31,9 пар/ч"},
            {"rule": "Свободные составы", "ok": free > 0, "note": f"на линии {int(trains_on_line(p_s0))} из 53"},
            {"rule": "Резерв успевает", "ok": lead >= line.HOT_LEAD_MIN, "note": f"{lead} мин до начала, выход 15–20"},
        ]
        if add > 0 and (out["status"] == "anomaly" or rel == "high" or need > 0):
            tr = math.ceil(add * line.TURNOVER_MIN / 60)
            depot = {"north": "Северное", "south": "Автово"}.get(sec, "Автово и Северное")
            on_time = lead >= line.HOT_LEAD_MIN
            # составы, которые график и так выпускает в ближайший час, можно выпустить раньше
            early = trains_on_line(plan[min(s0 + 4, 95)]) - trains_on_line(plan[s0]) >= tr
            text = (f"Выпустить {tr} сост. раньше графика из депо {depot}, +{add} пар/ч" if early
                    else f"Выдать {tr} сост. из резерва депо {depot}, +{add} пар/ч")
            out["measures"].append({
                "type": "add", "pairs": add, "trains": tr, "depot": depot, "from": int(max(s0, t + line.HOT_LEAD_MIN // 15 + 1)),
                "to": s1, "hot": min(tr, HOT), "on_time": on_time, "early": bool(early),
                "text": text,
                "why": ("резерв выходит за 15–20 мин и успевает" if on_time else
                        f"перегрузка через {lead} мин: резерв успеет только к {t_str(t + line.HOT_LEAD_MIN // 15 + 1)}")})
        if out["status"] == "anomaly" and add <= 0:
            out["measures"].append({"type": "limit",
                                    "text": "Составы не добавить: линия на пределе пропускной способности",
                                    "why": "предупредить станции сектора и подготовить регулирование входа на самых загруженных вестибюлях"})
    elif rel == "low":
        Lmax = max(max(v["fc"]) for v in out["sectors"].values())
        p_now = float(pairs[t + 1])
        floor = line.min_pairs(int(data.SLOTS[t + 1] // 60), weekend)
        target = max(math.ceil(floor), math.ceil(p_now * line_ratio / 0.95))
        cut = int(p_now - target)
        if cut >= 2 and Lmax < 0.7 * NORM:
            tr = math.floor(cut * line.TURNOVER_MIN / 60)
            out["status"] = "low"
            out["measures"].append({"type": "cut", "pairs": cut, "trains": tr, "from": int(t + 1), "to": int(win[-1]),
                                    "text": f"Снять {tr} сост. в депо, −{cut} пар/ч",
                                    "why": f"поток {round((line_ratio - 1) * 100)}% к обычному дню; загрузка остаётся ниже 70% нормы, интервал в пределах графика"})
    return out
