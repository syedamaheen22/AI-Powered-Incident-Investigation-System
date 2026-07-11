from __future__ import annotations

import os
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from news_agent import ChatNewsAgent


app = FastAPI(
    title="IOT News Brief Agent API",
    version="1.0.0",
    description="Fetches latest headlines and serves concise summaries with chat memory.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

agent = ChatNewsAgent()
_scheduler_stop_event = threading.Event()
_scheduler_thread: threading.Thread | None = None


def _scheduler_loop() -> None:
    while not _scheduler_stop_event.is_set():
        try:
            agent.run_hourly_digest_cycle()
        except Exception:
            # Keep scheduler alive even if one cycle fails.
            pass

        minutes = int(os.environ.get("DIGEST_INTERVAL_MINUTES", "60"))
        wait_seconds = max(1, minutes * 60)
        _scheduler_stop_event.wait(wait_seconds)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: str | None = None


class HeadlinesRequest(BaseModel):
    query: str | None = None
    limit: int = Field(default=10, ge=1, le=30)


class InterestsRequest(BaseModel):
    session_id: str
    interests: list[str] = Field(default_factory=list)


class HourlySubscriptionRequest(BaseModel):
    session_id: str
    enabled: bool = True


class InboxPullRequest(BaseModel):
    session_id: str
    limit: int = Field(default=5, ge=1, le=20)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "iot-news-brief-agent"}


@app.on_event("startup")
def startup_scheduler() -> None:
    global _scheduler_thread
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    _scheduler_stop_event.clear()
    _scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True)
    _scheduler_thread.start()


@app.on_event("shutdown")
def shutdown_scheduler() -> None:
    _scheduler_stop_event.set()


@app.post("/chat")
def chat(req: ChatRequest) -> dict:
    try:
        return agent.chat(req.message, req.session_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/headlines")
def headlines(req: HeadlinesRequest) -> dict:
    try:
        items = agent.collector.collect_latest(max_per_feed=10)
        if req.query:
            items = agent._filter_by_query(items, req.query)
        payload = [
            {
                "title": item.title,
                "summary": item.short_summary,
                "source": item.source,
                "published_at": item.published_at,
                "link": item.link,
            }
            for item in items[: req.limit]
        ]
        return {"count": len(payload), "headlines": payload}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/profile/interests")
def profile_interests(req: InterestsRequest) -> dict:
    try:
        profile = agent.set_interests(req.session_id, req.interests)
        return {"ok": True, "profile": profile}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/subscriptions/hourly")
def subscriptions_hourly(req: HourlySubscriptionRequest) -> dict:
    try:
        profile = agent.enable_hourly_digest(req.session_id, req.enabled)
        return {"ok": True, "profile": profile}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/digest/inbox/pull")
def digest_inbox_pull(req: InboxPullRequest) -> dict:
    try:
        messages = agent.pull_inbox(req.session_id, req.limit)
        return {"ok": True, "count": len(messages), "messages": messages}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/digest/run-now")
def digest_run_now() -> dict:
    try:
        deliveries = agent.run_hourly_digest_cycle()
        return {"ok": True, "deliveries": deliveries}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
