"""One-off: watch the release workflow run. Delete after use."""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = "Soulmte/qingjian"
TAG = "v0.1.2"

env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
filled = subprocess.run(
    ["git", "credential", "fill"],
    input="protocol=https\nhost=github.com\n\n",
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
    env=env,
)
token = next(
    (line.split("=", 1)[1] for line in filled.stdout.splitlines() if line.startswith("password=")),
    None,
)
if not token:
    sys.exit("no token")


def call(path):
    request = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "qingjian-ci-watch",
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


deadline = time.time() + 25 * 60
run = None
while time.time() < deadline:
    runs = call(f"/repos/{REPO}/actions/runs?per_page=20")
    run = next((item for item in runs["workflow_runs"] if item.get("head_branch") == TAG), None)
    if run is None:
        print("waiting for workflow run…")
        time.sleep(10)
        continue
    status = run["status"]
    print(f"[{time.strftime('%H:%M:%S')}] run {run['id']}: {status} / {run['conclusion']}")
    if status == "completed":
        break
    time.sleep(20)

if run is None:
    sys.exit("run never appeared")

print(f"\nconclusion: {run['conclusion']}\nurl: {run['html_url']}")

jobs = call(f"/repos/{REPO}/actions/runs/{run['id']}/jobs")
for job in jobs["jobs"]:
    print(f"\njob: {job['name']} -> {job['status']} / {job['conclusion']}")
    for step in job["steps"]:
        mark = "ok " if step["conclusion"] == "success" else f"{step['conclusion']}"
        print(f"  [{mark}] {step['name']}")
