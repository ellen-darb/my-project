"""Загрузка входных потоков Линии 1 (15-мин) из xlsx ментора в длинную таблицу."""
import glob, re, sys, datetime as dt
import openpyxl, pandas as pd

def load(src_dir):
    rows = []
    for f in sorted(glob.glob(f"{src_dir}/1.Пассажиропоток+ ГД/Входные пассажиропотоки*.xlsx")):
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        for ws in wb.worksheets:
            m = re.search(r"(\d{2})(\d{2})(\d{4})", ws.title)
            if not m:
                continue
            day = dt.date(int(m[3]), int(m[2]), int(m[1]))
            data = list(ws.iter_rows(values_only=True))
            times = data[1][2:]
            for r in data[3:]:
                st = r[0]
                if not st:
                    continue
                for t, v in zip(times, r[2:]):
                    if isinstance(t, dt.time) and v is not None:
                        rows.append((day, t.hour * 60 + t.minute, st, v))
    df = pd.DataFrame(rows, columns=["date", "minute", "station", "entries"])
    return df

if __name__ == "__main__":
    df = load(sys.argv[1])
    df.to_parquet(sys.argv[2]) if sys.argv[2].endswith(".parquet") else df.to_csv(sys.argv[2], index=False)
    print(df.shape, df.date.nunique(), "days", df.station.nunique(), "stations")
