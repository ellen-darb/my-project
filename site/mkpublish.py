"""Готовит dist/publish.html для публикации как Artifact (без doctype/head/body — их добавляет хостинг)."""
import re, os, json
s = open("dist/index.html").read()
head = re.search(r"<head>(.*)</head>", s, re.S).group(1)
body = re.search(r"<body>(.*)</body>", s, re.S).group(1)
head = re.sub(r'<meta (charset|name="viewport")[^>]*>\s*', "", head)
t = re.search(r"<title>.*?</title>", head).group(0)
open("dist/publish.html", "w").write(t + "\n" + head.replace(t, "").strip() + "\n" + body.strip() + "\n")
print(json.dumps([{"path": "assets/" + f} for f in sorted(os.listdir("dist/assets"))]))
