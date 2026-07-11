from __future__ import annotations

import os

import requests
import streamlit as st


API_BASE = os.environ.get("NEWS_AGENT_API_BASE", "http://127.0.0.1:8010")


st.set_page_config(page_title="IOT News Brief Agent", page_icon="🗞️", layout="wide")

st.title("🗞️ IOT News Brief Agent")
st.caption(
    "Live headlines from Google News + major channels, summarized into quick newspaper-style briefs."
)

if "session_id" not in st.session_state:
    st.session_state.session_id = None
if "messages" not in st.session_state:
    st.session_state.messages = []
if "interest_text" not in st.session_state:
    st.session_state.interest_text = "finance, tech"

with st.sidebar:
    st.subheader("Controls")
    st.caption("Personalization")
    st.session_state.interest_text = st.text_input(
        "Interests (comma separated)",
        value=st.session_state.interest_text,
    )
    if st.button("Save Interests", use_container_width=True):
        if st.session_state.session_id is None:
            st.session_state.messages.append(
                {
                    "role": "assistant",
                    "content": "Start chat once first, then save interests.",
                }
            )
        else:
            interests = [
                x.strip() for x in st.session_state.interest_text.split(",") if x.strip()
            ]
            try:
                resp = requests.post(
                    f"{API_BASE}/profile/interests",
                    json={
                        "session_id": st.session_state.session_id,
                        "interests": interests,
                    },
                    timeout=30,
                )
                resp.raise_for_status()
                profile = resp.json().get("profile", {})
                saved = ", ".join(profile.get("interests", [])) or "none"
                st.session_state.messages.append(
                    {
                        "role": "assistant",
                        "content": f"Saved interests: {saved}",
                    }
                )
            except Exception as exc:
                st.session_state.messages.append(
                    {
                        "role": "assistant",
                        "content": f"Could not save interests: {exc}",
                    }
                )
        st.rerun()

    st.caption("Scheduled updates")
    if st.button("Enable Hourly Digest", use_container_width=True):
        if st.session_state.session_id is None:
            st.session_state.messages.append(
                {
                    "role": "assistant",
                    "content": "Start chat once first, then enable digest.",
                }
            )
        else:
            try:
                resp = requests.post(
                    f"{API_BASE}/subscriptions/hourly",
                    json={
                        "session_id": st.session_state.session_id,
                        "enabled": True,
                    },
                    timeout=30,
                )
                resp.raise_for_status()
                st.session_state.messages.append(
                    {
                        "role": "assistant",
                        "content": "Hourly digest enabled.",
                    }
                )
            except Exception as exc:
                st.session_state.messages.append(
                    {
                        "role": "assistant",
                        "content": f"Could not enable digest: {exc}",
                    }
                )
        st.rerun()

    if st.button("Disable Hourly Digest", use_container_width=True):
        if st.session_state.session_id is None:
            st.session_state.messages.append(
                {
                    "role": "assistant",
                    "content": "Start chat once first, then disable digest.",
                }
            )
        else:
            try:
                resp = requests.post(
                    f"{API_BASE}/subscriptions/hourly",
                    json={
                        "session_id": st.session_state.session_id,
                        "enabled": False,
                    },
                    timeout=30,
                )
                resp.raise_for_status()
                st.session_state.messages.append(
                    {
                        "role": "assistant",
                        "content": "Hourly digest disabled.",
                    }
                )
            except Exception as exc:
                st.session_state.messages.append(
                    {
                        "role": "assistant",
                        "content": f"Could not disable digest: {exc}",
                    }
                )
        st.rerun()

    if st.button("Pull Inbox", use_container_width=True):
        if st.session_state.session_id is None:
            st.session_state.messages.append(
                {
                    "role": "assistant",
                    "content": "Start chat once first, then pull inbox.",
                }
            )
        else:
            try:
                resp = requests.post(
                    f"{API_BASE}/digest/inbox/pull",
                    json={
                        "session_id": st.session_state.session_id,
                        "limit": 3,
                    },
                    timeout=30,
                )
                resp.raise_for_status()
                payload = resp.json()
                msgs = payload.get("messages", [])
                if not msgs:
                    st.session_state.messages.append(
                        {
                            "role": "assistant",
                            "content": "No digest messages in inbox yet.",
                        }
                    )
                else:
                    for m in msgs:
                        st.session_state.messages.append(
                            {
                                "role": "assistant",
                                "content": (
                                    f"Digest ({m.get('created_at')}, "
                                    f"filter: {m.get('topic_filter')}):\n"
                                    f"{m.get('content')}"
                                ),
                            }
                        )
            except Exception as exc:
                st.session_state.messages.append(
                    {
                        "role": "assistant",
                        "content": f"Could not pull inbox: {exc}",
                    }
                )
        st.rerun()

    if st.button("Start New Chat", use_container_width=True):
        st.session_state.session_id = None
        st.session_state.messages = []
        st.rerun()

    if st.button("Refresh Headlines", use_container_width=True):
        prompt = "refresh headlines"
        st.session_state.messages.append({"role": "user", "content": prompt})
        try:
            resp = requests.post(
                f"{API_BASE}/chat",
                json={"message": prompt, "session_id": st.session_state.session_id},
                timeout=45,
            )
            resp.raise_for_status()
            data = resp.json()
            st.session_state.session_id = data.get("session_id")
            st.session_state.messages.append(
                {"role": "assistant", "content": data.get("reply", "No response")}
            )
        except Exception as exc:
            st.session_state.messages.append(
                {"role": "assistant", "content": f"Error while refreshing: {exc}"}
            )
        st.rerun()

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

user_input = st.chat_input(
    "Ask for latest headlines, topic briefs, or details (example: more on 2)"
)

if user_input:
    st.session_state.messages.append({"role": "user", "content": user_input})
    with st.chat_message("user"):
        st.markdown(user_input)

    with st.chat_message("assistant"):
        with st.spinner("Fetching and summarizing latest news..."):
            try:
                resp = requests.post(
                    f"{API_BASE}/chat",
                    json={
                        "message": user_input,
                        "session_id": st.session_state.session_id,
                    },
                    timeout=60,
                )
                resp.raise_for_status()
                data = resp.json()
                st.session_state.session_id = data.get("session_id")
                reply = data.get("reply", "No response")
                st.markdown(reply)

                sources = data.get("sources", [])
                if sources:
                    st.markdown("Here are the links if you want a detailed reading:")
                    for src in sources[:8]:
                        st.markdown(
                            f"- [{src.get('source')}] {src.get('title')}\n  "
                            f"Here's the link if you want a detailed reading: {src.get('link')}"
                        )
            except requests.exceptions.ConnectionError:
                reply = (
                    f"Cannot reach backend at {API_BASE}. "
                    "Run the FastAPI server first."
                )
                st.error(reply)
            except Exception as exc:
                reply = f"Request failed: {exc}"
                st.error(reply)

    st.session_state.messages.append({"role": "assistant", "content": reply})
