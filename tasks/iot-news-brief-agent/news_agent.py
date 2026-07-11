from __future__ import annotations

import os
import re
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import requests

try:
    from duckduckgo_search import DDGS
except Exception:
    DDGS = None

try:
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_groq import ChatGroq
except Exception:
    ChatGroq = None
    HumanMessage = None
    SystemMessage = None


@dataclass
class Headline:
    id: str
    title: str
    source: str
    link: str
    published_at: str
    description: str
    short_summary: str


@dataclass
class DigestMessage:
    digest_id: str
    created_at: str
    content: str
    topic_filter: str


BASE_FEEDS: dict[str, str] = {
    "Google News": "https://news.google.com/rss",
    "Reuters World": "https://feeds.reuters.com/Reuters/worldNews",
    "BBC World": "http://feeds.bbci.co.uk/news/world/rss.xml",
    "CNN Top": "http://rss.cnn.com/rss/edition.rss",
    "Al Jazeera": "https://www.aljazeera.com/xml/rss/all.xml",
    "Guardian World": "https://www.theguardian.com/world/rss",
    "NYTimes World": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "Dawn Pakistan": "https://www.dawn.com/feeds/home",
    "Reddit WorldNews": "https://www.reddit.com/r/worldnews/.rss",
    "Reddit News": "https://www.reddit.com/r/news/.rss",
}

GOOGLE_NEWS_QUERY_BASE = "https://news.google.com/rss/search"
ARXIV_QUERY_BASE = "http://export.arxiv.org/api/query"


