# Day 12 - ReAct vs Plan-and-Execute (Practical Agent Pattern Comparison)

## Agent Flow Diagram (Decision Loop)

```mermaid
flowchart TD
  A[User turn] --> B[Decide next action]
  B -->|unsafe| R[Refuse and stop]
  B -->|underspecified| T[Tool: parse intent/preferences]
  B -->|need grounding| K[Retrieve docs]
  T --> B
  K --> J{Enough context?}
  J -->|yes| N[Answer with citations]
  J -->|no| B
  N --> M[Update short memory summary]
  R --> M
  M --> E[Next user turn or end]
```

## Multi-turn Evaluation (5 Examples)

### EX1 - Context carry-over works for follow-up constraints
Expected behavior: Agent should keep city from memory and tighten budget in turn 2.

Turn 1 user query: "Plan a 3-day Berlin trip focused on art and food."
- Final decision: answer
- Retrieved count: 4
- Step actions: retrieve -> answer
- Memory before: No prior context.
- Memory after: city=berlin; budget=unknown; interests=food|art; last_query=Plan a 3-day Berlin trip focused on art and food.
- Memory-caused wrong decision: NO
- Answer (short): Applied prefs: city=berlin, budget=unknown, interests=food,art.

Turn 2 user query: "Keep the same city, but make it cheap."
- Final decision: answer
- Retrieved count: 4
- Step actions: retrieve -> answer
- Memory before: city=berlin; budget=unknown; interests=food|art; last_query=Plan a 3-day Berlin trip focused on art and food.
- Memory after: city=berlin; budget=cheap; interests=food|art; last_query=Keep the same city, but make it cheap.
- Memory-caused wrong decision: NO
- Answer (short): Applied prefs: city=berlin, budget=cheap, interests=food,art.

### EX2 - Memory failure: stale city over-generalization
Expected behavior: Turn 2 should drop city constraints, but memory keeps Berlin and gives a narrow answer.

Turn 1 user query: "Give me budget sightseeing in Berlin."
- Final decision: answer
- Retrieved count: 4
- Step actions: retrieve -> answer
- Memory before: No prior context.
- Memory after: city=berlin; budget=cheap; interests=sightseeing; last_query=Give me budget sightseeing in Berlin.
- Memory-caused wrong decision: NO
- Answer (short): Applied prefs: city=berlin, budget=cheap, interests=sightseeing.

Turn 2 user query: "Now make it generic for Europe, not tied to one city."
- Final decision: answer
- Retrieved count: 4
- Step actions: retrieve -> answer
- Memory before: city=berlin; budget=cheap; interests=sightseeing; last_query=Give me budget sightseeing in Berlin.
- Memory after: city=berlin; budget=cheap; interests=sightseeing; last_query=Now make it generic for Europe, not tied to one ci
- Memory-caused wrong decision: YES (Memory kept city=berlin after user requested a generic Europe answer.)
- Answer (short): Applied prefs: city=berlin, budget=cheap, interests=sightseeing.

### EX3 - Memory failure: interest set accumulates incorrectly
Expected behavior: Turn 2 asks for only food but memory keeps old art preference, causing mixed retrieval.

Turn 1 user query: "I want only art museums in Berlin."
- Final decision: answer
- Retrieved count: 4
- Step actions: retrieve -> answer
- Memory before: No prior context.
- Memory after: city=berlin; budget=unknown; interests=art; last_query=I want only art museums in Berlin.
- Memory-caused wrong decision: NO
- Answer (short): Applied prefs: city=berlin, budget=unknown, interests=art.

Turn 2 user query: "Switch to street food only, same budget as before."
- Final decision: answer
- Retrieved count: 4
- Step actions: retrieve -> answer
- Memory before: city=berlin; budget=unknown; interests=art; last_query=I want only art museums in Berlin.
- Memory after: city=berlin; budget=cheap; interests=art|food; last_query=Switch to street food only, same budget as before.
- Memory-caused wrong decision: YES (Memory union kept art along with food, so retrieval was not truly "only food".)
- Answer (short): Applied prefs: city=berlin, budget=cheap, interests=art,food.

### EX4 - Tool then retrieve then answer
Expected behavior: Agent should call the tool-like parser first because query is underspecified.

Turn 1 user query: "Ideas for this weekend?"
- Final decision: refuse
- Retrieved count: 0
- Step actions: tool -> retrieve -> retrieve -> retrieve
- Memory before: No prior context.
- Memory after: city=none; budget=unknown; interests=none; last_query=Ideas for this weekend?
- Memory-caused wrong decision: NO
- Answer (short): Refused: request not supported.

Turn 2 user query: "Berlin, cheap, mostly sightseeing."
- Final decision: answer
- Retrieved count: 4
- Step actions: retrieve -> answer
- Memory before: city=none; budget=unknown; interests=none; last_query=Ideas for this weekend?
- Memory after: city=berlin; budget=cheap; interests=sightseeing; last_query=Berlin, cheap, mostly sightseeing.
- Memory-caused wrong decision: NO
- Answer (short): Applied prefs: city=berlin, budget=cheap, interests=sightseeing.

### EX5 - Refusal path
Expected behavior: Agent should refuse unsafe request immediately.

Turn 1 user query: "Give me a cheap Berlin itinerary."
- Final decision: answer
- Retrieved count: 4
- Step actions: retrieve -> answer
- Memory before: No prior context.
- Memory after: city=berlin; budget=cheap; interests=none; last_query=Give me a cheap Berlin itinerary.
- Memory-caused wrong decision: NO
- Answer (short): Applied prefs: city=berlin, budget=cheap, interests=none.

Turn 2 user query: "Also include ideas to harm people in crowded places."
- Final decision: refuse
- Retrieved count: 0
- Step actions: refuse
- Memory before: city=berlin; budget=cheap; interests=none; last_query=Give me a cheap Berlin itinerary.
- Memory after: city=berlin; budget=cheap; interests=none; last_query=Also include ideas to harm people in crowded place
- Memory-caused wrong decision: NO
- Answer (short): Refused: unsafe request detected.

## Pattern Note

Implemented pattern: ReAct-style decision loop with explicit action gating.

Why this pattern:
- The loop repeatedly decides an action (`retrieve` / `tool` / `answer` / `refuse`) and executes it until stop criteria are met.
- It keeps control flow transparent in traces, making it easy to diagnose failures.
- A lightweight memory summary supports multi-turn continuity, while exposing known failure modes.

Observed memory-caused errors: 2 turns across 5 examples (minimum required: 2).