"""Ядро: данные, календарь, базовый профиль, прогноз, модель загрузки перегонов, рекомендации."""
import re
import numpy as np, pandas as pd

# --- Линия 1, станции с юга-запада на север (индекс = положение на линии) ---
STATIONS = ["Пр.Ветеранов", "Ленинский пр.", "Автово", "Кировский завод", "Нарвская", "Балтийская",
            "Технологический институт", "Пушкинская", "Владимирская", "Пл. Восстания", "Чернышевская",
            "Пл.Ленина", "Выборгская", "Лесная", "Пл. Мужества", "Политехническая", "Академическая",
            "Гражданский пр.", "Девяткино"]
N = len(STATIONS)
SLOT = 15                      # минут
SLOTS = np.arange(5 * 60, 24 * 60, SLOT)   # 05:00..23:45, движение

# --- Ограничения линии (ментор + файлы) ---
TURNOVER_MIN = 99              # полный оборот туда-обратно
MIN_HEADWAY_S = 113            # 1:53
MAX_TRAINS = 53
MAX_PAIRS_H = 60 * 60 / MIN_HEADWAY_S      # 31.9 пар/ч
CARS = 8
NORM_PER_CAR = 120             # норма населённости вагона
NORM_TRAIN = NORM_PER_CAR * CARS           # 960
MAX_TRAIN = 1458               # предельная вместимость состава
RESERVE_TRAINS = 4             # 2 + 2 (Автово, Северное)
RESERVE_LEAD_MIN = 15          # выход резерва на линию, 15-20 мин (7 мин по чату)
# плановая парность по часам (пар/ч), «График оборота составов»
PLAN_PAIRS = {5: 5, 6: 20, 7: 28, 8: 30, 9: 25, 10: 21, 11: 19, 12: 18, 13: 18, 14: 20, 15: 22,
              16: 25, 17: 27, 18: 29, 19: 25, 20: 20, 21: 15, 22: 14, 23: 9}

HOLIDAYS = {"2026-02-23", "2026-05-01", "2026-05-11"}        # в данных: 23.02, 1.05, перенос 9.05 -> 11.05
PRE_HOLIDAYS = {"2026-02-20", "2026-05-08"}                   # пятница перед длинными выходными


def station_of(v):
    return re.sub(r"-\d$", "", v)


def to_matrix(df):
    """long -> массив [день, слот, станция] (входы по станциям, вестибюли сложены)."""
    d = df.copy()
    d["st"] = d.station.map(station_of)
    d = d[d.minute.isin(SLOTS)]
    g = d.groupby(["date", "minute", "st"]).entries.sum().unstack("st")[STATIONS]
    days = sorted(g.index.get_level_values(0).unique())
    X = np.zeros((len(days), len(SLOTS), N))
    ix = {m: k for k, m in enumerate(SLOTS)}
    for di, day in enumerate(days):
        sub = g.loc[day]
        for m, row in sub.iterrows():
            X[di, ix[m]] = row.values
    return pd.DatetimeIndex(days), X


def day_type(ts):
    s = ts.strftime("%Y-%m-%d")
    if s in HOLIDAYS:
        return "hol"
    if s in PRE_HOLIDAYS:
        return "pre"
    wd = ts.weekday()
    if wd == 4:
        return "fri"
    return "wd" if wd < 4 else ("sat" if wd == 5 else "sun")


def day_group(t):
    """группы для базы: будни (пн-чт) / пятница / суббота / воскресенье / праздник."""
    return {"pre": "fri"}.get(t, t) if t != "hol" else "sun"


def baseline(days, X, exclude=None, season=True):
    """season=False: база по другим месяцам (одинаково для обучающих и проверяемых дней)."""
    """База [день, слот, станция]: медиана по дням той же группы (кроме самого дня).
    Сезонность учитывается через ближайшие по месяцу дни, если их >=3."""
    grp = np.array([day_group(day_type(d)) for d in days])
    mon = np.array([d.month for d in days])
    B = np.zeros_like(X)
    for i, d in enumerate(days):
        mask = (grp == grp[i]) & (np.arange(len(days)) != i)
        if exclude is not None:
            mask &= ~exclude
        same_m = mask & (mon == mon[i])
        use = same_m if (season and same_m.sum() >= 3) else (mask & (mon != mon[i]))
        B[i] = np.median(X[use], axis=0)
    return B


# --- Загрузка перегонов (допущения: гравитационная модель, зеркальные поездки) ---
def attraction(Xday_prof, lam=6.0):
    """P(j|i,слот): веса назначения = зеркальный профиль входов (утренние выходы ~ вечерние входы)."""
    S = len(SLOTS)
    shift = int(9 * 60 / SLOT)
    dist = np.exp(-np.abs(np.arange(N)[:, None] - np.arange(N)[None, :]) / lam)
    np.fill_diagonal(dist, 0)
    P = np.zeros((S, N, N))
    for s in range(S):
        m = (s + shift) % S if SLOTS[s] < 12 * 60 + 30 else (s - shift) % S
        a = Xday_prof[m] + 1.0
        w = dist * a[None, :]
        P[s] = w / w.sum(1, keepdims=True)
    return P


def segment_flows(entries, P):
    """entries [слот, станция] -> потоки на перегонах [слот, перегон, направление(0=вверх к Девяткино,1=вниз)]."""
    S = entries.shape[0]
    F = np.zeros((S, N - 1, 2))
    for s in range(S):
        T = entries[s][:, None] * P[s]          # i -> j
        for seg in range(N - 1):
            F[s, seg, 0] = T[: seg + 1, seg + 1:].sum()   # i<=seg, j>seg
            F[s, seg, 1] = T[seg + 1:, : seg + 1].sum()
    return F


def trains_per_slot(pairs_h, add=0.0):
    return (pairs_h + add) * SLOT / 60.0         # поездов в одном направлении за слот


def plan_pairs(slot_idx):
    return PLAN_PAIRS.get(int(SLOTS[slot_idx] // 60), 0)


def load_per_train(F, trains):
    """Средняя населённость состава на самом нагруженном перегоне. F [слот,перегон,напр]."""
    peak = F.max(axis=1)                          # [слот, напр]
    return peak / np.maximum(trains[:, None], 0.5)