class NewsCollector:
    def __init__(self, timeout_seconds: int = 12) -> None:
        self.timeout_seconds = timeout_seconds
        self.summarizer = LLMAbstractiveSummarizer()

    def collect_latest(self, max_per_feed: int = 8) -> list[Headline]:
        return self._collect_from_feed_map(BASE_FEEDS, max_per_feed)

    def collect_for_query(self, query: str, max_per_feed: int = 8) -> list[Headline]:
        q = query.strip()
        if not q:
            return self.collect_latest(max_per_feed=max_per_feed)

        # Ordered fallback chain requested by user:
        # DuckDuckGo -> Google News RSS -> arXiv
        results: list[Headline] = []
        target = max(8, max_per_feed * 2)

        ddg_results = self._search_duckduckgo(q, limit=target)
        results.extend(ddg_results)

        if len(results) < target:
            google_query = self._collect_google_news_query(q, max_per_feed=max_per_feed)
            results.extend(google_query)

        if len(results) < target:
            arxiv_results = self._collect_arxiv_query(q, max_results=max_per_feed)
            results.extend(arxiv_results)

        # Final safety net: keep latest channels when all providers are sparse.
        if not results:
            return self.collect_latest(max_per_feed=max_per_feed)

        deduped = self._dedupe(results)
        sorted_items = sorted(
            deduped,
            key=lambda item: self._safe_iso_to_dt(item.published_at),
            reverse=True,
        )
        self._upgrade_summaries_with_llm(sorted_items)
        return sorted_items

    def _collect_from_feed_map(
        self,
        feed_map: dict[str, str],
        max_per_feed: int = 8,
    ) -> list[Headline]:
        all_items: list[Headline] = []
        for source_name, url in feed_map.items():
            try:
                xml_text = self._download(url)
                parsed = self._parse_feed(xml_text, source_name, max_per_feed)
                all_items.extend(parsed)
            except Exception:
                # Skip flaky feed sources and continue with remaining channels.
                continue

        deduped = self._dedupe(all_items)
        sorted_items = sorted(
            deduped,
            key=lambda item: self._safe_iso_to_dt(item.published_at),
            reverse=True,
        )
        self._upgrade_summaries_with_llm(sorted_items)
        return sorted_items

    def _upgrade_summaries_with_llm(self, headlines: list[Headline]) -> None:
        if not self.summarizer.enabled:
            return
        max_items = int(os.environ.get("NEWS_AGENT_LLM_MAX_ITEMS", "10"))
        for item in headlines[:max_items]:
            try:
                item.short_summary = self.summarizer.summarize(
                    title=item.title,
                    description=item.description,
                    fallback=item.short_summary,
                )
            except Exception:
                continue

    def _download(self, url: str) -> str:
        response = requests.get(
            url,
            timeout=self.timeout_seconds,
            headers={"User-Agent": "NewsBriefAgent/1.0"},
        )
        response.raise_for_status()
        return response.text

    def _parse_feed(self, xml_text: str, source: str, limit: int) -> list[Headline]:
        root = ET.fromstring(xml_text)
        root_tag = root.tag.lower()
        if root_tag.endswith("feed"):
            return self._parse_atom(root, source, limit)
        return self._parse_rss(root, source, limit)

    def _parse_rss(self, root: ET.Element, source: str, limit: int) -> list[Headline]:
        channel = root.find("channel")
        if channel is None:
            return []

        items = channel.findall("item")
        parsed: list[Headline] = []

        for item in items[:limit]:
            title = self._text(item.find("title"))
            link = self._text(item.find("link"))
            description = self._clean_html(self._text(item.find("description")))
            pub_date = self._normalize_pubdate(self._text(item.find("pubDate")))

            if not title or not link:
                continue

            short_summary = self._summarize(description or title)

            parsed.append(
                Headline(
                    id=str(uuid.uuid4()),
                    title=title,
                    source=source,
                    link=link,
                    published_at=pub_date,
                    description=description,
                    short_summary=short_summary,
                )
            )

        return parsed

    def _parse_atom(self, root: ET.Element, source: str, limit: int) -> list[Headline]:
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        entries = root.findall("atom:entry", ns)
        parsed: list[Headline] = []

        for entry in entries[:limit]:
            title = self._text(entry.find("atom:title", ns))
            summary = self._clean_html(self._text(entry.find("atom:summary", ns)))
            published = self._normalize_pubdate(self._text(entry.find("atom:published", ns)))

            link = ""
            for node in entry.findall("atom:link", ns):
                href = (node.attrib.get("href") or "").strip()
                if href:
                    link = href
                    break

            if not title or not link:
                continue

            parsed.append(
                Headline(
                    id=str(uuid.uuid4()),
                    title=title,
                    source=source,
                    link=link,
                    published_at=published,
                    description=summary,
                    short_summary=self._summarize(summary or title),
                )
            )

        return parsed

    def _collect_google_news_query(self, query: str, max_per_feed: int) -> list[Headline]:
        url = (
            f"{GOOGLE_NEWS_QUERY_BASE}?q={requests.utils.quote(query)}"
            "&hl=en-US&gl=US&ceid=US:en"
        )
        try:
            xml_text = self._download(url)
            return self._parse_feed(xml_text, "Google News RSS", max_per_feed)
        except Exception:
            return []

    def _collect_arxiv_query(self, query: str, max_results: int = 8) -> list[Headline]:
        url = (
            f"{ARXIV_QUERY_BASE}?search_query=all:{requests.utils.quote(query)}"
            f"&start=0&max_results={max(1, max_results)}"
        )
        try:
            xml_text = self._download(url)
            return self._parse_feed(xml_text, "arXiv", max_results)
        except Exception:
            return []

    def _search_duckduckgo(self, query: str, limit: int = 10) -> list[Headline]:
        if DDGS is None:
            return []

        parsed: list[Headline] = []
        try:
            with DDGS() as ddgs:
                rows = ddgs.text(query, max_results=max(1, limit))
                for row in rows:
                    title = str(row.get("title", "")).strip()
                    link = str(row.get("href", "")).strip()
                    description = self._clean_html(str(row.get("body", "")).strip())

                    if not title or not link:
                        continue

                    parsed.append(
                        Headline(
                            id=str(uuid.uuid4()),
                            title=title,
                            source="DuckDuckGo",
                            link=link,
                            published_at=datetime.now(timezone.utc).isoformat(),
                            description=description,
                            short_summary=self._summarize(description or title),
                        )
                    )
        except Exception:
            return []

        return parsed

    @staticmethod
    def _text(node: ET.Element | None) -> str:
        return (node.text or "").strip() if node is not None else ""

    @staticmethod
    def _clean_html(raw: str) -> str:
        no_tags = re.sub(r"<[^>]+>", " ", raw)
        no_entities = no_tags.replace("&nbsp;", " ").replace("&amp;", "&")
        return re.sub(r"\s+", " ", no_entities).strip()

    @staticmethod
    def _normalize_pubdate(pub_date: str) -> str:
        if not pub_date:
            return datetime.now(timezone.utc).isoformat()
        try:
            dt = parsedate_to_datetime(pub_date)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except Exception:
            return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _safe_iso_to_dt(iso_date: str) -> datetime:
        try:
            return datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
        except Exception:
            return datetime(1970, 1, 1, tzinfo=timezone.utc)

    def _dedupe(self, headlines: list[Headline]) -> list[Headline]:
        seen: set[str] = set()
        unique: list[Headline] = []
        for h in headlines:
            key = self._dedupe_key(h.title)
            if key in seen:
                continue
            seen.add(key)
            unique.append(h)
        return unique

    @staticmethod
    def _dedupe_key(title: str) -> str:
        return re.sub(r"\W+", "", title.lower())

    @staticmethod
    def _summarize(text: str, max_sentences: int = 2) -> str:
        if not text:
            return "No summary available."
        sentences = re.split(r"(?<=[.!?])\s+", text.strip())
        short = [s.strip() for s in sentences if s.strip()][:max_sentences]
        if not short:
            return text[:180].strip()
        summary = " ".join(short)
        return summary[:260].strip()


