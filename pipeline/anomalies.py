"""Сколько в году незапланированных отклонений потока (январь–сентябрь 2026, часовой файл).

Аномалия — то, что нельзя заложить в график заранее: сбой или закрытие станции, погода, неожиданный всплеск.
Плановое (праздники, предпраздничные дни, мероприятия, сезонная смена графика) аномалией не считается.
Правила (по часам 07–21, база — медиана того же типа дня за 4 недели, baseline.py):
  incident — на станции вход ≤ 50% обычного хотя бы час при обычном потоке ≥ 1000/ч (закрытие, сбой);
  surge    — сектор или линия выше обычного на 12%+ два часа подряд;
  drop     — сектор или линия ниже обычного на 12%+ два часа подряд;
  local    — одна станция ×1,5+ (обычный поток ≥ 800/ч) при обычной линии — типично для мероприятия.
Дни-праздники и сутки до них исключены как плановые. local на сайте показан отдельно, в число аномалий не входит.
"""
import json, os
import numpy as np
import pandas as pd
import line, data

HRS = np.arange(7, 22)
THR = 0.12


def classify():
    H = json.load(open(os.path.join(data.ROOT, "site", "public", "data", "hourly.json")))
    days = pd.to_datetime(H["days"]); X = np.array(H["x"], float); B = np.array(H["b"], float)
    NI = [line.STATIONS.index(s) for s in line.NORTH]; SI = [line.STATIONS.index(s) for s in line.SOUTH]
    hol = {pd.Timestamp(h) for h in line.HOLIDAYS}
    pre = {h - pd.Timedelta(days=1) for h in hol}
    out = []
    for j, d in enumerate(days):
        x, b = X[j, HRS], B[j, HRS]
        r = lambda idx: (x[:, idx].sum(1) + 300) / (b[:, idx].sum(1) + 300)
        series = {"line": r(slice(None)), "north": r(NI), "south": r(SI)}
        two = lambda v, f: bool((f(v[:-1]) & f(v[1:])).any())
        surge = [k for k, v in series.items() if two(v, lambda a: a > 1 + THR)]
        drop = [k for k, v in series.items() if two(v, lambda a: a < 1 - THR)]
        st = (x + 30) / (b + 30)
        inc = []
        for s in range(data.N):
            for h in range(len(HRS)):
                if b[h, s] >= 1000 and st[h, s] <= 0.5 and line.STATIONS[s] != "Технологический ин-т":
                    inc.append((line.STATIONS[s], int(HRS[h]), round(float(st[h, s]), 2)))
        local = [(line.STATIONS[s], int(HRS[h])) for h, s in zip(*np.where((st >= 1.5) & (b >= 800)))]
        planned = d in hol or d in pre
        kinds = []
        if inc: kinds.append("incident")
        if surge: kinds.append("surge")
        if drop: kinds.append("drop")
        out.append({"d": d.strftime("%Y-%m-%d"), "planned": bool(planned), "kinds": kinds,
                    "incident": inc[:3], "surge": surge, "drop": drop, "local": local[:3],
                    "max": round(float(max(v.max() for v in series.values())), 3),
                    "min": round(float(min(v.min() for v in series.values())), 3)})
    # Повтор на той же станции в тот же час ≥3 дней за 2 недели — плановое закрытие вестибюля или особенность
    # выгрузки, не сбой. Рост 20–31.08 — возврат к учебному ритму до смены графика 01.09: ежегодный и предсказуемый.
    for r in out:
        d = pd.Timestamp(r["d"])
        same = [o for o in out if o["incident"] and abs((pd.Timestamp(o["d"]) - d).days) <= 14
                and any((a[0], a[1]) == (b[0], b[1]) for a in o["incident"] for b in r["incident"])]
        if r["incident"] and len(same) >= 3:
            r["incident"] = []
            r["kinds"] = [k for k in r["kinds"] if k != "incident"]
            r["note"] = "повтор закрытия, плановое"
        if "2026-08-20" <= r["d"] <= "2026-08-31" and "surge" in r["kinds"]:
            r["kinds"] = [k for k in r["kinds"] if k != "surge"]
            r["season"] = True
    return out


if __name__ == "__main__":
    rows = classify()
    df = pd.DataFrame(rows)
    df["m"] = df.d.str[5:7]
    un = df[~df.planned]
    an = un[un.kinds.map(len) > 0]
    print("дней", len(df), "плановых", int(df.planned.sum()), "аномальных", len(an))
    for k in ("incident", "surge", "drop"):
        print(k, int(un.kinds.map(lambda v: k in v).sum()))
    print("только local", int(((un.kinds.map(len) == 0) & (un.local.map(len) > 0)).sum()))
    print(an.groupby("m").size().to_dict())
    for r in an.itertuples():
        print(r.d, r.kinds, r.incident, r.surge, r.drop, r.max, r.min)
