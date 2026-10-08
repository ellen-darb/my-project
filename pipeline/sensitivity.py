"""Чувствительность результата к допущениям модели загрузки (λ распределения поездок и масштаб потока)."""
import subprocess, sys, json, re
rows = []
for lam, sc in [(3, 1.0), (6, 1.0), (12, 1.0), (6, 0.9), (6, 1.1)]:
    out = subprocess.run([sys.executable, "-c", f"""
import sys; sys.argv=['x','/tmp/claude-0/forecast.npz','/dev/null','{lam}','{sc}']
exec(open('backtest.py').read().split('if __name__')[0])
t,_=summarize('forecast'); r,_=summarize('reactive')
print(t['over_plan'],t['over_new'],round(t['ex_plan']),round(t['ex_new']),t['warn_hit'],r['warn_hit'],round(t['removed_trh']),t['under_viol'])
"""], capture_output=True, text=True).stdout.split()
    rows.append(dict(lam=lam, scale=sc, over_plan=out[0], over_new=out[1], ex_plan=out[2], ex_new=out[3], hit=out[4], hit_reactive=out[5], removed_trh=out[6], under_viol=out[7]))
    print(rows[-1], flush=True)
json.dump(rows, open("sensitivity.json", "w"), ensure_ascii=False, indent=1)
