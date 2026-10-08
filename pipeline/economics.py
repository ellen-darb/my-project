"""Финансовый эффект в рублях за год. Все цены — из открытых источников (SOURCES), пересчёты — здесь же.

Логика честная и узкая:
  * выручка метро от меньшей давки не растёт (пассажиры едут всё равно) — доходную часть не считаем;
  * дополнительные поездо-часы — расход: энергия на тягу, ремонт, машинист (и амортизация в консервативном);
  * снятые поездо-часы в дни провала потока — экономия: только энергия и ремонт (машинист на смене всё равно);
  * что покупает этот расход — пассажиры, которым досталось место в пределах нормы, и минуты ожидания.
Сценарии: базовый (предельные затраты) и консервативный (дороже расход, меньше экономия, больше аномальных дней
не увеличивает выгоду — только расход).
"""
import json, os
import numpy as np
import pandas as pd
import line, data

SOURCES = {
    "fontanka_2025": {"t": "Фонтанка, 10.08.2025: калькуляция тарифа метрополитена на 2025 год",
                      "u": "https://www.fontanka.ru/2025/08/10/75817831/"},
    "peterburg2_2026": {"t": "Петербург2, 02.04.2026: итоги 2025 года метрополитена",
                        "u": "https://peterburg2.ru/news/peterburgskiy-metropoliten-zavershil-2025-god-s-rekordnym-ubytkom-nesmotrya-na-rost-dohodov-230730.html"},
    "dp_pax": {"t": "Деловой Петербург, 01.06.2026: пассажиропоток метро 699 млн за 2025 год",
               "u": "https://www.dp.ru/a/2026/06/01/proval-planirovanija-gde-v"},
    "dp_fare": {"t": "Деловой Петербург, 21.01.2026: цены на проезд в 2026 году",
                "u": "https://www.dp.ru/a/2026/01/21/proezd-v-peterburge-ceni"},
    "hh_driver": {"t": "hh.ru, вакансия машиниста электропоезда метрополитена, 18.09.2026",
                  "u": "https://spb.hh.ru/vacancy/133889875"},
    "dp_driver": {"t": "Деловой Петербург, 26.08.2026: машинист за 205 тысяч рублей",
                  "u": "https://www.dp.ru/a/2026/08/26/mashinist-za-205-tisjach-rublej"},
    "dp_cars": {"t": "Деловой Петербург, 15.03.2023: 950 вагонов за 242,6 млрд ₽",
                "u": "https://www.dp.ru/a/2023/03/15/kazhdij_novij_vagon_met"},
    "msk_traction": {"t": "Мосгорсправка/АГН Москва, 2014: 75% энергии метро уходит на тягу",
                     "u": "https://www.mskagency.ru/materials/1884514"},
    "dp_it": {"t": "Деловой Петербург, 30.04.2026: зарплаты ИТ-специалистов в Петербурге (hh.ru, I кв. 2026)",
              "u": "https://www.dp.ru/a/2026/04/30/it-specialisti-v-peterburge"},
}

CAR_KM = 232e6            # вагоно-км в год, план 2025 (fontanka_2025)
ENERGY_RUB = 6.1e9        # электроэнергия, ₽ в год (fontanka_2025)
REPAIR_RUB = 5.2e9        # ремонт (fontanka_2025)
AMORT_RUB = 8.4e9         # амортизация (fontanka_2025)
COST_RUB = 58.8e9         # все расходы по калькуляции (fontanka_2025)
COST_FACT = 72.4e9        # расходы на перевозку, факт 2025 (peterburg2_2026)
PAX = 699e6               # пассажиров в 2025 (dp_pax)
TRACTION_SHARE = (0.70, 0.75)   # доля тяги в энергии (msk_traction, московский ориентир)
DRIVER_MONTH = 155_000    # ₽ до вычета, после допуска к самостоятельной работе (hh_driver)
INSURANCE = 1 + 7.2 / 23.4      # взносы к ФОТ по калькуляции 2025: 7,2 / 23,4 (fontanka_2025)
HOURS_MONTH = 165         # норма часов при 40-часовой неделе (ТК РФ)
CARS = line.CARS
SPEED = 2 * line.LINE_KM * 60 / line.TURNOVER_MIN   # км/ч состава в обороте: 59,2 км за 99 мин
CAR_KM_PER_TRAIN_H = CARS * SPEED


