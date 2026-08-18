import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://draft.ryanroehler.com",
  "https://rroehler.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

function allowedOrigins(){
  const configured=(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(x=>x.trim())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(request){
  const origin=request.headers.get("origin") || "";
  const allowed=allowedOrigins();
  const localhost=/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  const permitted=allowed.includes(origin) || localhost;

  return {
    "Access-Control-Allow-Origin": permitted ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Content-Type": "application/json"
  };
}

function json(data,status,request){
  return new Response(JSON.stringify(data),{
    status,
    headers:corsHeaders(request)
  });
}

const BASE_INSTRUCTIONS = `
You are the decision engine for Draft War Room, a live 12-team ESPN full-PPR fantasy football draft assistant.

Your job is not to give generic fantasy advice. Use the supplied live draft state to make the best decision for High Roehler.

Core behavior:
- Treat Overall Rank as the primary cross-position player-value board. Lower rank is better.
- Use Tier to identify meaningful value cliffs and Our Label as an additional conviction/context signal.
- Use Position Rank to understand strength within a position.
- ADP predicts market availability; it does not define player value. A meaningful gap between Overall Rank and ADP can indicate value or a player who may be able to wait.
- Use state.draft.userTurn as the authoritative snake-turn context.
- If High Roehler is currently on the clock, nextUserPick means the NEXT live High Roehler selection after the current pick, never the current pick itself.
- If state.draft.userTurn.opponentLivePickCountBeforeNextUser is 0, no opponent can take an available player before High Roehler's next selection. Never claim that a player is at risk of disappearing before that next pick.
- When state.draft.userTurn.isBackToBackTurn is true, optimize the entire current turn as a multi-pick package. The first recommendation should be one member of the strongest two-pick combination, and the reasoning should identify the complementary plan for the other turn pick when useful.
- On a back-to-back turn, use followingUserPickAfterTurn and opponentLivePickCountBeforeFollowingTurn when judging whether a player can wait beyond the current turn.
- Compare the value of drafting a player now against the likely value available at High Roehler's true next live pick and, when on a back-to-back turn, against the board likely to remain after the whole turn.
- Pay attention to tier cliffs. If waiting through opposing live picks likely loses an entire tier, that matters heavily.
- Use the opponents' roster counts and the managers picking before High Roehler's next turn to estimate positional demand, but do not pretend to know what another manager will do.
- Recent positional runs are evidence, not commands. Never chase a run automatically.
- Full-PPR lineup has 3 starting WR plus FLEX, so strong WR depth has legitimate lineup value.
- Avoid rigid positional round plans. Take the best value that improves expected lineup strength and future flexibility.
- QB and TE scarcity can justify taking an elite option, but do not manufacture scarcity.
- Late in the draft, required positions are hard constraints. If High Roehler has 4 or fewer live picks left and any of QB/RB/WR/TE/DP/D/ST/K is still empty, protect the ability to fill every required position. With one pick left, select a missing required position.
- Do not over-weight historical manager behavior. This year's live draft is the strongest evidence.
- The user has limited player knowledge and the draft moves quickly. Be decisive and concise.
- Never recommend a player who is not in availablePlayers.

Draft Commandments supplied in state.strategy.commandments are binding unless a hard roster-rule constraint overrides them.
`;

const RECOMMEND_SCHEMA = {
  type:"object",
  additionalProperties:false,
  required:["recommendation","confidence","reason","warning","alternatives","canWaitOn"],
  properties:{
    recommendation:{type:"string"},
    confidence:{type:"integer",minimum:0,maximum:100},
    reason:{
      type:"array",
      minItems:2,
      maxItems:4,
      items:{type:"string"}
    },
    warning:{type:"string"},
    alternatives:{
      type:"array",
      minItems:0,
      maxItems:3,
      items:{type:"string"}
    },
    canWaitOn:{
      type:"array",
      minItems:0,
      maxItems:3,
      items:{type:"string"}
    }
  }
};

function recommendPrompt(state){
  return `
Make the current Draft War Room recommendation from this live state.

Return one player in recommendation, using the exact player name from availablePlayers.

Reason bullets must be brief and useful under draft-clock pressure. Focus on:
1) Overall Rank, tier/value cliff, and any useful Rank-vs-ADP gap,
2) true snake-turn timing: how many opponent live picks occur before the next High Roehler pick, and whether this is a back-to-back turn,
3) roster/lineup impact and, on a back-to-back turn, the best complementary second selection,
4) meaningful live-draft positional pressure and whether the player can survive beyond the entire current turn.

warning should be an empty string when there is no important warning.
alternatives should contain up to 3 exact available player names.
canWaitOn should contain up to 3 positions or player archetypes that can reasonably wait.

LIVE STATE:
${JSON.stringify(state)}
`;
}

function chatPrompt(state,message){
  return `
Answer the user's live draft question using the supplied state. Be concise, decisive, and specific.
If the question asks who to draft, name exact available players.
If uncertainty exists, state the key uncertainty instead of pretending to know another manager's intentions.
Do not give a long fantasy-football lecture unless explicitly asked.

QUESTION:
${message}

LIVE STATE:
${JSON.stringify(state)}
`;
}

async function recommend(state){
  const response=await client.responses.create({
    model:MODEL,
    reasoning:{effort:"low"},
    instructions:BASE_INSTRUCTIONS,
    input:recommendPrompt(state),
    text:{
      verbosity:"low",
      format:{
        type:"json_schema",
        name:"draft_recommendation",
        description:"A concise live fantasy draft recommendation.",
        strict:true,
        schema:RECOMMEND_SCHEMA
      }
    }
  });

  return JSON.parse(response.output_text);
}

async function chat(state,message){
  const response=await client.responses.create({
    model:MODEL,
    reasoning:{effort:"low"},
    instructions:BASE_INSTRUCTIONS,
    input:chatPrompt(state,message),
    text:{verbosity:"low"}
  });

  return {answer:response.output_text};
}

export function OPTIONS(request){
  return new Response(null,{
    status:204,
    headers:corsHeaders(request)
  });
}

export async function POST(request){
  try{
    if(!process.env.OPENAI_API_KEY){
      return json({error:"OPENAI_API_KEY is not configured on the backend."},500,request);
    }

    const body=await request.json();
    const {mode,state,message}=body || {};

    if(!state || typeof state!=="object"){
      return json({error:"Missing draft state."},400,request);
    }

    if(mode==="recommend"){
      return json(await recommend(state),200,request);
    }

    if(mode==="chat"){
      if(!message || typeof message!=="string"){
        return json({error:"Missing chat message."},400,request);
      }
      return json(await chat(state,message),200,request);
    }

    return json({error:"Unknown AI mode."},400,request);
  }catch(error){
    console.error(error);
    return json({
      error:error?.message || "AI backend error."
    },500,request);
  }
}
