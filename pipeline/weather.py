"""Погода по часам для Санкт-Петербурга (Open-Meteo, архив). Сохраняет data/weather_hourly.csv.gz.

Запуск: python3 pipeline/weather.py  (нужен выход в интернет; в закрытом контуре метро подставляется
файл той же формы из АСУ «Метео»/Гидрометцентра). Данные не придумываются: нет ответа — нет файла.
"""
import json, os, sys, urllib.request
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "weather_hourly.csv.gz")
URL = ("https://archive-api.open-meteo.com/v1/archive?latitude=59.9343&longitude=30.3351"
       "&start_date={a}&end_date={b}&timezone=Europe%2FMoscow"
       "&hourly=temperature_2m,precipitation,snowfall,wind_speed_10m,weather_code")


def fetch(a="2026-01-01", b="2026-09-30"):
    with urllib.request.urlopen(URL.format(a=a, b=b), timeout=60) as r:
        h = json.load(r)["hourly"]
    df = pd.DataFrame(h).rename(columns={"time": "ts", "temperature_2m": "temp", "precipitation": "precip",
                                         "snowfall": "snow", "wind_speed_10m": "wind", "weather_code": "code"})
    return df


if __name__ == "__main__":
    df = fetch(*sys.argv[1:3])
    df.to_csv(OUT, index=False, compression="gzip")
    print(len(df), "строк", df.ts.iloc[0], "…", df.ts.iloc[-1])
