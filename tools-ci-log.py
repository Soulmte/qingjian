"""一次性：拉 CI 失败那一步的日志。看完即删。"""

import json
import os
import re
import subprocess
import urllib.request

REPO = "Soulmte/qingjian"


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


runs = api("/actions/runs?per_page=1")["workflow_runs"]
run_id = runs[0]["id"]
jobs = api(f"/actions/runs/{run_id}/jobs")["jobs"]
job_id = jobs[0]["id"]

req = urllib.request.Request(
    f"https://api.github.com/repos/{REPO}/actions/jobs/{job_id}/logs",
    headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json",
             "User-Agent": "qingjian"},
)


class DropAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    """日志会 302 到 blob 存储，那里的签名 URL 不认 GitHub 的 Authorization
    头，带着它过去反而 401。"""

    def redirect_request(self, request, fp, code, msg, headers, new_url):
        fresh = super().redirect_request(request, fp, code, msg, headers, new_url)
        if fresh is not None:
            for store in (fresh.headers, fresh.unredirected_hdrs):
                for key in list(store):
                    if key.lower() == "authorization":
                        del store[key]
        return fresh


opener = urllib.request.build_opener(DropAuthOnRedirect)
with opener.open(req, timeout=60) as response:
    log = response.read().decode("utf-8", "replace")

print("日志长度:", len(log), "字符")
# 只看失败附近
for match in re.finditer(r"##\[error\]", log):
    start = max(0, match.start() - 1200)
    print("=" * 70)
    print(log[start:match.start() + 400])
    break

lines = log.splitlines()
for index, line in enumerate(lines):
    if "FAIL" in line or "×" in line or "AssertionError" in line:
        print("=" * 70)
        print("\n".join(lines[max(0, index - 6): index + 30]))
        break
