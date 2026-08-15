DRAFT WAR ROOM AI - FAST TRACK

Files:
- config.js                  Frontend backend URL config
- ai-engine.js               Enhanced snapshot + Recommend/Chat overrides
- api/assistant.js           Vercel serverless AI endpoint
- package.json               OpenAI SDK dependency
- index-script-snippet.txt   Script tags to add to index.html

Backend environment variables:
OPENAI_API_KEY   required
OPENAI_MODEL     optional; defaults to gpt-5-mini
ALLOWED_ORIGINS  optional comma-separated origins

The API key belongs ONLY in Vercel environment variables. Never put it in config.js,
ai-engine.js, GitHub Pages, or any browser-visible file.
