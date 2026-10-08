"""Порог сигнала: полнота и точность для прогноза с ML и для нормы дня без ML."""
import subprocess, sys, json
NPZ = sys.argv[1]
rows = []
for w in (0.80, 0.85, 0.90, 0.95, 1.00):
    out = subprocess.run([sys.executable, "-c", f"""
import sys; sys.argv=['x','{NPZ}','/dev/null']
exec(open('backtest.py').read().split('if __name__')[0])
import recommend as _rc; _rc.WARN_UTIL={w}
import backtest_hook
""".replace("import backtest_hook","""
res=[]
for mode in ('forecast','norm'):
    t,_=summarize(mode); res+= [t['over_plan'],t['over_new'],t['warn'],t['warn_hit']]
print(*res)""")], capture_output=True, text=True)
    v = out.stdout.split()
    if not v: print(out.stderr[-500:]); continue
    rows.append(dict(thr=w, over_plan=v[0], ml_over_new=v[1], ml_warn=v[2], ml_hit=v[3], norm_over_new=v[5], norm_warn=v[6], norm_hit=v[7]))
    print(rows[-1], flush=True)
json.dump(rows, open("thresholds.json", "w"), ensure_ascii=False, indent=1)
