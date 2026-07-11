# LLM Temperature Comparison Report

- Date: 2026-03-12T07:27:08.151Z
- Model: llama3
- Runs: 10 prompts x 3 temperatures = 30
- Temperatures: 0, 0.7, 1

## Aggregate Metrics by Temperature

| Temperature | Avg Words | Avg Chars | Avg Latency (ms) |
|---|---:|---:|---:|
| 0 | 110.1 | 681.5 | 7909.1 |
| 0.7 | 114.7 | 695.9 | 7740.2 |
| 1 | 113.6 | 707 | 7665.2 |

## Prompt-Level Diversity (Lower Similarity = More Variation)

| Prompt | Avg Pair Similarity |
|---|---:|
| p1 - Simple explanation | 0.28 |
| p2 - Rewrite style | 0.432 |
| p3 - Debug suggestion | 0.345 |
| p4 - Marketing copy | 0.514 |
| p5 - SQL reasoning | 0.662 |
| p6 - Test case design | 0.404 |
| p7 - Summarization | 0.41 |
| p8 - Creative variant | 0.36 |
| p9 - Instruction following | 0.293 |
| p10 - Tradeoff analysis | 0.417 |

## Output Samples by Prompt and Temperature

### p1: Simple explanation

Prompt: Explain recursion to a 12-year-old in exactly 3 short bullet points.

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 175 | 992 | 220 | 11909 | Here are three short bullet points that explain recursion to a 12-year-old:  • **Recursion is like a puzzle**: Imagine you have a puzzle with many pieces, and each piece has a smaller puzzle inside it. To solve the puzzl |
| 0.7 | 180 | 995 | 220 | 11367 | Here are three short bullet points that explain recursion to a 12-year-old:  • **Recursion is a way of solving a problem by breaking it down into smaller problems**: Imagine you have a big box of LEGOs, and you need to c |
| 1 | 176 | 987 | 220 | 11434 | Here's an explanation of recursion that a 12-year-old can understand:  • **Recursion is a way of solving a problem by breaking it down into smaller problems**: Imagine you're trying to clean your room, and it's really me |

### p2: Rewrite style

Prompt: Rewrite this sentence in a professional tone while keeping it short: "our app keeps crashing and users are angry".

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 14 | 120 | 17 | 1110 | "Our mobile application is experiencing technical difficulties, resulting in frequent crashes and user dissatisfaction." |
| 0.7 | 23 | 163 | 27 | 1602 | Here is a rewritten version of the sentence in a professional tone:  "Our mobile application has experienced recurring crashes, resulting in user dissatisfaction." |
| 1 | 25 | 184 | 29 | 1566 | Here is a rewritten version of the sentence in a professional tone:  "Our application has experienced technical difficulties, resulting in user frustration and decreased satisfaction." |

### p3: Debug suggestion

