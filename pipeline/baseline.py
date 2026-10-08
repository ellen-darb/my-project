"""«Обычный день»: база потока по станции и 15-мин слоту, строго по прошлым дням.

Часовой уровень — медиана того же типа дня за 4 предыдущие недели (часовой файл, январь–сентябрь).
Форма внутри часа — доли четвертей часа по 15-мин дням других месяцев (на уровень не влияет).
"""
import numpy as np
import pandas as pd
import line, data

GROUPS = ["mon-thu", "fri", "sat", "sun"]


def regime(d):
    """Сезон графика: летний рабочий график действует с 01.06 по 31.08, учебный — с 01.09 по 31.05."""
    return "summer" if 6 <= d.month <= 8 else "school"


def hourly_baseline(hdays, H, target_day, lookback_days=28):
    """Медиана того же типа дня за 4 прошлые недели того же сезона графика. Сразу после смены сезона
    (01.06, 01.09) прошлых дней сезона мало: тогда берём последние 4 недели этого сезона раньше в году."""
    grp = line.day_group(target_day)
    ok = lambda d: (line.day_group(d) == grp and d.strftime("%Y-%m-%d") not in line.HOLIDAYS
                    and regime(d) == regime(target_day) and d < target_day)
    idx = np.where([ok(d) and d >= target_day - pd.Timedelta(days=lookback_days) for d in hdays])[0]
    if len(idx) < 3:
        cand = [i for i, d in enumerate(hdays) if ok(d)]
        idx = np.array(cand[-(lookback_days // 7):]) if grp != "mon-thu" else np.array(cand[-16:])
    if grp == "sun" and len(idx) < 3:      # праздник/воскресенье: добираем воскресенья
        idx = np.where([target_day - pd.Timedelta(days=56) <= d < target_day and d.weekday() == 6
                        for d in hdays])[0]
    return np.median(H[idx], axis=0), len(idx)


def quarter_shape(days, X, target_day):
    """Доли 4 четвертей в каждом часе [24, 4, N] по дням того же типа из других месяцев."""
    grp = line.day_group(target_day)
    idx = [i for i, d in enumerate(days) if d.month != target_day.month and line.day_group(d) == grp]
    S = X[idx].sum(0).reshape(24, 4, -1)
    tot = S.sum(1, keepdims=True)
    shape = np.where(tot > 0, S / np.maximum(tot, 1e-9), 0.25)
    return shape


def build(days, X, hdays, H):
    """База B[день, слот, станция] для всех 15-мин дней."""
    B = np.zeros_like(X)
    tech = line.STATIONS.index("Технологический ин-т")
    info = []
    for i, d in enumerate(days):
        hb, n = hourly_baseline(hdays, H, d)
        sh = quarter_shape(days, X, d)
        b = (hb[:, None, :] * sh).reshape(96, -1)
        # Технологический ин-т в часовом файле отсутствует: берём медиану того же типа дня из 15-мин
        # дней других месяцев с поправкой на уровень линии.
        grp = line.day_group(d)
        idx = [j for j, e in enumerate(days) if e.month != d.month and line.day_group(e) == grp]
        lvl = b.sum() / max(np.median(X[idx].sum((1, 2))), 1)
        b[:, tech] = np.median(X[idx, :, tech], axis=0) * lvl
        B[i] = b
        info.append(n)
    return B, info


if __name__ == "__main__":
    days, X = data.load_15min()
    hdays, H = data.load_hourly()
    B, info = build(days, X, hdays, H)
    print("дней с базой <3:", sum(1 for n in info if n < 3))
    tot = X.sum((1, 2)); btot = B.sum((1, 2))
    r = tot / btot - 1
    df = pd.DataFrame({"day": days, "dev": r}).sort_values("dev")
    print(df.head(8).to_string()); print(df.tail(8).to_string())
    m = (data.SLOTS >= 360) & (data.SLOTS < 1380)
    wape = np.abs(X[:, m] - B[:, m]).sum() / X[:, m].sum()
    print("WAPE базы по станциям и слотам 06–23:", round(wape, 3))
