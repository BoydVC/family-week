"""Build dist/family-week-snapshot.html: one self-contained offline file (CSS, JS, fonts, data inlined).
Usage: python3 export_snapshot.py [--now ISO]   (needs the server on :4847 for weather; falls back to planner directly)."""
import base64, json, os, re, sys, urllib.request
from datetime import datetime
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import planner, server  # noqa: E402

def main():
    now_q = None
    if "--now" in sys.argv:
        now_q = sys.argv[sys.argv.index("--now") + 1]
    qs = {"now": [now_q]} if now_q else {}
    data = server.plan(qs)
    data["snapshot"] = {"builtAt": datetime.now(planner.ET).isoformat()}
    web = os.path.join(HERE, "web")
    html = open(os.path.join(web, "index.html")).read()
    css = open(os.path.join(web, "style.css")).read()
    for f in ("SpaceGrotesk.ttf", "JetBrainsMono.ttf"):
        b64 = base64.b64encode(open(os.path.join(web, "fonts", f), "rb").read()).decode()
        css = css.replace(f'url("fonts/{f}")', f'url("data:font/ttf;base64,{b64}")')
    js = open(os.path.join(web, "app.js")).read()
    payload = json.dumps(data).replace("</", "<\\/")
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>{css}</style>")
    html = html.replace('<script src="app.js"></script>',
                        f"<script>window.__FW_SNAPSHOT__ = {payload};</script>\n<script>{js}</script>")
    html = html.replace("<title>Family Week · The Family</title>", "<title>Family Week · The Family (offline snapshot)</title>")
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    out = os.path.join(HERE, "dist", "family-week-snapshot.html")
    open(out, "w").write(html)
    print(out, f"{os.path.getsize(out)/1e6:.2f} MB")

if __name__ == "__main__":
    main()
