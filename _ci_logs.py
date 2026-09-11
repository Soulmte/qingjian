"""One-off: fetch the failing step's log. Delete after use."""

import json
import os
import subprocess
import sys
import urllib.request

REPO = "Soulmte/qingjian"
RUN = "34598946973"

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


class NoAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    """Blob storage rejects the Authorization header, so drop it when we follow."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.headers.pop("Authorization", None)
        return new


def call(path, raw=False):
    request = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "qingjian-ci-log",
        },
    )
    opener = urllib.request.build_opener(NoAuthOnRedirect)
    with opener.open(request) as response:
        body = response.read().decode("utf-8", errors="replace")
    return body if raw else json.loads(body)


jobs = call(f"/repos/{REPO}/actions/runs/{RUN}/jobs")
job_id = jobs["jobs"][0]["id"]
print("job id:", job_id)
log = call(f"/repos/{REPO}/actions/jobs/{job_id}/logs", raw=True)
lines = log.splitlines()
print("total log lines:", len(lines))
print("\n".join(lines[-160:]))
