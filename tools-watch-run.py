"""一次性：盯住最新一次 Actions 运行直到结束。看完即删。"""

import json
import os
import subprocess
import sys
import time
import urllib.request

REPO = "Soulmte/qingjian"
DEADLINE = time.time() + 30 * 60


def token() -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
    proc = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=env,
    )
    for line in proc.stdout.splitlines():
        if line.startswith("password="):
            return line.partition("=")[2]
    raise SystemExit("拿不到凭据")


TOKEN = token()


def api(path: str):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}{path}",
        headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json",
                 "User-Agent": "qingjian"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def steps(run_id: int):
    try:
        jobs = api(f"/actions/runs/{run_id}/jobs")["jobs"]
    except Exception:
        return []
    out = []
    for job in jobs:
        out.append(f"  job {job['name']}: {job['status']}/{job['conclusion']}")
        for step in job.get("steps", []):
            mark = "" if step["conclusion"] in (None, "success") else "  <<<"
            out.append(f"    - {step['name']}: {step['status']}/{step['conclusion']}{mark}")
    return out


last = None
while time.time() < DEADLINE:
    runs = api("/actions/runs?per_page=1")["workflow_runs"]
    if not runs:
        print("没有运行记录")
        break
    run = runs[0]
    state = f"{run['status']}/{run['conclusion']}"
    if state != last:
        print(f"[{time.strftime('%H:%M:%S')}] {run['name']} #{run['run_number']} {state}", flush=True)
        last = state
    if run["status"] == "completed":
        print(f"\n结论：{run['conclusion']}    链接：{run['html_url']}")
        for line in steps(run["id"]):
            print(line)
        sys.exit(0 if run["conclusion"] == "success" else 1)
    time.sleep(30)

print("超时仍未结束")
sys.exit(2)