def unit_costs():
    e_all = ENERGY_RUB / CAR_KM
    e_tr = e_all * TRACTION_SHARE[0]
    rep = REPAIR_RUB / CAR_KM
    am = AMORT_RUB / CAR_KM
    drv = DRIVER_MONTH * INSURANCE / HOURS_MONTH
    drv_c = drv * 12 / 10.5          # отпуск до 45 дней и резерв (dp_driver): 12 мес оплаты за ~10,5 мес работы
    base = {"energy": e_tr, "repair": rep, "amort": 0.0, "driver": drv}
    cons = {"energy": e_all, "repair": rep, "amort": am, "driver": drv_c}
    per_h = lambda c: CAR_KM_PER_TRAIN_H * (c["energy"] + c["repair"] + c["amort"]) + c["driver"]
    return {
        "speed_kmh": SPEED, "car_km_per_train_h": CAR_KM_PER_TRAIN_H,
        "rub_per_car_km": {"energy_all": e_all, "energy_traction": e_tr, "repair": rep, "amort": am,
                           "full_plan": COST_RUB / CAR_KM, "full_fact": COST_FACT / CAR_KM},
        "driver_h": {"base": drv, "cons": drv_c},
        "add_train_h": {"base": per_h(base), "cons": per_h(cons), "full_cost": CAR_KM_PER_TRAIN_H * COST_FACT / CAR_KM},
        "cut_train_h": {"base": CAR_KM_PER_TRAIN_H * (e_tr + rep), "cons": CAR_KM_PER_TRAIN_H * e_tr},
        "cost_per_trip": COST_FACT / PAX,
    }


def year_days(year=2026):
    """Сколько дней каждого типа в году: учебные будни, летние будни, выходные и праздники."""
    out = {"weekday_sep": 0, "weekday_summer": 0, "weekend": 0, "holiday": 0}
    for d in pd.date_range(f"{year}-01-01", f"{year}-12-31"):
        s = line.schedule_for(d)
        if d.strftime("%Y-%m-%d") in line.HOLIDAYS:
            out["holiday"] += 1
        else:
            out[s] += 1
    return out