Prompt: A Node.js app memory usage grows over time. Give 5 practical debugging steps in priority order.

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 139 | 897 | 220 | 11753 | The eternal struggle of memory leaks in Node.js! Here are 5 practical debugging steps to help you identify and fix the issue, in priority order:  **1. Use `node --max-old-space-size` to set a memory limit**  Start your N |
| 0.7 | 166 | 938 | 220 | 11686 | Here are 5 practical debugging steps to help you identify and address the memory usage growth issue in your Node.js app, in priority order:  **Step 1: Monitor Memory Usage with Node.js Built-in Tools (Priority: High)**   |
| 1 | 166 | 1064 | 220 | 11518 | The age-old problem of growing memory usage in a Node.js app! Here are 5 practical debugging steps to help you identify and resolve the issue, in priority order:  **1. Check for memory leaks using a profiling tool (e.g., |

### p4: Marketing copy

Prompt: Write a 4-line landing page hero copy for a weather-based shopping app.

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 51 | 299 | 65 | 3585 | Here is a 4-line landing page hero copy for a weather-based shopping app:  "Get ready to shop smarter, not harder. Our app uses real-time weather data to suggest the perfect outfit for your day. From rain boots to sungla |
| 0.7 | 65 | 380 | 80 | 4214 | Here is a 4-line landing page hero copy for a weather-based shopping app:  "Get ready to shop smart, not hard. Our app uses real-time weather data to give you the inside scoop on what to wear and what to buy. From sunny  |
| 1 | 51 | 309 | 71 | 3691 | Here is a 4-line landing page hero copy for a weather-based shopping app:  "Get ready to shop smart with WeatherWise! Our app uses real-time weather data to suggest the perfect outfits for your day. From rain boots to su |

### p5: SQL reasoning

Prompt: Given users(id, city) and orders(id, user_id, amount), write SQL to find top 3 cities by total order amount.

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 158 | 833 | 220 | 11682 | Here is the SQL query to find the top 3 cities by total order amount: ``` SELECT c.city, SUM(o.amount) AS total_amount FROM users u JOIN orders o ON u.id = o.user_id JOIN (SELECT id, city FROM users) c ON u.city = c.city |
| 0.7 | 166 | 867 | 220 | 11447 | Here is the SQL query to find the top 3 cities by total order amount: ``` SELECT c.city, SUM(o.amount) AS total_amount FROM users u JOIN orders o ON u.id = o.user_id JOIN (SELECT DISTINCT city FROM users) c ON u.city = c |
| 1 | 136 | 742 | 186 | 9430 | Here is the SQL query to find the top 3 cities by total order amount: ``` SELECT city, SUM(amount) AS total_amount FROM orders JOIN users ON orders.user_id = users.id GROUP BY city ORDER BY total_amount DESC LIMIT 3; ``` |

### p6: Test case design

Prompt: Create 6 edge-case test ideas for a checkout form with card payment.

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 155 | 951 | 220 | 11367 | Here are 6 edge-case test ideas for a checkout form with card payment:  1. **Invalid Card Number**: Test that the form rejects a card number with an invalid format (e.g. too few or too many digits, non-numeric characters |
| 0.7 | 173 | 1035 | 220 | 11319 | Here are 6 edge-case test ideas for a checkout form with card payment:  1. **Invalid Card Number**: Test that the form correctly validates an invalid card number, such as a number that is too short or too long, or contai |
| 1 | 181 | 1084 | 220 | 11278 | Here are 6 edge-case test ideas for a checkout form with card payment:  1. **Expired Card Test**: Test the checkout form with an expired card (e.g. card expiration date is 2 years in the past). Verify that the form rejec |

### p7: Summarization

Prompt: Summarize this in one sentence: "Temperature-aware shopping improves relevance by linking weather context with product suggestions."

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 32 | 242 | 36 | 2029 | Temperature-aware shopping is a technology that enhances the relevance of product suggestions by considering the current weather conditions and linking them to relevant products, making the shopping experience more perso |
| 0.7 | 26 | 197 | 30 | 1602 | Temperature-aware shopping uses weather context to improve the relevance of product suggestions, allowing customers to discover products that are more suitable for their current weather conditions. |
| 1 | 28 | 215 | 33 | 1743 | Temperature-aware shopping is a feature that enhances the shopping experience by incorporating current weather conditions into product recommendations, making them more relevant and personalized to the user's needs. |

### p8: Creative variant

Prompt: Give 5 alternative names for a smart sunscreen recommendation feature.

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 163 | 1086 | 202 | 10376 | Here are 5 alternative names for a smart sunscreen recommendation feature:  1. **SunSmart**: This name suggests that the feature is intelligent and will provide users with smart recommendations for their sunscreen needs. |
| 0.7 | 164 | 1096 | 206 | 10414 | Here are five alternative names for a smart sunscreen recommendation feature:  1. **SunSmart**: This name suggests that the feature provides intelligent and informed recommendations for selecting the right sunscreen base |
| 1 | 168 | 1064 | 209 | 10602 | Here are five alternative name options for a smart sunscreen recommendation feature:  1. **SunSense Advisor**: This name suggests that the feature is providing expert advice on how to protect your skin from the sun, whil |

### p9: Instruction following

Prompt: Respond with JSON only: keys reason, action, confidence for choosing moisturizers in cold weather.

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 45 | 281 | 75 | 3998 | { "reason": ["Hydration is crucial in cold weather to prevent dryness and itchiness", "Moisturizers help lock in moisture and protect the skin from harsh winds"], "action": ["Apply a rich and creamy moisturizer", "Use a  |
| 0.7 | 60 | 429 | 102 | 5225 | { "reason": [ "Moisturizers help to lock in moisture and protect skin from dryness and irritation", "To combat dry skin and windburn caused by cold weather", "Moisturizers provide a barrier against harsh winter condition |
| 1 | 39 | 284 | 82 | 4212 | { "reason": [ "Protect skin from dryness", "Prevent chapping and cracking", "Keep skin hydrated and plump" ], "action": [ "Apply a rich and creamy moisturizer", "Use a hydrating serum before moisturizing", "Exfoliate bef |

### p10: Tradeoff analysis

Prompt: Compare rule-based agents and LLM-based agents in 4 concise bullets focusing on reliability and flexibility.

| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |
|---|---:|---:|---:|---:|---|
| 0 | 169 | 1114 | 220 | 11282 | Here are 4 concise bullets comparing rule-based agents and LLM-based agents in terms of reliability and flexibility:  • **Reliability:** Rule-based agents are generally more reliable as they follow a set of predefined ru |
| 0.7 | 124 | 859 | 168 | 8526 | Here are 4 concise bullets comparing rule-based agents and LLM-based agents in terms of reliability and flexibility:  **Reliability:**  * Rule-based agents are generally more reliable, as their decision-making is based o |
| 1 | 166 | 1137 | 220 | 11178 | Here are 4 concise bullets comparing rule-based agents and LLM-based agents in terms of reliability and flexibility:  • **Reliability**: Rule-based agents are more reliable in that they follow a set of predefined rules t |

## End Result: Better Method and Why

- Better method: temperature 0.7 (balanced decoding).
- Why: it kept output quality close to temperature 0 while producing more variation than temperature 0 and fewer unstable responses than temperature 1.

