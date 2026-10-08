"""Экспорт данных для веб-интерфейса: метрики бэктеста + проигрывание трёх реальных дней."""
import json, sys, numpy as np, pandas as pd
OUT = sys.argv[2]
sys.argv = [sys.argv[0], sys.argv[1], "/dev/null"] + sys.argv[3:]
exec(open("backtest.py").read().split('if __name__')[0])

DEMO = [("2026-05-08", "Пятница перед майскими: после обеда поток на треть выше нормы"),
        ("2026-02-03", "Обычный вторник: утренний пик у границы нормы"),
        ("2026-09-15", "Обычный вторник: утренний пик выше плана")]
HHMM = lambda m: f"{int(m)//60:02d}:{int(m)%60:02d}"

def seg_info(e, P_t):
    T = e[:, None] * P_t
    best = (0, None, None)
    for s in range(N - 1):
        for dr, v in ((0, T[: s + 1, s + 1:]), (1, T[s + 1:, : s + 1])):
            if v.sum() > best[0]:
                best = (v.sum(), s, dr)
    f, s, dr = best
    contrib = (T[: s + 1, s + 1:].sum(1) if dr == 0 else T[s + 1:, : s + 1].sum(1))
    idx = np.arange(s + 1) if dr == 0 else np.arange(s + 1, N)
    order = np.argsort(-contrib)[:3]
    feeders = [dict(station=STATIONS[idx[o]], share=round(float(contrib[o] / f), 3)) for o in order]
    return dict(flow=float(f), seg=int(s), dir=int(dr), feeders=feeders,
                name=f"{STATIONS[s]} – {STATIONS[s+1]}" if dr == 0 else f"{STATIONS[s+1]} – {STATIONS[s]}")

res = {}
for ds, title in DEMO:
    d = list(dstr).index(ds)
    P = P_by[(grp[d], mon[d])]
    line_act = X[d].sum(1); line_base = BASE[d].sum(1)
    steps = []
    for s in range(4, S - LEAD):
        t = s + LEAD
        if plan_p[t] <= 0 or SLOTS[s] < 6 * 60:
            continue
        ratio = float((line_act[s - 3:s + 1].sum() + 1) / (line_base[s - 3:s + 1].sum() + 1))
        e_hat = PRED[d, s, LEAD]
        info = seg_info(e_hat * SCALE, P[t])
        k, new, why = recommend(np.array([info["flow"]] * 2), plan_p[t], SLOTS[t] / 60)
        f_act = slot_flows(X[d, t], P[t]) * SCALE
        tr_p = plan_p[t] * SLOT / 60; tr_n = new * SLOT / 60
        remain = info["flow"] / tr_n
        fc = [float(np.nansum(PRED[d, s, h])) for h in range(1, 9) if s + h < S]
        fb = []
        steps.append(dict(_fh=info['flow'], _fa=float(f_act.max()), _t=int(t),
            time=HHMM(SLOTS[s]), target=HHMM(SLOTS[t]), ratio=round(ratio, 3),
            anomaly=("аномально высокий" if ratio >= 1.20 else "повышенный" if ratio >= 1.10 else "аномально низкий" if ratio <= 0.80 else "пониженный" if ratio <= 0.90 else "типичный"),
            fc=[round(x) for x in fc],
            plan=float(plan_p[t]), new=round(float(new), 1), k=int(k), why=why,
            load_hat_plan=round(info["flow"] / tr_p), load_hat_new=round(remain),
            load_act_plan=round(float(f_act.max() / tr_p)), load_act_new=round(float(f_act.max() / tr_n)),
            seg=info["name"], feeders=info["feeders"],
            capped=bool(remain > NORM_TRAIN * 0.98 and k > 0),
            st_act=[int(x) for x in X[d, s]], st_base=[int(x) for x in BASE[d, s]]))
    ws, ks = smooth_removals([x["why"] for x in steps], [x["k"] for x in steps], [x["plan"] for x in steps])
    for st, w_, k_ in zip(steps, ws, ks):
        st["why"], st["k"] = w_, k_
        st["new"] = round(st["plan"] + st["k"] / TRAINS_PER_PAIR, 1)
        trp, trn = st["plan"] * SLOT / 60, st["new"] * SLOT / 60
        st["load_hat_plan"], st["load_hat_new"] = round(st["_fh"] / trp), round(st["_fh"] / trn)
        st["load_act_plan"], st["load_act_new"] = round(st["_fa"] / trp), round(st["_fa"] / trn)
        st["capped"] = bool(st["load_hat_new"] > NORM_TRAIN * 0.98 and st["k"] > 0)
        st["warn_only"] = bool(st["k"] > 0 and st["load_hat_plan"] <= NORM_TRAIN)
        for q in ("_fh", "_fa", "_t"):
            st.pop(q)
    res[ds] = dict(title=title, weekday=days[d].day_name(), type=day_type(days[d]),
                   slots=[HHMM(m) for m in SLOTS], act=[int(x) for x in line_act], base=[int(x) for x in line_base],
                   plan_pairs=[float(x) for x in plan_p], steps=steps)

tot_f, perday = summarize("forecast"); tot_r, _ = summarize("reactive"); tot_n, _ = summarize("norm")
nd = len(perday)
flag_days = 0
for d in range(len(days)):
    if grp[d] in ("sat", "sun"):
        continue
    r = np.array([(X[d].sum(1)[s - 3:s + 1].sum() + 1) / (BASE[d].sum(1)[s - 3:s + 1].sum() + 1) for s in range(24, 72)])
    hi = (r >= 1.20); lo = (r <= 0.80)
    if (hi[1:] & hi[:-1]).any() or (lo[1:] & lo[:-1]).any():
        flag_days += 1
# качество прогноза (по линии и по станциям), только будни
mask = np.array([g not in ("sat", "sun") for g in grp])
err = {}
for h in (1, 2, 4, 8):
    num_b = num_m = num_bl = den = 0.0; n_b = n_m = 0.0
    for d in np.where(mask)[0]:
        for s in range(8, S - h):
            a = X[d, s + h]; m = PRED[d, s, h]; b = BASE[d, s + h]
            num_m += np.abs(m - a).sum(); num_b += np.abs(b - a).sum(); den += a.sum()
            n_m += abs(m.sum() - a.sum()); n_b += abs(b.sum() - a.sum())
    err[h * 15] = dict(st_base=num_b / den, st_ml=num_m / den, line_base=n_b / den, line_ml=n_m / den)
metrics = dict(days=nd, slots=tot_f["n"], flag_days=flag_days, forecast=tot_f, reactive=tot_r, norm=tot_n, err=err,
               plan_trh_day=sum(PLAN_PAIRS[h] * TURNOVER_MIN / 60 for h in PLAN_PAIRS),
               lam=LAM, scale=SCALE, warn_util=WARN_UTIL, norm_train=NORM_TRAIN)
json.dump(dict(metrics=metrics, days=res, stations=STATIONS,
               limits=dict(headway_s=MIN_HEADWAY_S, max_trains=MAX_TRAINS, turnover=TURNOVER_MIN, reserve=RESERVE_TRAINS,
                           norm_car=NORM_PER_CAR, cars=CARS, max_pairs=round(MAX_PAIRS_H, 1), reserve_lead_min=RESERVE_LEAD_MIN)),
          open(OUT, "w"), ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
js = open(OUT).read()
open(OUT.replace('.json', '.js'), 'w').write('window.DATA = ' + js + ';')
print(json.dumps(metrics, ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o)))
