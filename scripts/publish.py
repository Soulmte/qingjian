#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把一次构建的安装包发布到 GitHub / Gitee。

只做需要 API 的三件事：建仓库（可选）、建 Release、传附件。打 tag 与推送交给
git —— 那是几条能用眼睛逐行检查的命令，不值得藏在脚本里。

用法：

    # GitHub：令牌优先取环境变量，没有就问本机的 git 凭据助手
    python scripts/publish.py github --repo Soulmte/qingjian --tag v0.1.0 \\
        --title "青简 v0.1.0" --notes-file release-notes.md --create-repo \\
        --asset src-tauri/target/release/bundle/nsis/青简_0.1.0_x64-setup.exe \\
        --asset src-tauri/target/release/bundle/msi/青简_0.1.0_x64_zh-CN.msi

    # Gitee：只能给 GITEE_TOKEN（它的 API 不认口令）
    GITEE_TOKEN=... python scripts/publish.py gitee --repo Soulmte/qingjian ...

加 --dry-run 只打印将要发出的请求，一个字都不发出去。

凭据不会被打印、不会被写进任何文件。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

TIMEOUT = 120


# --------------------------------------------------------------------------
# 凭据
# --------------------------------------------------------------------------


def git_credential(host: str) -> dict:
    """问本机的 git 凭据助手要 host 的凭据（GitHub 的 GCM 登录就存在这里）。

    全程禁用交互：拿不到就立刻失败，既不弹窗也不等着输入。
    """
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
    proc = subprocess.run(
        ["git", "credential", "fill"],
        input=f"protocol=https\nhost={host}\n\n",
        capture_output=True,
        text=True,
        # 不指定编码会跟控制台的 GBK 撞车，把凭据读成乱码
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    fields: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        key, _, value = line.partition("=")
        if key:
            fields[key] = value
    return fields


def resolve_token(host: str, env_name: str) -> str:
    token = os.environ.get(env_name, "").strip()
    if token:
        return token
    if host == "github.com":
        token = (git_credential(host).get("password") or "").strip()
        if len(token) >= 20:
            return token
    raise SystemExit(
        f"拿不到 {host} 的凭据。请设置环境变量 {env_name}，"
        f"或先用 git 登录一次让它存进凭据助手。"
    )


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------


def request(
    method: str,
    url: str,
    *,
    token: str,
    json_body: dict | None = None,
    form: dict | None = None,
    raw: bytes | None = None,
    content_type: str | None = None,
    headers: dict | None = None,
    dry_run: bool = False,
):
    """发一个请求；HTTP 错误也当作返回值，好把服务端的说明读出来。

    dry-run 只拦写操作：GET 照常发出去，这样演练也能真的校验令牌、
    仓库是否存在、Release 是否已建，而不是蒙着眼睛走一遍流程。
    """
    if dry_run and method != "GET":
        size = f"{len(raw)} 字节" if raw is not None else "无正文"
        print(f"    [dry-run] 跳过 {method} {url}  ({size})")
        return 201, {}, "{}"

    final_headers = {"User-Agent": "qingjian", **(headers or {})}
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        final_headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode("utf-8")
        final_headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif raw is not None:
        data = raw
        final_headers["Content-Type"] = content_type or "application/octet-stream"

    if token:
        final_headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=data, headers=final_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            return response.status, dict(response.headers), response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read().decode("utf-8", "replace")


def multipart(fields: dict, file_name: str, payload: bytes) -> tuple[bytes, str]:
    """拼一个 multipart/form-data 正文（Gitee 传附件要这个，GitHub 不用）。"""
    boundary = f"----qingjian{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        chunks.append(f"{value}\r\n".encode())
    chunks.append(f"--{boundary}\r\n".encode())
    chunks.append(
        f'Content-Disposition: form-data; name="file"; filename="{file_name}"\r\n'.encode()
    )
    chunks.append(b"Content-Type: application/octet-stream\r\n\r\n")
    chunks.append(payload)
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


# --------------------------------------------------------------------------
# GitHub
# --------------------------------------------------------------------------


class GitHub:
    host = "github.com"
    env_name = "GITHUB_TOKEN"
    api = "https://api.github.com"

    def __init__(self, token: str, dry_run: bool):
        self.token = token
        self.dry_run = dry_run

    def _call(self, method, url, **kwargs):
        return request(method, url, token=self.token, dry_run=self.dry_run, **kwargs)

    def login(self) -> str:
        status, _, body = self._call("GET", f"{self.api}/user")
        if status != 200:
            raise SystemExit(f"令牌不可用（GET /user 返回 {status}）：{body[:200]}")
        return json.loads(body).get("login", "")

    def repo_state(self, repo: str) -> str:
        """返回 exists / missing / unknown。"""
        status, _, _ = self._call("GET", f"{self.api}/repos/{repo}")
        if status == 200:
            return "exists"
        if status == 404:
            return "missing"
        return "unknown"

    def ensure_repo(self, repo: str, owner: str, description: str, login: str) -> None:
        state = self.repo_state(repo)
        if state == "exists":
            print(f"  仓库 {repo} 已存在，跳过创建")
            return
        if state == "unknown":
            raise SystemExit(f"无法确认仓库 {repo} 是否存在，先手工看一眼")

        name = repo.split("/")[-1]
        payload = {
            "name": name,
            "description": description,
            "private": False,
            "has_issues": True,
            "has_wiki": False,
        }
        # 建在个人名下与建在组织下是两个端点
        url = f"{self.api}/user/repos" if owner == login else f"{self.api}/orgs/{owner}/repos"
        status, _, body = self._call("POST", url, json_body=payload)
        if status not in (201, 200) and not self.dry_run:
            raise SystemExit(f"创建仓库失败（{status}）：{body[:300]}")
        print(f"  已创建公开仓库 {repo}")

    def release(self, repo: str, tag: str) -> dict | None:
        status, _, body = self._call("GET", f"{self.api}/repos/{repo}/releases/tags/{tag}")
        if status == 200:
            return json.loads(body)
        return None

    def create_release(self, repo: str, tag: str, title: str, notes: str) -> dict | None:
        payload = {"tag_name": tag, "name": title, "body": notes, "draft": False, "prerelease": False}
        status, _, body = self._call("POST", f"{self.api}/repos/{repo}/releases", json_body=payload)
        if status not in (200, 201):
            if self.dry_run:
                return None
            raise SystemExit(f"创建 Release 失败（{status}）：{body[:300]}")
        return None if self.dry_run else json.loads(body)

    def asset_names(self, release: dict | None) -> set[str]:
        return {asset.get("name", "") for asset in (release or {}).get("assets", [])}

    def delete_release(self, repo: str, release_id: int) -> None:
        status, _, body = self._call("DELETE", f"{self.api}/repos/{repo}/releases/{release_id}")
        if status not in (204, 200) and not self.dry_run:
            raise SystemExit(f"删除旧 Release 失败（{status}）：{body[:200]}")

    def upload(self, repo: str, release_id: int, path: Path, name: str) -> None:
        query = urllib.parse.urlencode({"name": name})
        url = f"https://uploads.github.com/repos/{repo}/releases/{release_id}/assets?{query}"
        payload = path.read_bytes()
        status, _, body = self._call(
            "POST", url, raw=payload, content_type="application/octet-stream",
            headers={"Accept": "application/vnd.github+json"},
        )
        if status not in (200, 201) and not self.dry_run:
            raise SystemExit(f"上传 {name} 失败（{status}）：{body[:300]}")
        print(f"  已上传 {name}（{len(payload) / 1048576:.1f} MB）")


# --------------------------------------------------------------------------
# Gitee
# --------------------------------------------------------------------------


class Gitee:
    host = "gitee.com"
    env_name = "GITEE_TOKEN"
    api = "https://gitee.com/api/v5"

    def __init__(self, token: str, dry_run: bool):
        self.token = token
        self.dry_run = dry_run

    def _call(self, method, url, **kwargs):
        # Gitee 的令牌走 access_token 参数，而不是 Authorization 头
        if method == "GET":
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}{urllib.parse.urlencode({'access_token': self.token})}"
            return request(method, url, token="", dry_run=self.dry_run, **kwargs)
        return request(method, url, token="", dry_run=self.dry_run, **kwargs)

    def login(self) -> str:
        status, _, body = self._call("GET", f"{self.api}/user")
        if status != 200:
            raise SystemExit(f"令牌不可用（GET /user 返回 {status}）：{body[:200]}")
        return json.loads(body).get("login", "")

    def repo_state(self, repo: str) -> str:
        status, _, _ = self._call("GET", f"{self.api}/repos/{repo}")
        if status == 200:
            return "exists"
        if status == 404:
            return "missing"
        return "unknown"

    def ensure_repo(self, repo: str, owner: str, description: str, login: str) -> None:
        state = self.repo_state(repo)
        if state == "unknown":
            raise SystemExit(f"无法确认仓库 {repo} 是否存在，先手工看一眼")

        if state == "missing":
            payload = {
                "access_token": self.token,
                "name": repo.split("/")[-1],
                "description": description,
                "private": "false",
                "auto_init": "false",
            }
            url = f"{self.api}/user/repos" if owner == login else f"{self.api}/orgs/{owner}/repos"
            status, _, body = self._call("POST", url, form=payload)
            if status not in (200, 201) and not self.dry_run:
                raise SystemExit(f"创建仓库失败（{status}）：{body[:300]}")
            print(f"  已创建仓库 {repo}")

        self.ensure_public(repo)

    def ensure_public(self, repo: str) -> None:
        """确认仓库真是公开的。

        建仓时传的 `private=false` 不一定会被采纳：v0.1.8 那次建出来就是个私有
        仓库，而脚本照样打印「已创建公开仓库」。私有的镜像等于没有——用户点进
        下载链接只会看到登录页，所以建完还得自己确认一遍。
        """
        if self.dry_run:
            return

        status, _, body = self._call("GET", f"{self.api}/repos/{repo}")
        if status == 200 and json.loads(body).get("private") is False:
            print(f"  仓库 {repo} 是公开的")
            return

        # 更新仓库的接口要求带上 name，只传 private 会报 400 name is missing。
        status, _, body = self._call(
            "PATCH",
            f"{self.api}/repos/{repo}",
            form={
                "access_token": self.token,
                "name": repo.split("/")[-1],
                "private": "false",
            },
        )
        if status == 200 and json.loads(body).get("private") is False:
            print(f"  已把仓库 {repo} 改为公开")
            return

        raise SystemExit(
            f"仓库 {repo} 仍是私有的（PATCH 返回 {status}：{body[:200]}）。\n"
            "私有的镜像没人能下载，先别发。多半是账号没通过实名认证——"
            "Gitee 不允许未实名的账号持有公开仓库，在网页上认证一次再来。"
        )

    def release(self, repo: str, tag: str) -> dict | None:
        status, _, body = self._call("GET", f"{self.api}/repos/{repo}/releases/tags/{tag}")
        if status == 200:
            return json.loads(body)
        # 有的仓库用 /releases 列表更稳，兜底找一遍
        status, _, body = self._call("GET", f"{self.api}/repos/{repo}/releases?per_page=100")
        if status == 200:
            for item in json.loads(body):
                if item.get("tag_name") == tag:
                    return item
        return None

    def create_release(self, repo: str, tag: str, title: str, notes: str) -> dict | None:
        payload = {
            "access_token": self.token,
            "tag_name": tag,
            "name": title,
            "body": notes,
            "target_commitish": "main",
            "prerelease": "false",
        }
        status, _, body = self._call("POST", f"{self.api}/repos/{repo}/releases", form=payload)
        if status not in (200, 201):
            if self.dry_run:
                return None
            raise SystemExit(f"创建 Release 失败（{status}）：{body[:300]}")
        return None if self.dry_run else json.loads(body)

    def asset_names(self, release: dict | None) -> set[str]:
        assets = (release or {}).get("assets") or []
        return {asset.get("name", "") for asset in assets}

    def delete_release(self, repo: str, release_id: int) -> None:
        query = urllib.parse.urlencode({"access_token": self.token})
        status, _, body = self._call("DELETE", f"{self.api}/repos/{repo}/releases/{release_id}?{query}")
        if status not in (204, 200) and not self.dry_run:
            raise SystemExit(f"删除旧 Release 失败（{status}）：{body[:200]}")

    def upload(self, repo: str, release_id: int, path: Path, name: str) -> None:
        payload = path.read_bytes()
        body, content_type = multipart({"access_token": self.token}, name, payload)
        url = f"{self.api}/repos/{repo}/releases/{release_id}/attach_files"
        status, _, text = self._call("POST", url, raw=body, content_type=content_type)
        if status not in (200, 201) and not self.dry_run:
            raise SystemExit(f"上传 {name} 失败（{status}）：{text[:300]}")
        print(f"  已上传 {name}（{len(payload) / 1048576:.1f} MB）")


