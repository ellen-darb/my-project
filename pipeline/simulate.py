"""Проигрывание всех 120 дней по 15 минут: что система рекомендовала бы и что это дало бы на фактическом потоке."""
import json, os
import numpy as np
import pandas as pd
import line, data, baseline, engine

W_RATIO = {1: .6, 2: .55, 3: .55, 4: .5, 5: .5, 6: .45, 7: .45, 8: .4}   # подобрано на феврале и мае (forecast.py)
ORIG = range(6 * 4, 22 * 4)


def forecast(Xd, Bd, t):
    r = (Xd[t - 3:t + 1].sum(0) + 30) / (Bd[t - 3:t + 1].sum(0) + 30)
    E = Xd.copy()
    for h in range(1, 9):
        if t + h < 96:
            E[t + h] = Bd[t + h] * (1 + W_RATIO[h] * (r - 1))
    E[t + 9:] = Bd[t + 9:] * (1 + W_RATIO[8] * (r - 1))
    lr = float((Xd[t - 3:t + 1].sum() + 30) / (Bd[t - 3:t + 1].sum() + 30))
    return E, lr


def run_day(day, Xd, Bd):
    sched = line.schedule_for(day)
    plan = engine.pairs_profile(sched)
    P = plan.copy()
    log = []
    prev = {}
    for t in ORIG:
        E, lr = forecast(Xd, Bd, t)
        dec = engine.decide(P, sched == "weekend", E, Bd, t, lr, plan)
        dec["line_ratio"] = round(lr, 3)
        for m in dec["measures"]:       # одна и та же мера в соседних слотах — это «действует», а не новый совет
            m["repeat"] = m["type"] in ("limit", "watch", "late") and prev.get(m["type"], -9) >= t - 1
            if m["type"] in ("limit", "watch", "late"):
                prev[m["type"]] = t
        for m in dec["measures"]:
            a, b = m.get("from", t + 1), m.get("to", t + 8)
            if m["type"] == "hold":
                P[a:b + 1] = np.maximum(P[a:b + 1], m["pairs"])
            elif m["type"] == "add":
                P[a:b + 1] = np.maximum(P[a:b + 1], np.minimum(plan[a:b + 1] + m["pairs"], np.floor(line.MAX_PAIRS)))   # никогда не ниже уже действующего
            elif m["type"] == "cut":
                P[a:b + 1] = np.minimum(P[a:b + 1], plan[a:b + 1] - m["pairs"])
        log.append(dec)
    return sched, plan, P, log


def effect(Xd, plan, P):
    res = {}
    for name, pp in (("plan", plan), ("system", P)):
        over = 0.0
        for sec in ("north", "south"):
            L = engine.per_train(engine.section_flow(Xd, sec), pp)
            over += (np.maximum(L - engine.NORM, 0) * pp / 4).sum()
        ent = Xd.sum(1)
        wait = (ent * np.where(pp > 0, 30.0 / np.maximum(pp, 1e-9), 0)).sum()     # мин: средн. ожидание = интервал/2
        train_h = (engine.trains_on_line(pp) * 0.25).sum()
        res[name] = {"over_pax": over, "wait_min": wait, "train_h": train_h}
    return res


if __name__ == "__main__":
    days, X = data.load_15min()
    hd, H = data.load_hourly()
    B, _ = baseline.build(days, X, hd, H)
    rows = []
    for i, d in enumerate(days):
        sched, plan, P, log = run_day(d, X[i], B[i])
        ef = effect(X[i], plan, P)
        kinds = [m["type"] for dec in log for m in dec["measures"]]
        rows.append({"day": d.date(), "sched": sched, **{f"n_{k}": kinds.count(k) for k in ("hold", "add", "cut", "limit")},
                     "over_plan": ef["plan"]["over_pax"], "over_sys": ef["system"]["over_pax"],
                     "wait_saved_h": (ef["plan"]["wait_min"] - ef["system"]["wait_min"]) / 60,
                     "train_h_delta": ef["system"]["train_h"] - ef["plan"]["train_h"]})
    df = pd.DataFrame(rows)
    pd.set_option("display.width", 220)
    print(df.groupby(df.day.map(lambda x: x.month)).agg({"n_hold": "sum", "n_add": "sum", "n_cut": "sum", "n_limit": "sum",
          "over_plan": "sum", "over_sys": "sum", "wait_saved_h": "sum", "train_h_delta": "sum"}).round(0))
    print(df.sort_values("over_plan", ascending=False).head(10).round(0).to_string())
