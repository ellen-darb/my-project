"""Проверка по эпизодам: сколько утренних перегрузок (≥2 слотов подряд выше нормы) замечено заранее и за сколько минут.
Сравнение с «обычным днём» без прогноза. Проверочные месяцы — июль и сентябрь."""
import numpy as np
import line, engine, simulate

MORNING = engine.MORNING_END


def runs(mask):
    out, i = [], 0
    while i < len(mask):
        if mask[i]:
            j = i
            while j + 1 < len(mask) and mask[j + 1]:
                j += 1
            if j - i + 1 >= 2:
                out.append((i, j))
            i = j + 1
        else:
            i += 1
    return out


def evaluate(days, X, B, months=(7, 9), min_lead=30):
    res = {k: {"episodes": 0, "caught": 0, "leads": [], "false_alarms": 0, "alarms": 0} for k in ("ratio", "plan")}
    for i, d in enumerate(days):
        if d.month not in months:
            continue
        plan = engine.pairs_profile(line.schedule_for(d))
        for sec in ("north", "south"):
            Lfact = engine.per_train(engine.section_flow(X[i], sec), plan)
            Ltyp = engine.per_train(engine.section_flow(B[i], sec), plan)
            eps = [(a, b) for a, b in runs((Lfact > engine.NORM) & (np.arange(96) < MORNING))]
            pred = {"ratio": {}, "plan": {}}
            for t in simulate.ORIG:
                E, _ = simulate.forecast(X[i], B[i], t)
                Lf = {"ratio": engine.per_train(engine.section_flow(E, sec), plan), "plan": Ltyp}
                win = np.arange(t + 1, min(t + 9, 96))
                for k in pred:
                    over = (Lf[k][win] > engine.NORM) & (win < MORNING)
                    pred[k][t] = set(win[over]) if over.sum() >= 2 else None
            for k in res:
                for a, b in eps:
                    res[k]["episodes"] += 1
                    ts = [t for t in range(a - 8, a - min_lead // 15 + 1) if pred[k].get(t) and any(a <= s <= b for s in pred[k][t])]
                    if ts:
                        res[k]["caught"] += 1
                        res[k]["leads"].append((a - min(ts)) * 15)
                alarm = [t for t, s in pred[k].items() if s]
                res[k]["alarms"] += len(alarm)
                res[k]["false_alarms"] += sum(1 for t in alarm if not any(a - 1 <= s <= b + 1 for s in pred[k][t] for a, b in eps))
    out = {}
    for k, v in res.items():
        out[k] = {"episodes": v["episodes"], "caught": v["caught"], "median_lead_min": float(np.median(v["leads"])) if v["leads"] else None,
                  "alarms": v["alarms"], "false_alarms": v["false_alarms"]}
    return out


if __name__ == "__main__":
    import data, baseline
    days, X = data.load_15min()
    hd, H = data.load_hourly()
    B, _ = baseline.build(days, X, hd, H)
    print(evaluate(days, X, np.round(B)))