class ChatNewsAgent:
    def __init__(self) -> None:
        self.collector = NewsCollector()
        self.sessions: dict[str, dict[str, Any]] = {}

    def get_or_create_session(self, session_id: str | None = None) -> str:
        sid = session_id or str(uuid.uuid4())
        if sid not in self.sessions:
            self.sessions[sid] = {
                "history": [],
                "cache": [],
                "interests": [],
                "hourly_digest_enabled": False,
                "inbox": [],
                "last_digest_at": None,
            }
        return sid

    def chat(self, message: str, session_id: str | None = None) -> dict[str, Any]:
        sid = self.get_or_create_session(session_id)
        state = self.sessions[sid]

        user_msg = message.strip()
        intent = self._detect_intent(user_msg)

        if intent == "hello":
            reply = (
                "Hello, welcome to News Brief Agent. "
                "I fetch latest news from Google and major news channels, then summarize "
                "in short newspaper-style bullets.\n\n"
                "Please tell me how can I help you."
            )
            sources = []

        elif intent in {"refresh", "latest"}:
            headlines = self.collector.collect_latest(max_per_feed=8)
            personalized = self._apply_interest_filter(headlines, state.get("interests", []))
            chosen = personalized if personalized else headlines
            state["cache"] = chosen[:25]
            reply = self._format_digest(
                state["cache"][:8],
                prefix=self._digest_prefix_for_profile(state),
            )
            sources = self._sources_from_items(state["cache"][:8])

        elif intent == "set_interests":
            interests = self._extract_interests(user_msg)
            profile = self.set_interests(sid, interests)
            if profile["interests"]:
                pretty = ", ".join(profile["interests"])
                reply = (
                    f"Saved your interests: {pretty}. "
                    "Your next refresh will prioritize these topics."
                )
            else:
                reply = "Interests cleared. You will now receive general headlines."
            sources = []

        elif intent == "subscribe_hourly":
            profile = self.enable_hourly_digest(sid, True)
            interests = profile.get("interests", [])
            topic_hint = ", ".join(interests) if interests else "general headlines"
            reply = (
                "Hourly digest enabled. "
                f"You will receive scheduled updates for: {topic_hint}."
            )
            sources = []

        elif intent == "unsubscribe_hourly":
            self.enable_hourly_digest(sid, False)
            reply = "Hourly digest disabled for this chat session."
            sources = []

        elif intent == "inbox":
            pulled = self.pull_inbox(sid, limit=5)
            if not pulled:
                reply = "Inbox is empty right now. Try again after the next hourly cycle."
                sources = []
            else:
                blocks = []
                for i, dig in enumerate(pulled, start=1):
                    blocks.append(
                        f"Digest {i} ({dig['created_at']}, filter: {dig['topic_filter']}):\n{dig['content']}"
                    )
                reply = "\n\n".join(blocks)
                sources = []

        elif intent == "detail":
            idx = self._extract_index(user_msg)
            cached = state.get("cache", [])
            if idx is None or idx < 1 or idx > len(cached):
                reply = (
                    "I could not find that headline number. Ask like: 'more on 2' "
                    "after requesting latest headlines."
                )
                sources = []
            else:
                item = cached[idx - 1]
                reply = (
                    f"{item.title}\n\n"
                    f"Short summary: {item.short_summary}\n"
                    f"Source: {item.source}\n"
                    f"Published (UTC): {item.published_at}"
                )
                sources = [{"title": item.title, "source": item.source, "link": item.link}]

        elif intent == "topic":
            query = self._extract_topic(user_msg)
            headlines = self.collector.collect_for_query(query, max_per_feed=10)
            filtered = self._filter_by_query(headlines, query)[:8]
            state["cache"] = filtered if filtered else headlines[:25]

            if filtered:
                if self._is_schedule_query(query):
                    reply = self._format_schedule_brief(filtered, query)
                else:
                    reply = self._format_digest(filtered, prefix=f"Topic brief for '{query}':")
                sources = self._sources_from_items(filtered)
            else:
                reply = (
                    f"I did not find strong matches for '{query}'. "
                    "Here are the latest top headlines instead:\n\n"
                    f"{self._format_digest(headlines[:8])}"
                )
                sources = self._sources_from_items(headlines[:8])

        else:
            cached = state.get("cache", [])
            if cached:
                reply = (
                    "You can continue the conversation. Try:\n"
                    "- 'refresh headlines'\n"
                    "- 'summarize topic: AI regulation'\n"
                    "- 'more on 3'\n\n"
                    "Personalization and updates:\n"
                    "- 'set interests: finance, tech, sports'\n"
                    "- 'subscribe hourly'\n"
                    "- 'inbox'\n\n"
                    "Current top brief:\n\n"
                    f"{self._format_digest(cached[:5])}"
                )
                sources = self._sources_from_items(cached[:5])
            else:
                headlines = self.collector.collect_latest(max_per_feed=6)
                state["cache"] = headlines[:20]
                reply = (
                    "Welcome to News Brief Agent. I fetch latest news from Google and major "
                    "news channels, then summarize in short newspaper-style bullets.\n\n"
                    f"{self._format_digest(headlines[:6])}\n\n"
                    "Ask: 'more on 1', 'summarize topic: climate', "
                    "'set interests: tech, finance', or 'subscribe hourly'."
                )
                sources = self._sources_from_items(headlines[:6])

        state["history"].append({"role": "user", "content": user_msg})
        state["history"].append({"role": "assistant", "content": reply})

        return {
            "session_id": sid,
            "reply": reply,
            "sources": sources,
            "history": state["history"],
            "profile": self.get_profile(sid),
        }

    def set_interests(self, session_id: str, interests: list[str]) -> dict[str, Any]:
        sid = self.get_or_create_session(session_id)
        cleaned = self._clean_interest_list(interests)
        self.sessions[sid]["interests"] = cleaned
        return self.get_profile(sid)

    def enable_hourly_digest(self, session_id: str, enabled: bool) -> dict[str, Any]:
        sid = self.get_or_create_session(session_id)
        self.sessions[sid]["hourly_digest_enabled"] = bool(enabled)
        return self.get_profile(sid)

    def get_profile(self, session_id: str) -> dict[str, Any]:
        sid = self.get_or_create_session(session_id)
        state = self.sessions[sid]
        return {
            "session_id": sid,
            "interests": state.get("interests", []),
            "hourly_digest_enabled": state.get("hourly_digest_enabled", False),
            "inbox_count": len(state.get("inbox", [])),
            "last_digest_at": state.get("last_digest_at"),
        }

    def pull_inbox(self, session_id: str, limit: int = 5) -> list[dict[str, str]]:
        sid = self.get_or_create_session(session_id)
        state = self.sessions[sid]
        inbox: list[DigestMessage] = state.get("inbox", [])
        pulled = inbox[:limit]
        state["inbox"] = inbox[limit:]
        return [
            {
                "digest_id": d.digest_id,
                "created_at": d.created_at,
                "content": d.content,
                "topic_filter": d.topic_filter,
            }
            for d in pulled
        ]

    def run_hourly_digest_cycle(self) -> int:
        deliveries = 0
        for sid, state in self.sessions.items():
            if not state.get("hourly_digest_enabled", False):
                continue

            headlines = self.collector.collect_latest(max_per_feed=8)
            interests = state.get("interests", [])
            filtered = self._apply_interest_filter(headlines, interests)
            chosen = filtered if filtered else headlines
            digest_items = chosen[:6]
            digest_text = self._format_digest(
                digest_items,
                prefix=self._digest_prefix_for_profile(state),
            )

            state.setdefault("inbox", []).append(
                DigestMessage(
                    digest_id=str(uuid.uuid4()),
                    created_at=datetime.now(timezone.utc).isoformat(),
                    content=digest_text,
                    topic_filter=", ".join(interests) if interests else "general",
                )
            )
            state["last_digest_at"] = datetime.now(timezone.utc).isoformat()
            deliveries += 1
        return deliveries

    @staticmethod
    def _detect_intent(message: str) -> str:
        m = message.lower()
        if m.strip() in {"hi", "hello", "hey", "hello!", "hi!", "hey!"}:
            return "hello"
        if "set interests:" in m or m.startswith("interests:"):
            return "set_interests"
        if "unsubscribe hourly" in m or "disable hourly" in m:
            return "unsubscribe_hourly"
        if "subscribe hourly" in m or "enable hourly" in m:
            return "subscribe_hourly"
        if m.strip() == "inbox" or "show inbox" in m:
            return "inbox"
        if any(x in m for x in ["refresh", "update", "latest", "headlines now"]):
            return "refresh"
        if re.search(r"\bmore on\s+\d+\b", m) or re.search(r"\bdetail\s+\d+\b", m):
            return "detail"
        if "summarize topic:" in m or "topic:" in m or m.startswith("topic "):
            return "topic"
        if "?" in m or re.match(r"^(what|when|where|who|why|how|is|are|can|could|will|did|do|does)\b", m):
            return "topic"
        return "general"

    @staticmethod
    def _extract_interests(message: str) -> list[str]:
        lowered = message.lower()
        if "set interests:" in lowered:
            raw = message.split(":", 1)[1]
        elif lowered.startswith("interests:"):
            raw = message.split(":", 1)[1]
        else:
            raw = ""
        return [x.strip() for x in raw.split(",") if x.strip()]

    @staticmethod
    def _clean_interest_list(interests: list[str]) -> list[str]:
        seen: set[str] = set()
        cleaned: list[str] = []
        for item in interests:
            token = re.sub(r"\s+", " ", item.strip().lower())
            if not token or token in seen:
                continue
            seen.add(token)
            cleaned.append(token)
        return cleaned[:12]

    @staticmethod
    def _extract_index(message: str) -> int | None:
        match = re.search(r"(more on|detail)\s+(\d+)", message.lower())
        if not match:
            return None
        return int(match.group(2))

    @staticmethod
    def _extract_topic(message: str) -> str:
        lowered = message.lower()
        if "summarize topic:" in lowered:
            return message.split(":", 1)[1].strip()
        if "topic:" in lowered:
            return message.split(":", 1)[1].strip()
        if lowered.startswith("topic "):
            return message[6:].strip()
        return message.strip()

    @staticmethod
    def _filter_by_query(items: list[Headline], query: str) -> list[Headline]:
        words = [w for w in re.split(r"\W+", query.lower()) if len(w) > 2]
        if not words:
            return items

        def score(item: Headline) -> int:
            hay = f"{item.title} {item.description}".lower()
            return sum(1 for w in words if w in hay)

        ranked = sorted(items, key=score, reverse=True)
        return [i for i in ranked if score(i) > 0]

    def _apply_interest_filter(self, items: list[Headline], interests: list[str]) -> list[Headline]:
        if not interests:
            return items
        q = " ".join(interests)
        return self._filter_by_query(items, q)

    @staticmethod
    def _digest_prefix_for_profile(state: dict[str, Any]) -> str:
        interests = state.get("interests", [])
        if interests:
            return f"Latest concise headlines for your interests ({', '.join(interests)}):"
        return "Latest concise headlines:"

    @staticmethod
    def _format_digest(items: list[Headline], prefix: str = "Latest concise headlines:") -> str:
        if not items:
            return "No headlines available right now."

        lines = [prefix]
        for i, item in enumerate(items, start=1):
            lines.append(f"{i}. {item.title}")
            lines.append(f"   - {item.short_summary}")
            lines.append(f"   - Source: {item.source}")
        return "\n".join(lines)

    @staticmethod
    def _sources_from_items(items: list[Headline]) -> list[dict[str, str]]:
        return [
            {"title": item.title, "source": item.source, "link": item.link}
            for item in items
        ]

    @staticmethod
    def _is_schedule_query(query: str) -> bool:
        q = query.lower()
        return bool(
            re.search(
                r"\b(next match|schedule|scheduled|fixture|fixtures|today(?:'s)? match|cancelled|postponed|called off)\b",
                q,
            )
        )

    def _format_schedule_brief(self, items: list[Headline], query: str) -> str:
        lines = [f"Match schedule brief for '{query}':"]

        cancelled_items = [i for i in items if self._looks_cancelled_or_no_match(i)]
        if cancelled_items:
            lines.append(
                "- Current reports indicate today's match may be cancelled/postponed or there may be no match today."
            )
            lines.append(f"- Signal source: {cancelled_items[0].title}")

        scheduled_points: list[str] = []
        for item in items[:6]:
            detail = self._extract_schedule_detail(item)
            if detail:
                scheduled_points.append(detail)

        if scheduled_points:
            lines.append("- Upcoming schedule updates:")
            for point in scheduled_points[:4]:
                lines.append(f"  - {point}")
        elif not cancelled_items:
            lines.append(
                "- I found related headlines, but no clearly confirmed date/time in available snippets."
            )

        lines.append("- Here's the link if you want a detailed reading (see source links below).")
        return "\n".join(lines)

    @staticmethod
    def _looks_cancelled_or_no_match(item: Headline) -> bool:
        text = f"{item.title} {item.description}".lower()
        return bool(
            re.search(
                r"\b(cancelled|canceled|postponed|called off|abandoned|no match today|why is there no match today)\b",
                text,
            )
        )

    @staticmethod
    def _extract_schedule_detail(item: Headline) -> str | None:
        text = f"{item.title} {item.description}"
        lowered = text.lower()
        if not re.search(r"\b(schedule|fixture|next match|match|timings?|date|today|tomorrow)\b", lowered):
            return None

        date_match = re.search(
            r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b",
            text,
            flags=re.IGNORECASE,
        )
        if not date_match:
            date_match = re.search(
                r"\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+\d{4})?\b",
                text,
                flags=re.IGNORECASE,
            )

        time_match = re.search(r"\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)\b", text)

        pieces = [item.title]
        if date_match:
            pieces.append(f"date: {date_match.group(0)}")
        if time_match:
            pieces.append(f"time: {time_match.group(0)}")
        return " | ".join(pieces)


