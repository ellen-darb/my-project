"""Прогноз входов по станциям на 15–120 минут и проверка на истории.

Модели (все видят только прошлое относительно момента прогноза t):
  plan    — «обычный день» B (то, на что рассчитан график);
  persist — последнее наблюдение;
  ratio   — B × поправка дня: отношение факта к базе за последний час, с весом w(h);
  gbm     — LightGBM по отношению факт/база (признаки: поправки станции, сектора и линии, лаги, время).
Проверка во времени: обучение на феврале и мае, проверка на июле и сентябре.
"""
import json, os
import numpy as np
import pandas as pd
import lightgbm as lgb
import line, data, baseline

H_MAX = 8                                   # 8 × 15 мин = 120 мин
ORIGINS = np.arange(6 * 4, 22 * 4)          # моменты прогноза 06:00–21:45
SECTOR_IDX = {k: [line.STATIONS.index(s) for s in v["stations"]] for k, v in line.SECTORS.items()}
st_sector = np.full(data.N, 2)
for k, ids in SECTOR_IDX.items():
    st_sector[ids] = 0 if k == "north" else 1
SMOOTH = 30.0


def ratio(xs, bs):
    return (xs.sum(0) + SMOOTH) / (bs.sum(0) + SMOOTH)


def features(X, B, d, t, h):
    """Признаки для всех станций в момент t (последний наблюдённый слот) и горизонта h."""
    x, b = X[d], B[d]
    r1 = ratio(x[t - 3:t + 1], b[t - 3:t + 1])                  # поправка станции за час
    r2 = ratio(x[t - 7:t + 1], b[t - 7:t + 1])                  # за 2 часа
    lx, lb = x[t - 3:t + 1].sum(1), b[t - 3:t + 1].sum(1)
    rl = (lx.sum() + SMOOTH) / (lb.sum() + SMOOTH)               # линия целиком
    rs = np.array([(x[t - 3:t + 1, SECTOR_IDX[k]].sum() + SMOOTH) / (b[t - 3:t + 1, SECTOR_IDX[k]].sum() + SMOOTH)
                   for k in ("north", "south")] + [rl])[st_sector]
    cum = (x[:t + 1].sum() + SMOOTH) / (b[:t + 1].sum() + SMOOTH)
    last = (x[t] + 5) / (b[t] + 5)
    tgt = t + h
    F = np.column_stack([
        np.log1p(b[tgt]), np.log(r1), np.log(r2), np.log(rs), np.full(data.N, np.log(rl)),
        np.full(data.N, np.log(cum)), np.log(last), np.full(data.N, tgt), np.full(data.N, h),
        np.arange(data.N), np.full(data.N, ["mon-thu", "fri", "sat", "sun"].index(line.day_group(DAYS[d]))),
        np.log1p(b[tgt]) - np.log1p(b[t] + 1),
    ])
    return F, r1


def build_rows(day_idx, X, B):
    rows, ys, bases, meta = [], [], [], []
    for d in day_idx:
        for t in ORIGINS:
            for h in range(1, H_MAX + 1):
                F, _ = features(X, B, d, t, h)
                rows.append(F)
                ys.append(X[d, t + h]); bases.append(B[d, t + h])
                meta.append(np.column_stack([np.full(data.N, d), np.full(data.N, t), np.full(data.N, h), np.arange(data.N)]))
    return np.vstack(rows), np.concatenate(ys), np.concatenate(bases), np.vstack(meta).astype(int)


def wape(y, p):
    return float(np.abs(y - p).sum() / y.sum())


def run():
    global DAYS
    days, X = data.load_15min()
    DAYS = days
    hdays, H = data.load_hourly()
    B, _ = baseline.build(days, X, hdays, H)
    train = [i for i, d in enumerate(days) if d.month in (2, 5)]
    test = [i for i, d in enumerate(days) if d.month in (7, 9)]
    Ftr, ytr, btr, mtr = build_rows(train, X, B)
    Fte, yte, bte, mte = build_rows(test, X, B)
    # целевая переменная — лог отношения факта к базе
    ttr = np.log((ytr + 5) / (btr + 5))
    w = np.sqrt(btr + 5)
    model = lgb.LGBMRegressor(n_estimators=600, learning_rate=0.03, num_leaves=63, min_child_samples=80,
                              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, verbose=-1)
    model.fit(Ftr, ttr, sample_weight=w, categorical_feature=[9, 10])
    p_gbm = np.maximum((bte + 5) * np.exp(model.predict(Fte)) - 5, 0)

    # ratio: вес поправки по горизонту подбираем на обучении
    r1_tr = np.exp(Ftr[:, 1]); r1_te = np.exp(Fte[:, 1])
    wbest = {}
    for h in range(1, H_MAX + 1):
        m = mtr[:, 2] == h
        best = min(np.linspace(0, 1.2, 25), key=lambda a: np.abs(ytr[m] - btr[m] * (1 + a * (r1_tr[m] - 1))).sum())
        wbest[h] = float(best)
    p_ratio = bte * (1 + np.array([wbest[h] for h in mte[:, 2]]) * (r1_te - 1))
    p_persist = X[mte[:, 0], mte[:, 1], mte[:, 3]]
    preds = {"plan": bte, "persist": p_persist, "ratio": p_ratio, "gbm": p_gbm}

    out = {"horizons": [], "sector": [], "w_ratio": wbest}
    for h in range(1, H_MAX + 1):
        m = mte[:, 2] == h
        out["horizons"].append({"h": h * 15, **{k: round(wape(yte[m], v[m]), 4) for k, v in preds.items()}})
    # уровень сектора (то, на чём принимается решение)
    for sec, ids in SECTOR_IDX.items():
        for h in range(1, H_MAX + 1):
            m = (mte[:, 2] == h) & np.isin(mte[:, 3], ids)
            key = mte[m][:, :2]
            agg = lambda v: pd.Series(v[m]).groupby([key[:, 0], key[:, 1]]).sum().values
            ys = agg(yte)
            out["sector"].append({"sector": sec, "h": h * 15, **{k: round(wape(ys, agg(v)), 4) for k, v in preds.items()}})
    fi = dict(zip(["база", "поправка станции 1ч", "поправка станции 2ч", "поправка сектора", "поправка линии",
                   "поправка с начала дня", "последний слот", "время цели", "горизонт", "станция", "тип дня", "наклон базы"],
                  model.booster_.feature_importance("gain").round(0).tolist()))
    out["importance"] = fi
    out["n_test_points"] = int(len(yte)); out["test_days"] = len(test); out["train_days"] = len(train)
    return out, model, days, X, B, wbest


if __name__ == "__main__":
    out, *_ = run()
    print(json.dumps(out["horizons"], ensure_ascii=False, indent=0))
    print(pd.DataFrame(out["sector"]).to_string())
    print(out["importance"], out["w_ratio"])
