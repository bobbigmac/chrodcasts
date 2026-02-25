"""Parse cached feed XML to extract features and episode metadata for build manifest."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class FeedFeatures:
    has_transcript: bool
    has_playable_transcript: bool
    has_chapters: bool
    has_video: bool


@dataclass
class EpisodeBrief:
    id: str
    title: str
    date: str


def parse_feed_features_and_episodes(xml_text: str) -> tuple[FeedFeatures, list[EpisodeBrief]]:
    """Extract feed-level features and brief episode list from RSS/Atom XML."""
    xml = (xml_text or "").strip()
    has_transcript = bool(
        re.search(r"<podcast:transcript\s[^>]*url\s*=", xml, re.I)
        or re.search(r"<podcast:transcript\s+url\s*=", xml, re.I)
    )
    has_playable_transcript = bool(
        re.search(
            r'<podcast:transcript[^>]*(type\s*=\s*["\'](text/vtt|application/x-subrip)|rel\s*=\s*["\']captions["\'])',
            xml,
            re.I,
        )
        or re.search(
            r'type\s*=\s*["\'](text/vtt|application/x-subrip)["\'][^>]*url\s*=',
            xml,
            re.I,
        )
    )
    has_chapters = bool(
        re.search(r"<podcast:chapters[\s>]", xml, re.I) or re.search(r"<psc:chapters", xml, re.I)
    )
    has_video = bool(
        re.search(r'type\s*=\s*["\']video/', xml, re.I)
        or re.search(r"\.(mp4|m4v|mov|webm|m3u8)(\?|[\"'\s>])", xml, re.I)
    )

    features = FeedFeatures(
        has_transcript=has_transcript,
        has_playable_transcript=has_playable_transcript,
        has_chapters=has_chapters,
        has_video=has_video,
    )

    episodes: list[EpisodeBrief] = []
    for m in re.finditer(r"<item[^>]*>([\s\S]*?)</item>|<entry[^>]*>([\s\S]*?)</entry>", xml, re.I):
        block = m.group(1) or m.group(2)
        _append_episode(episodes, block)

    return features, episodes


def _append_episode(episodes: list[EpisodeBrief], block: str) -> None:
    if not (block or "").strip():
        return
    title_m = re.search(r"<title[^>]*>([\s\S]*?)</title>", block, re.I)
    title = (title_m.group(1) or "").strip() if title_m else ""
    title = re.sub(r"<[^>]+>", "", title).strip()[:120] or "Episode"
    guid_m = re.search(r"<guid[^>]*>([\s\S]*?)</guid>", block, re.I)
    guid = (guid_m.group(1) or "").strip()[:200] if guid_m else ""
    id_m = re.search(r"<id[^>]*>([\s\S]*?)</id>", block, re.I)
    ep_id = (id_m.group(1) or "").strip()[:200] if id_m else ""
    pub_m = re.search(
        r"<pubDate[^>]*>([\s\S]*?)</pubDate>|<published[^>]*>([\s\S]*?)</published>|<updated[^>]*>([\s\S]*?)</updated>",
        block,
        re.I,
    )
    date_str = ""
    if pub_m:
        raw = (pub_m.group(1) or pub_m.group(2) or pub_m.group(3) or "").strip()
        try:
            from email.utils import parsedate_to_datetime

            dt = parsedate_to_datetime(raw)
            date_str = dt.strftime("%Y-%m-%d")
        except Exception:
            try:
                from datetime import datetime

                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                date_str = dt.strftime("%Y-%m-%d")
            except Exception:
                date_str = ""
    ep_id = ep_id or guid or f"{title}#{len(episodes)}"
    episodes.append(EpisodeBrief(id=ep_id[:240], title=title, date=date_str))