class LLMAbstractiveSummarizer:
    SYSTEM_PROMPT = (
        "You summarize news headlines into concise newspaper-style briefs. "
        "Return 1-2 factual sentences, max 45 words, no hype."
    )

    def __init__(self) -> None:
        self.api_key = os.environ.get("GROQ_API_KEY", "")
        self.model = os.environ.get("NEWS_AGENT_GROQ_MODEL", "llama-3.1-8b-instant")
        self.enabled = bool(self.api_key and ChatGroq and HumanMessage and SystemMessage)
        self._llm = None

        if self.enabled:
            try:
                self._llm = ChatGroq(
                    api_key=self.api_key,
                    model_name=self.model,
                    temperature=0,
                )
            except Exception:
                self.enabled = False

    def summarize(self, title: str, description: str, fallback: str) -> str:
        if not self.enabled or self._llm is None:
            return fallback

        user_prompt = (
            f"Title: {title}\n"
            f"Description: {description}\n"
            "Write a concise abstract summary."
        )
        try:
            response = self._llm.invoke(
                [
                    SystemMessage(content=self.SYSTEM_PROMPT),
                    HumanMessage(content=user_prompt),
                ]
            )
            text = str(response.content).strip()
            if not text:
                return fallback
            return re.sub(r"\s+", " ", text)[:280]
        except Exception:
            return fallback
