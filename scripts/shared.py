from __future__ import annotations

import html
import json
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from scripts.feeds_md import parse_feeds_markdown

VODCASTS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = VODCASTS_ROOT.parent


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_feeds_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ValueError(f"Feeds config not found: {path}")
    if path.suffix.lower() != ".md":
        raise ValueError(f"Feeds config must be Markdown (.md). Got: {path}")
    text = path.read_text(encoding="utf-8", errors="replace")
    cfg = parse_feeds_markdown(text)
    if not isinstance(cfg, dict):
        raise ValueError(f"Invalid markdown feeds config: {path}")
    return cfg


def normalize_ws(text: str) -> str:
    return re.sub(r"\\s+", " ", (text or "")).strip()


def strip_html(text: str) -> str:
    text = html.unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return normalize_ws(text)


@dataclass(frozen=True)
class FetchResult:
    status: int
    url: str
    content: bytes | None
    etag: str | None
    last_modified: str | None


def fetch_url(
    url: str,
    *,
    timeout_seconds: int,
    user_agent: str,
    if_none_match: str | None = None,
    if_modified_since: str | None = None,
) -> FetchResult:
    """
    Fetch using curl to get a hard timeout that covers DNS/TLS stalls.

    Notes:
    - `curl --max-time` is a wall-clock timeout, not just a socket timeout.
    - We follow redirects (`-L`) since feeds often redirect.
    """
    with tempfile.NamedTemporaryFile(prefix="vodcasts.headers.", delete=False) as hf, tempfile.NamedTemporaryFile(
        prefix="vodcasts.body.", delete=False
    ) as bf:
        headers_path = Path(hf.name)
        body_path = Path(bf.name)

    try:
        args = [
            "curl",
            "-sS",
            "-L",
            "--max-time",
            str(int(timeout_seconds)),
            "--connect-timeout",
            str(min(10, int(timeout_seconds))),
            "-A",
            user_agent,
            "-H",
            "Accept: application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        ]
        if if_none_match:
            args += ["-H", f"If-None-Match: {if_none_match}"]
        if if_modified_since:
            args += ["-H", f"If-Modified-Since: {if_modified_since}"]
        args += [
            "-D",
            str(headers_path),
            "-o",
            str(body_path),
            "-w",
            "%{http_code}\n%{url_effective}\n",
            url,
        ]

        p = subprocess.run(args, capture_output=True, text=True)
        if p.returncode != 0:
            raise ValueError((p.stderr or "").strip() or f"curl failed ({p.returncode})")

        out_lines = (p.stdout or "").splitlines()
        if len(out_lines) < 2:
            raise ValueError("curl: missing status output")
        status = int(out_lines[-2].strip() or "0")
        effective = out_lines[-1].strip() or url

        # Parse a few headers we care about.
        etag = None
        last_modified = None
        try:
            for raw in headers_path.read_text(encoding="utf-8", errors="replace").splitlines():
                if ":" not in raw:
                    continue
                k, v = raw.split(":", 1)
                k = k.strip().lower()
                v = v.strip()
                if k == "etag" and v:
                    etag = v
                if k == "last-modified" and v:
                    last_modified = v
        except Exception:
            pass

        if status == 304:
            return FetchResult(status=304, url=effective, content=None, etag=etag, last_modified=last_modified)
        content = body_path.read_bytes()
        return FetchResult(status=status, url=effective, content=content, etag=etag, last_modified=last_modified)
    finally:
        try:
            headers_path.unlink(missing_ok=True)
        except Exception:
            pass
        try:
            body_path.unlink(missing_ok=True)
        except Exception:
            pass
