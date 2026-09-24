---
"@lystran/pi-session-rename": minor
---

Rewrite the session title prompt and widen the title length limit

- Send the title instructions as a system prompt and the user's first message as the only user message, instead of mixing three English instruction lines into the text being named
- Require the title to be written in the language the user wrote in rather than in the language of the instructions, and keep code identifiers, paths, commands, and error codes exactly as written
- Require the title to start with an imperative verb immediately followed by the specific thing the user named, with four few-shot examples and an explicit ban on labels such as `Help with code` or `Code changes`
- Name a first message that is only a greeting by its tone instead of reporting that no title is possible
- Raise the title length limit from 10 Chinese characters / 5 non-Chinese words to 20 / 10, and report only the exceeded limit on retry
- Reduce the length retry budget from 3 attempts to 1, while keeping 3 attempts for a reply that carries no title text at all
- Keep the retry message free of instructions: it carries the rejected title and the exceeded limit only, and the rule for rewriting it lives in the system prompt so the instructions do not change between attempts
- Opt the title request out of prompt caching with `cacheRetention: "none"`
- Export `buildTitleSystemPrompt` and `TitleRequestOptions`; `buildRetryTitlePrompt` now also takes the user's first message
- Drop the retry count from the length warning, which two independent retry budgets made meaningless