def run(effect_days, calendar):
    uc = unit_costs()
    cal = {c["d"]: c for c in calendar}

    def cls(d):
        c = cal.get(d)
        if c is None or c["planned"]:
            return "planned"
        k = c["kinds"]
        return "surge" if ("surge" in k or "incident" in k) else ("drop" if "drop" in k else "normal")

    ef = pd.DataFrame(effect_days)
    ef["cls"] = ef.d.map(cls)
    ef["dth"] = ef.system_train_h - ef.plan_train_h
    ef["dover"] = ef.plan_over_pax - ef.system_over_pax
    ef["dwait_h"] = (ef.plan_wait_min - ef.system_wait_min) / 60
    ef["add_h"] = ef.dth.clip(lower=0)
    ef["cut_h"] = (-ef.dth).clip(lower=0)

    # частота аномалий по часовому файлу (январь–сентябрь), отдельно будни и выходные
    cdf = pd.DataFrame(calendar)
    cdf["wd"] = pd.to_datetime(cdf.d).dt.weekday < 5
    cdf["cls"] = cdf.d.map(cls)
    rate = {}
    for wd in (True, False):
        g = cdf[(cdf.wd == wd) & (cdf.cls != "planned")]
        rate["weekday" if wd else "weekend"] = {k: float((g.cls == k).mean()) for k in ("normal", "surge", "drop")}
    n_unpl = int((cdf.cls != "planned").sum())
    n_anom = int(cdf.cls.isin(["surge", "drop"]).sum())

    yd = year_days()
    # средние на день по типу дня из проигрывания 120 дней; при < 3 днях в группе — среднее по всем дням типа
    def mean_of(sched_group, k, col):
        g = ef[(ef.sched.isin(sched_group)) & (ef.cls == k)]
        if len(g) < 3:
            g = ef[ef.sched.isin(sched_group) & (ef.cls != "planned")]
        return float(g[col].mean())

    groups = {"weekday_sep": (["weekday_sep"], yd["weekday_sep"], "weekday"),
              "weekday_summer": (["weekday_summer"], yd["weekday_summer"], "weekday"),
              "weekend": (["weekend"], yd["weekend"], "weekend")}
    annual = {"add_h": 0.0, "cut_h": 0.0, "dover": 0.0, "dwait_h": 0.0}
    rows = []
    for name, (sg, n, wdk) in groups.items():
        for k in ("normal", "surge", "drop"):
            nd = n * rate[wdk][k]
            r = {"group": name, "cls": k, "days": nd}
            for col in annual:
                v = mean_of(sg, k, col)
                r[col] = v
                annual[col] += nd * v
            rows.append(r)

    def money(sc):
        cost = annual["add_h"] * uc["add_train_h"][sc]
        save = annual["cut_h"] * uc["cut_train_h"][sc]
        return {"cost": cost, "save": save, "net": save - cost,
                "per_relieved_pax": (cost - save) / max(annual["dover"], 1)}

    # консервативный: аномальных дней на 50% больше (только больше расходов), экономия меньше
    cons_annual = dict(annual)
    surge_extra = sum(r["days"] * 0.5 * max(r["add_h"] - mean_of(groups[r["group"]][0], "normal", "add_h"), 0)
                      for r in rows if r["cls"] == "surge")
    cons_annual["add_h"] = annual["add_h"] + surge_extra
    cons = {"cost": cons_annual["add_h"] * uc["add_train_h"]["cons"], "save": annual["cut_h"] * uc["cut_train_h"]["cons"]}
    cons["net"] = cons["save"] - cons["cost"]
    cons["per_relieved_pax"] = (cons["cost"] - cons["save"]) / max(annual["dover"], 1)

    # пилот и сопровождение: состав команды — наше допущение, ставки — hh.ru I кв. 2026 (dp_it)
    team = [("Аналитик данных / Data Scientist", 220_000, 1.0), ("Разработчик", 161_000, 1.0), ("Системный аналитик (интеграция с АСУ)", 165_000, 0.5)]
    pilot_months = 4
    pilot = sum(s * k for _, s, k in team) * INSURANCE * pilot_months
    support = 220_000 * 0.5 * INSURANCE * 12

    import anomalies
    sens = []
    for thr in (0.10, 0.12, 0.15):
        anomalies.THR = thr
        a = pd.DataFrame(anomalies.classify())
        un = a[~a.planned]
        sens.append({"thr": thr, "days": int((un.kinds.map(len) > 0).sum()), "of": len(un),
                     "per_year": round((un.kinds.map(len) > 0).mean() * (365 - yd["holiday"]))})
    anomalies.THR = 0.12
    return {
        "anomaly_sens": sens,
        "sources": SOURCES, "unit": uc, "year_days": yd,
        "anomaly": {"unplanned_days": n_unpl, "anomalous_days": n_anom, "rate": rate,
                    "per_year": sum(n * (rate[w]["surge"] + rate[w]["drop"]) for _, (_, n, w) in groups.items())},
        "by_type": rows, "annual": annual, "cons_annual": cons_annual,
        "base": money("base"), "cons": cons,
        "pilot": {"team": team, "months": pilot_months, "rub": pilot, "support_year": support},
        "budget_share": {"base": money("base")["cost"] / COST_FACT, "cons": cons["cost"] / COST_FACT},
    }


if __name__ == "__main__":
    E = json.load(open(os.path.join(data.ROOT, "site", "public", "data", "effect.json")))
    C = json.load(open(os.path.join(data.ROOT, "site", "public", "data", "calendar.json")))
    out = run(E["days"], C)
    print(json.dumps({k: v for k, v in out.items() if k not in ("sources", "by_type")}, ensure_ascii=False, indent=1, default=float))
    print(pd.DataFrame(out["by_type"]).round(1).to_string())
