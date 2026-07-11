# Assignment Summary

- Task requested: Pick 30 strings (code, Urdu/Deutsch mix, emojis, long URLs, JSON), tokenize with 2 different tokenizers/models, compare counts, and explain 5 surprises.
- Approach used: Built a fixed 30-string dataset across required categories, then counted tokens using:
	- Model A: gpt-4o tokenizer via tiktoken
	- Model B: gpt-2 tokenizer via gpt-3-encoder
- Output produced: Comparison table for all strings plus 5 high-difference cases with short explanations.

# Tokenizer Comparison (30 Strings)

- Model A: gpt-4o tokenizer (tiktoken)
- Model B: gpt-2 tokenizer (gpt-3-encoder)
- Strings compared: 30
- Average tokens: Model A = 21.4, Model B = 25.9

## Table: string -> token_count_modelA vs modelB

| ID | Category | String | token_count_modelA | token_count_modelB | Diff (A-B) | Ratio (A/B) |
|---|---|---|---:|---:|---:|---:|
| s01 | code | const sum = (a, b) => a + b; | 13 | 13 | 0 | 1 |
| s02 | code | for (let i = 0; i < arr.length; i++) total += arr[i]; | 20 | 21 | -1 | 0.952 |
| s03 | code | SELECT city, SUM(amount) FROM orders GROUP BY city ORDER BY SUM(amount) DESC LIMIT 3; | 21 | 24 | -3 | 0.875 |
| s04 | code | if (user?.profile?.name) console.log(user.profile.name); | 14 | 20 | -6 | 0.7 |
| s05 | code | {"status":"ok","data":[1,2,3],"meta":{"cached":false}} | 19 | 20 | -1 | 0.95 |
| s06 | urdu+deutsch | Mujhe kal Berlin jana hai, aber ticket bohat mehnga hai. | 16 | 23 | -7 | 0.696 |
| s07 | urdu+deutsch | Yeh feature sahi lagta hai, doch performance thori slow hai. | 16 | 19 | -3 | 0.842 |
| s08 | urdu+deutsch | Bitte jaldi karo, client ka demo 5 minute mein hai. | 14 | 17 | -3 | 0.824 |
| s09 | urdu+deutsch | Das system theek hai lekin logs bilkul clear nahi hain. | 14 | 19 | -5 | 0.737 |
| s10 | urdu+deutsch | Aaj ka weather acha hai, trotzdem sunscreen mat bhoolna. | 14 | 19 | -5 | 0.737 |
| s11 | emoji | I passed the exam! 🎉✅📚 | 10 | 13 | -3 | 0.769 |
| s12 | emoji | Deploy failed 😭🔥 retrying now... | 9 | 11 | -2 | 0.818 |
| s13 | emoji | Weekend mood: 😴🍕🎬 | 9 | 12 | -3 | 0.75 |
| s14 | emoji | Ship it 🚀🚀🚀 then monitor 👀 | 12 | 15 | -3 | 0.8 |
| s15 | emoji | Family group be like 😂😂😂😂😂 | 9 | 14 | -5 | 0.643 |
| s16 | long-url | https://example.com/products/smart-sunscreen?city=karachi&weather=humid&uv_index=11&session_id=abc123xyz987&utm_source=newsletter&utm_medium=email&utm_campaign=spring_launch | 45 | 59 | -14 | 0.763 |
| s17 | long-url | https://docs.company.io/v1/api/reference/users/list?page=14&page_size=50&sort=last_login_desc&include=profile%2Cpermissions%2Cdevices | 36 | 49 | -13 | 0.735 |
| s18 | long-url | https://maps.example.org/route?from=31.5204,74.3587&to=33.6844,73.0479&mode=driving&avoid=tolls%2Chighways&lang=ur | 49 | 51 | -2 | 0.961 |
| s19 | long-url | https://cdn.site.net/assets/images/2026/03/12/high-resolution-super-long-file-name-with-many-segments-final-final-v2.png | 29 | 46 | -17 | 0.63 |
| s20 | long-url | https://auth.example.dev/oauth/authorize?client_id=mobile-app-22&redirect_uri=https%3A%2F%2Fapp.example.dev%2Fcallback&response_type=code&scope=openid%20profile%20email | 51 | 65 | -14 | 0.785 |
| s21 | json | {"event":"checkout","user":{"id":991,"tier":"gold"},"cart":[{"sku":"A1","qty":2},{"sku":"B9","qty":1}]} | 38 | 42 | -4 | 0.905 |
| s22 | json | {"city":"Lahore","forecast":[{"day":"Mon","temp":32},{"day":"Tue","temp":34}],"advice":"hydrate"} | 32 | 33 | -1 | 0.97 |
| s23 | json | {"error":{"code":"RATE_LIMIT","retry_after_ms":1200},"request_id":"req_89x7"} | 24 | 31 | -7 | 0.774 |
| s24 | json | {"query":"top cities","sql":"SELECT city, SUM(amount) total FROM orders GROUP BY city"} | 21 | 22 | -1 | 0.955 |
| s25 | json | {"a":[1,2,3,4,5,6,7,8,9,10],"b":true,"c":null,"d":"x"} | 35 | 35 | 0 | 1 |
| s26 | mixed | Password reset OTP is 583921. Do not share it with anyone. | 15 | 16 | -1 | 0.938 |
| s27 | mixed | Line1\nLine2\nLine3 with tabs	and spaces. | 13 | 14 | -1 | 0.929 |
| s28 | mixed | C:\Users\maheen\Documents\GenAi\reports\final_v3.pdf | 18 | 22 | -4 | 0.818 |
| s29 | mixed | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | 7 | 13 | -6 | 0.538 |
| s30 | mixed | The quick brown fox jumps over 13 lazy dogs near Zürich at 7:45pm. | 19 | 19 | 0 | 1 |

## 5 Surprises Explained

1. s19 (long-url) -> A=29, B=46, diff=-17
Reason: Long URLs contain many separators and uncommon fragments, so merge rules differ heavily between tokenizers.
2. s06 (urdu+deutsch) -> A=16, B=23, diff=-7
Reason: Mixed-language transliteration has less frequent token merges, so token splits vary across model vocabularies.
3. s23 (json) -> A=24, B=31, diff=-7
Reason: Structured symbols like braces, quotes, and repeated key patterns may compress better in one tokenizer than another.
4. s04 (code) -> A=14, B=20, diff=-6
Reason: Code syntax has predictable punctuation patterns; each tokenizer may chunk operators and identifiers differently.
5. s29 (mixed) -> A=7, B=13, diff=-6
Reason: This string combines uncommon patterns where each tokenizer applies different merge boundaries.

## Raw Notes

- Positive diff means Model A used more tokens.
- Negative diff means Model B used more tokens.
- Ratios near 1 indicate similar segmentation behavior.

## End Result: Better Method and Why

- Better method: Model A tokenizer (gpt-4o via tiktoken) for this dataset.
- Why: it consistently used fewer tokens on average (21.4 vs 25.9), which improves context efficiency and reduces token cost on mixed code, URL, emoji, and multilingual text.