HOSTS = {"github": GitHub, "gitee": Gitee}


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="发布到 GitHub / Gitee")
    parser.add_argument("host", choices=sorted(HOSTS))
    parser.add_argument("--repo", required=True, help="owner/repo")
    parser.add_argument("--tag", required=True, help="例如 v0.1.0")
    parser.add_argument("--title", help="Release 标题，默认用 tag")
    parser.add_argument("--notes-file", help="更新说明（Markdown 文件）")
    parser.add_argument("--description", default="青简 - 本地 Markdown 编辑器")
    parser.add_argument("--create-repo", action="store_true", help="仓库不存在时创建")
    parser.add_argument(
        "--skip-release",
        action="store_true",
        help="只建仓库，不碰 Release（首次发布要先推代码、再打 tag）",
    )
    parser.add_argument(
        "--asset",
        action="append",
        default=[],
        metavar="PATH[=NAME]",
        help=(
            "要附上的文件，可重复。等号后面可以指定发布时的文件名："
            "GitHub 存附件名时会丢掉非 ASCII 字符，所以本地叫「青简_*.exe」的文件"
            "在这里要换成 ASCII 名。"
        ),
    )
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="已存在同 tag 的 Release 时先删掉重建（会连它的附件一起删，慎用）",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    client_class = HOSTS[args.host]
    pieces = args.repo.split("/")
    if len(pieces) != 2 or not all(pieces):
        raise SystemExit("--repo 的形状应为 owner/repo")
    owner, _ = pieces

    notes = ""
    if args.notes_file:
        notes = Path(args.notes_file).read_text(encoding="utf-8")

    assets: list[tuple[Path, str]] = []
    for item in args.asset:
        raw, _, published = item.partition("=")
        path = Path(raw)
        if not path.is_file():
            raise SystemExit(f"附件不存在：{path}")
        assets.append((path, published or path.name))

    token = resolve_token(client_class.host, client_class.env_name)
    client = client_class(token, args.dry_run)
    print(f"=== {args.host} · {args.repo} · {args.tag}{'（dry-run）' if args.dry_run else ''}")

    login = client.login()
    print(f"  身份：{login}")

    if args.create_repo:
        client.ensure_repo(args.repo, owner, args.description, login)

    if args.skip_release:
        print("  按要求只处理仓库，到此为止")
        return 0

    existing = client.release(args.repo, args.tag)
    if existing and args.recreate:
        print(f"  删掉旧的 Release {args.tag}（id {existing.get('id')}）重建")
        client.delete_release(args.repo, existing["id"])
        existing = None

    if existing:
        print(f"  Release {args.tag} 已存在（id {existing.get('id')}），只补缺的附件")
        release = existing
    else:
        created = client.create_release(args.repo, args.tag, args.title or args.tag, notes)
        # dry-run 时不会真的建，给一个空壳好继续往下走
        release = created or {"id": 0, "assets": []}
        print(f"  已创建 Release {args.tag}")

    release_id = release.get("id") or 0
    already = client.asset_names(release)
    for path, name in assets:
        if name in already:
            print(f"  跳过 {name}（已存在）")
            continue
        if not release_id and not args.dry_run:
            raise SystemExit("拿不到 Release id，无法上传")
        client.upload(args.repo, release_id, path, name)

    print("  完成" if not args.dry_run else "  dry-run 结束，未发出任何请求")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
