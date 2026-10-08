"""Бэктест рекомендаций на 120 днях: прогноз за 30 мин до слота -> коррекция -> проверка по факту."""
import json, sys, numpy as np, pandas as pd
from core import *
from recommend import *

z = np.load(sys.argv[1], allow_pickle=True)
PRED, BASE, X, dstr = z["PRED"], z["BASE"], z["X"], z["days"]
days = pd.DatetimeIndex(dstr)
S = len(SLOTS)
LEAD = 2                                    # решение за 30 мин: 15 мин на команду + выход
grp = np.array([day_group(day_type(d)) for d in days])
LAM = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
SCALE = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
# профиль назначений считаем по будням/выходным отдельно, без данных проверяемого дня
# профиль назначений для месяца m считаем по дням группы вне месяца m (без данных проверяемого дня)
mon = np.array([d.month for d in days])
P_by = {(g, m): attraction(np.median(X[(grp == g) & (mon != m)], axis=0), LAM) for g in set(grp) for m in set(mon)}
plan_p = np.array([plan_pairs(s) for s in range(S)], float)

def day_sim(d, mode="forecast"):
    P = P_by[(grp[d], mon[d])]
    rows = []
    for t in range(LEAD + 4, S):
        if plan_p[t] <= 0:
            continue
        s = t - LEAD
        if mode == "forecast":
            e_hat = PRED[d, s, LEAD]
        elif mode == "norm":                          # без прогноза: норма дня для слота (BASE), без ML-поправки
            e_hat = BASE[d, t]
        elif mode == "reactive":                     # без прогноза: берём последний наблюдённый слот
            e_hat = X[d, s]
        f_act = slot_flows(X[d, t], P[t]) * SCALE
        f_hat = slot_flows(e_hat, P[t]) * SCALE
        k, pairs_new, why = recommend(f_hat, plan_p[t], SLOTS[t] / 60)
        tr_plan = plan_p[t] * SLOT / 60; tr_new = pairs_new * SLOT / 60
        rows.append(dict(t=t, plan=plan_p[t], new=pairs_new, k=k, why=why,
                         f_act=f_act.max(), f_hat=f_hat.max(),
                         load_plan=f_act.max() / tr_plan, load_new=f_act.max() / tr_new))
    df = pd.DataFrame(rows)
    w, k = smooth_removals(list(df.why), list(df.k), list(df.plan))
    df["why"], df["k"] = w, k
    df["new"] = df.plan + df.k / TRAINS_PER_PAIR
    df["load_new"] = df.f_act / (df.new * SLOT / 60)
    return df

def summarize(mode):
    tot = dict(over_plan=0, over_new=0, ex_plan=0.0, ex_new=0.0, warn=0, warn_hit=0, over_events=0,
               removed_trh=0.0, under_viol=0, added_trh=0.0, n=0)
    per_day = {}
    for d in range(len(days)):
        if grp[d] in ("sat", "sun"):           # плановая парность выходных не передана
            continue
        r = day_sim(d, mode)
        op = r.load_plan > NORM_TRAIN; on = r.load_new > NORM_TRAIN
        ex_p = np.maximum(0, r.f_act - NORM_TRAIN * r.plan * SLOT / 60).sum()
        ex_n = np.maximum(0, r.f_act - NORM_TRAIN * r.new * SLOT / 60).sum()
        warn = r.why == "перегруз"
        tot["over_plan"] += op.sum(); tot["over_new"] += on.sum(); tot["ex_plan"] += ex_p; tot["ex_new"] += ex_n
        tot["warn"] += warn.sum(); tot["warn_hit"] += (warn & op).sum(); tot["over_events"] += op.sum()
        rem = (r.why == "недогруз")
        tot["removed_trh"] += (-r.k[rem] * SLOT / 60).sum()
        tot["under_viol"] += (rem & (r.load_new > NORM_TRAIN * 0.95)).sum()
        tot["added_trh"] += (r.k[warn] * SLOT / 60).sum()
        tot["n"] += len(r)
        per_day[str(days[d].date())] = dict(over_plan=int(op.sum()), over_new=int(on.sum()),
                                           ex_plan=float(ex_p), ex_new=float(ex_n),
                                           warn=int(warn.sum()), removed=float((-r.k[rem] * SLOT / 60).sum()))
    return tot, per_day

if __name__ == "__main__":
    out = {}
    for mode in ("forecast", "norm", "reactive"):
        tot, pd_ = summarize(mode)
        out[mode] = tot
        print(mode, {k: round(float(v), 1) for k, v in tot.items()})
        if mode == "forecast":
            json.dump(pd_, open(sys.argv[2], "w"), ensure_ascii=False)
