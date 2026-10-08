"""Выгрузка всех чисел для сайта в site/public/data/*.json. Сайт ничего не считает сам — только рисует это.

Запуск: python3 pipeline/export.py  (нужна папка data/ после load_raw.py)
"""
import json, os, time
import numpy as np
import pandas as pd
import line, data, baseline, engine, simulate

OUT = os.path.join(data.ROOT, "site", "public", "data")
TEST_MONTHS = (7, 9)        # проверка; веса прогноза подобраны на феврале и мае


def dump(name, obj):
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(path)


def r(a, nd=0):
    a = np.asarray(a, dtype=float)
    return (np.round(a).astype(int) if nd == 0 else np.round(a, nd)).tolist()


def sector_loads(E, pairs, alpha=line.ALPHA):
    return {s: engine.per_train(engine.section_flow(E, s, alpha), pairs) for s in ("north", "south")}


def main():
    t0 = time.time()
    days, X = data.load_15min()
    hdays, H = data.load_hourly()
    B, _ = baseline.build(days, X, hdays, H)
    ds = [d.strftime("%Y-%m-%d") for d in days]

    # ---------- meta ----------
    meta = {
        "stations": line.STATIONS,
        "sectors": {k: {"title": v["title"], "section": v["section"],
                        "stations": [line.STATIONS.index(s) for s in v["stations"]],
                        "lags": r(engine.LAGS[k], 1)} for k, v in line.SECTORS.items()},
        "schedules": line.SCHEDULES, "hours": line.HOURS,
        "c": {"min_headway_s": line.MIN_HEADWAY_S, "max_pairs": round(line.MAX_PAIRS, 1), "max_trains": line.MAX_TRAINS,
              "turnover": line.TURNOVER_MIN, "cars": line.CARS, "norm_car": line.NORM_PER_CAR, "norm": line.NORM_TRAIN,
              "max_train": line.MAX_TRAIN, "hot_reserve": line.HOT_RESERVE, "hot_lead": line.HOT_LEAD_MIN,
              "cold_lead": line.COLD_LEAD_MIN, "alpha": line.ALPHA, "alpha_range": line.ALPHA_RANGE, "alpha_est": alpha_estimate(hdays, H),
              "run_one_way": line.RUN_ONE_WAY_MIN, "line_km": line.LINE_KM},
        "w_ratio": simulate.W_RATIO,
    }
    meta["quality"] = quality(days, X, hdays, H)
    dump("meta.json", meta)

    # ---------- проигрывание дней ----------
    days_index, effect_rows = [], []
    for i, d in enumerate(days):
        sched, plan, P, log = simulate.run_day(d, X[i], B[i])
        ef = simulate.effect(X[i], plan, P)
        Lp = sector_loads(X[i], plan)
        Ls = sector_loads(X[i], P)
        ratio_day = float(X[i].sum() / max(B[i].sum(), 1))
        decisions = []
        for dec in log:
            row = {"t": dec["t"], "s": dec["status"], "lr": dec["line_ratio"],
                   "fc": {k: v["fc"] for k, v in dec["sectors"].items()},
                   "m": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in m.items()} for m in dec["measures"]]}
            if "window" in dec:
                row["w"] = dec["window"]; row["ck"] = dec["checks"]
            decisions.append(row)
        dump(f"day/{ds[i]}.json", {
            "date": ds[i], "sched": sched, "group": line.day_group(d),
            "x": r(X[i]), "b": r(B[i]), "plan": r(plan, 1), "sys": r(P, 1),
            "load_plan": {k: r(v) for k, v in Lp.items()}, "load_sys": {k: r(v) for k, v in Ls.items()},
            "load_typ": {k: r(v) for k, v in sector_loads(B[i], plan).items()},
            "dec": decisions,
        })
        kinds = [m["type"] for dec in log for m in dec["measures"]]
        first = {}
        for dec in log:
            for m in dec["measures"]:
                first.setdefault(m["type"], dec["t"])
        days_index.append({"d": ds[i], "sched": sched, "g": line.day_group(d), "ratio": round(ratio_day, 3),
                           "entries": int(X[i].sum()),
                           "peak": {k: int(v.max()) for k, v in Lp.items()},
                           "over": int(ef["plan"]["over_pax"]), "over_sys": int(ef["system"]["over_pax"]),
                           "n": {k: kinds.count(k) for k in ("hold", "add", "cut", "limit")}, "first": first})
        effect_rows.append({"d": ds[i], "m": d.month, "sched": sched,
                            **{f"{a}_{k}": float(v) for a in ("plan", "system") for k, v in ef[a].items()}})
    dump("days.json", days_index)
    print("дни", round(time.time() - t0, 1), "с")

    # ---------- точность прогноза на уровне сектора + интервалы ----------
    test = [i for i, d in enumerate(days) if d.month in TEST_MONTHS]
    train = [i for i, d in enumerate(days) if d.month not in TEST_MONTHS]
    err = {h: [] for h in range(1, 9)}             # отношение факт/прогноз потока сектора
    rows = []
    for i in train + test:
        plan = engine.pairs_profile(line.schedule_for(days[i]))
        Ffact = {s: engine.section_flow(X[i], s) for s in ("north", "south")}
        Fbase = {s: engine.section_flow(B[i], s) for s in ("north", "south")}
        for t in simulate.ORIG:
            E, _ = simulate.forecast(X[i], B[i], t)
            for s in ("north", "south"):
                Ff = engine.section_flow(E, s)
                for h in range(1, 9):
                    if t + h >= 96:
                        continue
                    y, p, b = Ffact[s][t + h], Ff[t + h], Fbase[s][t + h]
                    rows.append((i in test, s, h, y, p, b, Ffact[s][t]))
                    if i in train and p > 50:
                        err[h].append(y / p)
    df = pd.DataFrame(rows, columns=["test", "sec", "h", "y", "p", "b", "last"])
    q = {h: np.quantile(err[h], [0.05, 0.1, 0.5, 0.9, 0.95]).round(3).tolist() for h in err}
    te = df[df.test]
    acc = []
    for (s, h), g in te.groupby(["sec", "h"]):
        acc.append({"sec": s, "h": int(h) * 15,
                    "ratio": round(float(np.abs(g.y - g.p).sum() / g.y.sum()), 4),
                    "plan": round(float(np.abs(g.y - g.b).sum() / g.y.sum()), 4),
                    "persist": round(float(np.abs(g.y - g.last).sum() / g.y.sum()), 4)})
    # покрытие интервала 10–90% на проверке
    cover = {}
    for h in range(1, 9):
        g = te[(te.h == h) & (te.p > 50)]
        lo, hi = q[h][1], q[h][3]
        cover[h * 15] = round(float(((g.y >= g.p * lo) & (g.y <= g.p * hi)).mean()), 3)
    print("точность", round(time.time() - t0, 1), "с")

    # ---------- распознавание перегрузки заранее (проверка, июль и сентябрь) ----------
    def blank():
        return {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    det = {"ratio": blank(), "plan": blank()}           # прогноз системы против «обычного дня»
    det_anom = {"ratio": blank(), "plan": blank()}      # только интервалы, где факт на 8%+ выше обычного
    for i in test:
        plan = engine.pairs_profile(line.schedule_for(days[i]))
        Lfact = sector_loads(X[i], plan)
        Ltyp = sector_loads(B[i], plan)
        for t in simulate.ORIG:
            E, _ = simulate.forecast(X[i], B[i], t)
            Lf = {"ratio": sector_loads(E, plan), "plan": Ltyp}
            win = np.arange(t + 1, min(t + 9, 96))
            for s in ("north", "south"):
                over = Lfact[s][win] > engine.NORM
                act = over.sum() >= 2
                act_anom = (over & (Lfact[s][win] > 1.08 * Ltyp[s][win])).sum() >= 2
                for k in det:
                    pred = (Lf[k][s][win] > engine.NORM).sum() >= 2
                    det[k]["tp" if pred and act else "fp" if pred else "fn" if act else "tn"] += 1
                    pa = (Lf[k][s][win] > np.maximum(engine.NORM, 1.08 * Ltyp[s][win])).sum() >= 2
                    det_anom[k]["tp" if pa and act_anom else "fp" if pa else "fn" if act_anom else "tn"] += 1
    for D in (det, det_anom):
        for v in D.values():
            v["precision"] = round(v["tp"] / max(v["tp"] + v["fp"], 1), 3)
            v["recall"] = round(v["tp"] / max(v["tp"] + v["fn"], 1), 3)
    det = {"all": det, "anomalous": det_anom}
    print(json.dumps(det))

    # GBM и модели по станциям — из forecast.py (обучение на феврале и мае)
    import forecast as fc
    fout, *_ = fc.run()
    dump("forecast.json", {"sector": acc, "q": {h * 15: v for h, v in q.items()}, "cover": cover,
                           "detect": det, "station": fout["horizons"], "sector_gbm": fout["sector"],
                           "importance": fout["importance"], "train_days": len(train), "test_days": len(test)})
    print("прогноз", round(time.time() - t0, 1), "с")

    # ---------- эффект ----------
    ef = pd.DataFrame(effect_rows)
    by_m = ef.groupby("m").agg({"plan_over_pax": "sum", "system_over_pax": "sum", "plan_train_h": "sum",
                                "system_train_h": "sum", "plan_wait_min": "sum", "system_wait_min": "sum",
                                "d": "count"}).reset_index()
    dump("effect.json", {"months": by_m.round(1).to_dict("records"),
                         "days": ef[["d", "sched", "plan_over_pax", "system_over_pax", "plan_train_h",
                                     "system_train_h", "plan_wait_min", "system_wait_min"]].round(1).to_dict("records"),
                         "alpha": alpha_sensitivity(days, X, B)})

    # ---------- аномалии: часовой файл январь–сентябрь ----------
    cal = []
    hb_all = np.zeros_like(H)
    for j, d in enumerate(hdays):
        try:
            hb, _ = baseline.hourly_baseline(hdays, H, d)
        except (IndexError, ValueError):
            hb = np.array([np.nan])
        if np.isnan(hb).any():   # начало января: прошлых дней нет, берём тот же тип дня в ближайшие 4 недели
            idx = [k for k, e in enumerate(hdays) if e != d and abs((e - d).days) <= 28
                   and line.day_group(e) == line.day_group(d) and e.strftime("%Y-%m-%d") not in line.HOLIDAYS]
            hb = np.median(H[idx], axis=0)
        hb_all[j] = hb
    for j, d in enumerate(hdays):
        f, b = H[j], hb_all[j]
        dev_h = (f.sum(1) + 50) / (b.sum(1) + 50) - 1
        m = (np.arange(24) >= 6) & (np.arange(24) <= 22)
        st = (f[m] + 30) / (b[m] + 30) - 1               # [час, станция]
        k = np.unravel_index(np.argmax(np.abs(st) * np.sqrt(b[m] + 30)), st.shape)
        cal.append({"d": d.strftime("%Y-%m-%d"), "g": line.day_group(d), "hol": d.strftime("%Y-%m-%d") in line.HOLIDAYS,
                    "dev": round(float(f[m].sum() / max(b[m].sum(), 1) - 1), 3),
                    "top": {"h": int(np.arange(24)[m][k[0]]), "st": int(k[1]), "dev": round(float(st[k]), 2),
                            "x": int(f[m][k]), "b": int(b[m][k])}})
    dump("calendar.json", cal)
    dump("hourly.json", {"days": [d.strftime("%Y-%m-%d") for d in hdays], "x": r(H), "b": r(hb_all)})
    import anomalies
    an = anomalies.classify()
    for c, a in zip(cal, an):
        c.update({k: a[k] for k in ("planned", "kinds", "incident", "surge", "drop", "local")})
        c["season"] = a.get("season", False); c["note"] = a.get("note", "")
    dump("calendar.json", cal)

    # ---------- график против спроса: типичная загрузка состава по часам ----------
    fit = {}
    for sched in ("weekday_sep", "weekday_summer", "weekend"):
        idx = [i for i, d in enumerate(days) if line.schedule_for(d) == sched and ds[i] not in line.HOLIDAYS]
        if sched == "weekday_sep":
            idx = [i for i in idx if days[i].month == 9]
        plan = engine.pairs_profile(sched)
        L = {s: np.stack([engine.per_train(engine.section_flow(X[i], s), plan) for i in idx]) for s in ("north", "south")}
        fit[sched] = {"n": len(idx), "pairs": r(plan, 1),
                      **{s: {"p50": r(np.median(v, 0)), "p10": r(np.quantile(v, .1, 0)), "p90": r(np.quantile(v, .9, 0)),
                             "max": r(v.max(0))} for s, v in L.items()}}
    # Предложение к листу графика «рабочий с 01.09»: парность, при которой медианный день февраля и мая
    # держится в норме (не выше 31 пары). Проверка — на будних днях сентября, которые в подбор не входили.
    plan = engine.pairs_profile("weekday_sep")
    fitdays = [i for i, d in enumerate(days) if line.schedule_for(d) == "weekday_sep" and d.month in (2, 5)]
    Lfit = {s: np.median([engine.per_train(engine.section_flow(X[i], s), plan) for i in fitdays], 0) for s in ("north", "south")}
    need = plan.copy()
    for k in range(96):
        if plan[k] > 0:
            L = max(Lfit["north"][k], Lfit["south"][k])
            need[k] = max(plan[k], min(np.floor(line.MAX_PAIRS), np.ceil(plan[k] * L / line.NORM_TRAIN)))
    sep = [i for i, d in enumerate(days) if line.schedule_for(d) == "weekday_sep" and d.month == 9]
    ev = [simulate.effect(X[i], plan, need) for i in sep]
    fit["weekday_sep"]["need"] = r(need, 1)
    fit["weekday_sep"]["proposal"] = {
        "fit_days": len(fitdays), "test_days": len(sep),
        "extra_train_h_day": round(float(((engine.trains_on_line(need) - engine.trains_on_line(plan)) * 0.25).sum()), 2),
        "over_plan_day": round(float(np.mean([e["plan"]["over_pax"] for e in ev]))),
        "over_new_day": round(float(np.mean([e["system"]["over_pax"] for e in ev]))),
        "wait_saved_h_day": round(float(np.mean([(e["plan"]["wait_min"] - e["system"]["wait_min"]) / 60 for e in ev])), 1)}
    print(fit["weekday_sep"]["proposal"], [(k, plan[k], need[k]) for k in range(96) if need[k] != plan[k]])
    fit["weekday_sep"]["variants"] = proposal_variants(days, X, ds, need)
    dump("schedule_fit.json", fit)
    import economics
    E = json.load(open(os.path.join(OUT, "effect.json")))
    dump("economics.json", economics.run(E["days"], cal))
    print("готово", round(time.time() - t0, 1), "с")


def quality(days, X, hdays, H):
    """Проверка данных: пропуски, нули, согласованность 15-минутного и часового файлов."""
    q = pd.read_csv(os.path.join(data.ROOT, "data", "entries_15min.csv.gz"))
    h = pd.read_csv(os.path.join(data.ROOT, "data", "entries_hourly.csv.gz"))
    tech = line.STATIONS.index("Технологический ин-т")
    m = (data.SLOTS >= 420) & (data.SLOTS < 1260)
    hset = {d: j for j, d in enumerate(hdays)}
    diff = []
    for i, d in enumerate(days):
        if d in hset:
            a = np.delete(X[i].reshape(24, 4, -1).sum(1), tech, axis=1).sum()
            b = np.delete(H[hset[d]], tech, axis=1).sum()
            diff.append(abs(a - b) / b)
    return {"rows_15": len(q), "vest_15": int(q.vestibule.nunique()), "days_15": int(q.date.nunique()),
            "na_15": int(q.entries.isna().sum()), "neg_15": int((q.entries < 0).sum()),
            "zero_station_days_15": int((X[:, m, :].sum(1) == 0).sum()),
            "rows_h": len(h), "vest_h": int(h.vestibule.nunique()), "days_h": len(hdays),
            "missing_h": ["Технологический ин-т"] if (H[:, :, tech].sum() == 0) else [],
            "match_days": len(diff), "match_median": round(float(np.median(diff)), 4), "match_max": round(float(np.max(diff)), 4)}


def alpha_sensitivity(days, X, B):
    """Как меняются перегрузка и эффект Такта при доле α: 0,75 … оценка сверху по данным … 1,0.
    Решения принимаются и оцениваются при одном и том же α — так видно, что от α зависит, а что нет."""
    out = []
    for a in (0.75, 0.85, 0.89, 1.0):
        engine.section_flow.__defaults__ = (a,)
        n_over = 0; op = os_ = th = w = 0.0
        for i, d in enumerate(days):
            plan = engine.pairs_profile(line.schedule_for(d))
            for s in ("north", "south"):
                n_over += int((engine.per_train(engine.section_flow(X[i], s), plan) > engine.NORM).sum())
            _, plan_, P, _ = simulate.run_day(d, X[i], B[i])
            ef = simulate.effect(X[i], plan_, P)
            op += ef["plan"]["over_pax"]; os_ += ef["system"]["over_pax"]
            th += ef["system"]["train_h"] - ef["plan"]["train_h"]; w += (ef["plan"]["wait_min"] - ef["system"]["wait_min"]) / 60
        out.append({"alpha": a, "over_slots": n_over, "over_plan": round(op), "over_sys": round(os_),
                    "train_h": round(th, 1), "wait_h": round(w)})
    engine.section_flow.__defaults__ = (line.ALPHA,)
    return out


def alpha_estimate(hd, H):
    """Оценка α сверху по данным: куда едут утром, судим по тому, где входят вечером (обратная поездка).
    Поездка из станции сектора не пересекает критический перегон, если её цель — другая станция того же сектора.
    Доля таких целей = вечерние входы этих станций / вечерние входы всего метро. Метро целиком = линия 1 × (699 млн /
    годовые входы линии 1). Без поправки на то, что к близким станциям ездят чаще, поэтому это оценка сверху."""
    wd = np.array([d.weekday() < 5 and d.strftime("%Y-%m-%d") not in line.HOLIDAYS for d in hd])
    annual = H.sum() / len(hd) * 365
    R = 699e6 / annual
    eve = H[wd][:, 16:20, :].sum(1).mean(0)
    mor = H[wd][:, 7:10, :].sum(1).mean(0)
    W = eve.sum() * R
    out = {"metro_to_line1": round(float(R), 2)}
    for sec, st in (("north", line.NORTH), ("south", line.SOUTH)):
        idx = [line.STATIONS.index(x) for x in st]
        a = [1 - sum(eve[j] for j in idx if j != i) / W for i in idx]
        out[sec] = round(float(np.average(a, weights=mor[idx])), 3)
    return out


def proposal_variants(days, X, ds, proposal):
    """До какого времени держать утреннюю парность: варианты на будних днях сентября, при разных α."""
    plan = engine.pairs_profile("weekday_sep")
    sep = [i for i, d in enumerate(days) if line.schedule_for(d) == "weekday_sep" and d.month == 9 and ds[i] not in line.HOLIDAYS]
    first_drop = next(k for k in range(32, 60) if plan[k] < plan[k - 1])
    peak = plan[first_drop - 1]
    rows = []
    for end in list(range(first_drop, first_drop + 5)) + [None]:
        if end is None:
            need = proposal
        else:
            need = plan.copy()
            need[first_drop:end] = np.maximum(plan[first_drop:end], peak)
        row = {"until": None if end is None else int(end), "train_h_day": round(float(((engine.trains_on_line(need) - engine.trains_on_line(plan)) * 0.25).sum()), 2)}
        for a in (0.75, 0.85, 0.89):
            engine.section_flow.__defaults__ = (a,)
            ev = [simulate.effect(X[i], plan, need) for i in sep]
            row[str(a)] = {"over_plan": round(float(np.mean([e["plan"]["over_pax"] for e in ev]))),
                           "over_new": round(float(np.mean([e["system"]["over_pax"] for e in ev])))}
            row["wait_h_day"] = round(float(np.mean([(e["plan"]["wait_min"] - e["system"]["wait_min"]) / 60 for e in ev])), 1)
        rows.append(row)
    engine.section_flow.__defaults__ = (line.ALPHA,)
    return {"from": int(first_drop), "peak": float(peak), "rows": rows}


if __name__ == "__main__":
    main()
