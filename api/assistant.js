import OpenAI from "openai";

const client=new OpenAI({
  apiKey:process.env.OPENAI_API_KEY
});

/*
  Recommended production setting for Draft War Room:
  OPENAI_MODEL=gpt-5.6-terra
  OPENAI_REASONING_EFFORT=medium

  The environment variable still wins so the model can be changed without
  editing source code.
*/
const MODEL=process.env.OPENAI_MODEL||"gpt-5.6-terra";
const REASONING_EFFORT=process.env.OPENAI_REASONING_EFFORT||"medium";
const CHAT_REASONING_EFFORT=process.env.OPENAI_CHAT_REASONING_EFFORT||"low";

const DEFAULT_ALLOWED_ORIGINS=[
  "https://draft.ryanroehler.com",
  "https://rroehler.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

function allowedOrigins(){
  const configured=(process.env.ALLOWED_ORIGINS||"")
    .split(",")
    .map(x=>x.trim())
    .filter(Boolean);

  return configured.length?configured:DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(request){
  const origin=request.headers.get("origin")||"";
  const allowed=allowedOrigins();
  const localhost=/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  const permitted=allowed.includes(origin)||localhost;

  return {
    "Access-Control-Allow-Origin":permitted?origin:allowed[0],
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
    "Vary":"Origin",
    "Content-Type":"application/json"
  };
}

function json(data,status,request){
  return new Response(JSON.stringify(data),{
    status,
    headers:corsHeaders(request)
  });
}

const BASE_INSTRUCTIONS=`
You are the decision engine for Draft War Room, a live 12-team ESPN full-PPR fantasy football draft assistant.

Your job is to make the best live selection for High Roehler from the supplied state. Do not give generic fantasy advice and do not mechanically draft the lowest Overall Rank.

DECISION HIERARCHY — use this order:

1. VALIDITY AND FEASIBILITY
- Never recommend a player who is not in availablePlayers.
- state.intelligence.hardConstraints is authoritative.
- If mustFillStarterNow is true, the recommendation must reduce openStartingSlotsTotal. A pure depth pick is invalid.
- Target totals are roster-building goals, not fixed starter requirements. The lineup requirements in state.intelligence.roster.lineup are authoritative.

2. MARGINAL LINEUP VALUE
- candidate.lineupImpact is a canonical fact calculated by the app. Do not reinterpret it.
- fills_base_starter means the player fills an empty fixed starter slot.
- fills_flex means fixed slots at that position are filled but the player fills the currently open FLEX.
- depth means the player does not fill any currently open starting slot.
- duplicate_one_start means the player duplicates a one-starter position already anchored by a premium keeper.
- Do not say a position is "covered" unless its fixed starter requirement is actually filled.
- In particular, this league starts THREE WRs. One WR or two WRs is not "WR covered" and is not merely a request for WR depth.

3. KEEPER LEVERAGE
- A premium keeper at a one-starter position changes the economics of the draft.
- If state.intelligence.keeperLeverage.premiumOneStarterAnchor is true, early duplication of that QB or TE has a high opportunity cost.
- A second early QB/TE can still be correct if the falling value is extraordinary, but a small rank edge or ordinary Tier-1 label is not enough by itself.
- Example principle: a top-five QB kept in Round 13 is a reason to spend early capital on other starting positions, not a reason to upgrade QB merely because QB1 is available near market price.

4. FORMAT-SPECIFIC ROSTER CONSTRUCTION
- This is full PPR with 3 WR plus FLEX. There are 36 fixed WR starter slots league-wide before FLEX, versus 24 fixed RB starter slots.
- WR starter scarcity must be treated structurally. Repeatedly adding RB depth while two fixed WR starter slots remain open can create a losing roster even if each RB is individually near his Overall Rank.
- Do NOT apply a rigid "draft WR by Round X" rule. Strong falling value can justify delaying need.
- But a pure bench-depth pick at a fully covered position should generally require a clearly superior tier and/or a major falling-value exception when multiple core fixed starter slots remain open elsewhere.
- A tiny Overall Rank advantage is not enough to justify a bench-depth pick over an unfilled starter in the middle rounds.
- When state.intelligence.structuralWarnings says two or more WR slots remain open, take that seriously.

5. OVERALL RANK, TIERS, AND VALUE
- Overall Rank is the primary static cross-position value board, but roster-dependent value can override it.
- Tier identifies meaningful value cliffs. Tier gaps often matter more than a handful of Overall Rank spots.
- Position Rank gives within-position strength.
- Our Label is a conviction/context signal.
- Treat Overall Rank gaps of only a few picks as effectively close. Use roster fit and tier context to break those ties.
- A large fall well past Overall Rank can justify taking the value even when another position is a greater need, especially if the falling player fills a base starter or FLEX rather than becoming bench depth.

6. POSITIONAL DEPLETION AND WAITING COST
- state.intelligence.positionSupply contains the exact remaining counts by tier and the number of Tier 1-2 players remaining.
- If High Roehler has open starter slots at a position and only one or two upper-tier options remain, the cost of waiting rises sharply.
- Compare what is available now with what is plausibly left at the true next High Roehler pick.
- ADP is a market-timing signal only. It estimates when the room may take a player; it is NOT the value board.
- If userTurn.opponentLivePickCountBeforeNextUser is 0, no opponent can take a player before the next High Roehler selection. Never claim otherwise.

7. SNAKE-TURN LOGIC
- state.draft.userTurn is authoritative.
- At a back-to-back turn, optimize the whole turn as a multi-pick package, not two isolated picks.
- The first recommendation should be one member of the strongest turn combination. Use nextPickPlan to say what the complementary second pick should accomplish.
- When there are zero opponent live picks between the two selections, order does not create availability risk.
- Use followingUserPickAfterTurn when judging who must be secured before leaving the turn.

8. OBSERVED RUNS VS PREDICTED DEMAND
- state.intelligence.runEvidence contains observed recent selections. Only call something a "run" or say a position "is being chased" when those observed counts support it.
- positionSupply.*.potentialDemandBeforeNext is only potential demand based on open roster slots. Phrase it as "could need" or "may create demand," never as certainty.
- Never invent another manager's intentions.

9. ONE-STARTER AND LATE POSITIONS
- QB and TE are one-starter positions. Once filled strongly, extra early investment needs a real reason.
- DP, D/ST, and K must be filled by the end but should normally not displace core offensive value early or in the middle rounds.
- As depthBudget approaches zero, preserve enough remaining live picks to finish every starter slot.

10. UPSIDE AFTER THE CORE IS BUILT
- Once fixed starters and FLEX are substantially filled, shift toward upside, contingency value, and depth rather than drafting low-ceiling players merely to hit target totals.
- Bench targets are goals, not quotas.

CONSISTENCY RULES
- Before finalizing, compare the recommended player against the best fills_base_starter candidate, best fills_flex candidate, and best pure depth candidate supplied in intelligence.bestByImpact.
- If recommending depth while coreBaseOpenTotal is 2 or more, explicitly identify the exceptional value/tier reason. If there is no exceptional reason, prefer the starter-filling alternative.
- If recommending duplicate_one_start, explicitly justify why the upgrade is worth sacrificing the keeper leverage. Ordinary value is not enough.
- If WR has two or more fixed starter slots open in Round 5 or later, a depth RB with roughly similar tier/value should lose to a viable WR starter.
- Never claim a player improves the starting lineup if candidate.lineupImpact is depth or duplicate_one_start.

Draft Commandments in state.strategy.commandments are binding as interpreted through these roster-aware rules.
`;

const RECOMMEND_SCHEMA={
  type:"object",
  additionalProperties:false,
  required:[
    "recommendation",
    "confidence",
    "lineupImpact",
    "decisionClass",
    "reason",
    "warning",
    "alternatives",
    "canWaitOn",
    "nextPickPlan"
  ],
  properties:{
    recommendation:{type:"string"},
    confidence:{type:"integer",minimum:0,maximum:100},
    lineupImpact:{
      type:"string",
      enum:[
        "fills_base_starter",
        "fills_flex",
        "depth",
        "duplicate_one_start"
      ]
    },
    decisionClass:{
      type:"string",
      enum:[
        "starter_value",
        "tier_cliff",
        "value_fall",
        "keeper_leverage",
        "turn_package",
        "late_constraint",
        "depth_upside"
      ]
    },
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
    },
    nextPickPlan:{type:"string"}
  }
};

function recommendPrompt(state,correction=""){
  return `
Make the current Draft War Room recommendation from this live state.

Run this internal checklist before answering:
1) Read hardConstraints and the exact lineup.baseOpen/FLEX state.
2) Read keeperLeverage before considering QB or TE duplication.
3) Compare the best candidates by canonical lineupImpact.
4) Compare Overall Rank and Tier; distinguish tiny rank gaps from real falling value.
5) Check exact positionSupply/tier depletion for every open core starter position.
6) Check true opponent-live-pick count and ADP timing before saying a player will not make it back.
7) Check observed runEvidence before describing a positional run.
8) If this is a back-to-back turn, optimize the two-pick package.
9) Stress-test the choice: what is the cost if High Roehler waits on the recommendation's position, and what is the cost of passing the best open-starter alternative?

Return one exact player name from availablePlayers.
lineupImpact MUST exactly match the selected candidate's lineupImpact field.

Reason bullets must be brief enough for a live draft clock and should explain the decisive facts, not generic fantasy advice.
warning should be empty when there is no material warning.
nextPickPlan should be one short sentence describing the next roster/board priority.

${correction?`VALIDATION FEEDBACK FROM THE PRIOR ATTEMPT:\n${correction}\nRe-evaluate from scratch. You may return the same player only if the live facts genuinely justify it.\n`:''}
LIVE STATE:
${JSON.stringify(state)}
`;
}

function chatPrompt(state,message){
  return `
Answer the user's live draft question using the supplied state and the same roster-aware decision hierarchy used for recommendations.

Be concise, decisive, and specific.
If the question asks who to draft, name exact players from availablePlayers.
Distinguish fixed starter need, FLEX, and bench depth.
Respect premium keeper leverage at one-starter positions.
Use Overall Rank for value, Tier for cliffs, ADP for availability, and observed runEvidence only for claims about runs.
If uncertainty exists, identify the uncertainty rather than inventing another manager's intentions.

QUESTION:
${message}

LIVE STATE:
${JSON.stringify(state)}
`;
}

function findCandidate(state,name){
  return (state.availablePlayers||[]).find(
    candidate=>candidate.name===name
  )||null;
}

function validationIssues(result,state){
  const hard=[];
  const soft=[];
  const candidate=findCandidate(state,result?.recommendation);

  if(!candidate){
    hard.push('The recommended player is not in availablePlayers.');
    return {hard,soft,candidate:null};
  }

  if(result.lineupImpact!==candidate.lineupImpact){
    hard.push(
      `lineupImpact must be ${candidate.lineupImpact} for ${candidate.name}, not ${result.lineupImpact}.`
    );
  }

  const hardConstraints=state.intelligence?.hardConstraints||{};

  if(
    hardConstraints.mustFillStarterNow &&
    Number(candidate.starterSlotsFilledDelta||0)<1
  ){
    hard.push(
      `${candidate.name} does not reduce an open starting slot, but depthBudget is ${hardConstraints.depthBudget}; a starter-filling pick is required.`
    );
  }

  const lineup=state.intelligence?.roster?.lineup||{};
  const round=Number(state.draft?.currentRound||0);
  const boardSurplus=Number(candidate.boardSurplusPicks||0);

  if(
    candidate.lineupImpact==='duplicate_one_start' &&
    candidate.samePositionAsPremiumKeeper &&
    round<=8 &&
    boardSurplus<18
  ){
    soft.push(
      `${candidate.name} duplicates a premium one-starter keeper and is not a major 1.5-round-or-more fall. Compare the opportunity cost at open starter positions before repeating this position.`
    );
  }

  if(
    candidate.lineupImpact==='depth' &&
    Number(lineup.coreBaseOpenTotal||0)>=2 &&
    round>=5 &&
    boardSurplus<15
  ){
    soft.push(
      `${candidate.name} is pure bench depth while ${lineup.coreBaseOpenTotal} core fixed starter slots remain open, and the board surplus is only ${boardSurplus} picks. A small value edge is not enough by itself.`
    );
  }

  const wrOpen=Number(lineup.baseOpen?.WR||0);
  if(
    wrOpen>=2 &&
    round>=5 &&
    candidate.lineupImpact==='depth'
  ){
    const bestWR=(state.availablePlayers||[])
      .filter(c=>c.pos==='WR')
      .slice()
      .sort((a,b)=>(a.rank||9999)-(b.rank||9999))[0];

    if(bestWR){
      const rankEdge=(bestWR.rank||9999)-(candidate.rank||9999);
      const tierEdge=(bestWR.tier||99)-(candidate.tier||99);

      if(rankEdge<24 && tierEdge<2){
        soft.push(
          `High Roehler still has ${wrOpen} fixed WR starters open. ${candidate.name} is depth, while ${bestWR.name} can fill WR; the depth candidate lacks a sufficiently large tier/rank exception to ignore the 3-WR structure without a very strong justification.`
        );
      }
    }
  }

  return {hard,soft,candidate};
}

async function callRecommendationModel(state,correction=""){
  const response=await client.responses.create({
    model:MODEL,
    reasoning:{effort:REASONING_EFFORT},
    instructions:BASE_INSTRUCTIONS,
    input:recommendPrompt(state,correction),
    text:{
      verbosity:"low",
      format:{
        type:"json_schema",
        name:"draft_recommendation",
        description:"A concise, roster-aware live fantasy draft recommendation.",
        strict:true,
        schema:RECOMMEND_SCHEMA
      }
    }
  });

  return JSON.parse(response.output_text);
}

async function recommend(state){
  let result=await callRecommendationModel(state);
  let issues=validationIssues(result,state);
  let validationRetry=false;

  if(issues.hard.length||issues.soft.length){
    validationRetry=true;
    const correction=[...issues.hard,...issues.soft]
      .map((issue,index)=>`${index+1}. ${issue}`)
      .join('\n');

    result=await callRecommendationModel(state,correction);
    issues=validationIssues(result,state);
  }

  const candidate=findCandidate(state,result.recommendation);

  /* Canonical app fact wins if the second model response mislabeled impact. */
  if(candidate){
    result.lineupImpact=candidate.lineupImpact;
  }

  /* A hard late-draft feasibility failure should never silently pass. */
  if(issues.hard.length){
    const valid=(state.availablePlayers||[])
      .filter(c=>Number(c.starterSlotsFilledDelta||0)>0)
      .sort((a,b)=>(a.rank||9999)-(b.rank||9999));

    if(state.intelligence?.hardConstraints?.mustFillStarterNow && valid.length){
      const fallback=valid[0];
      return {
        recommendation:fallback.name,
        confidence:60,
        lineupImpact:fallback.lineupImpact,
        decisionClass:"late_constraint",
        reason:[
          `Starter-feasibility guardrail: ${state.intelligence.hardConstraints.depthBudget} depth picks remain available before the lineup becomes impossible to complete.`,
          `${fallback.name} is the highest-ranked available candidate that reduces an open starting slot.`
        ],
        warning:"The model response failed a hard lineup-feasibility validation, so the app used the highest-ranked valid starter-filling fallback.",
        alternatives:valid.slice(1,4).map(c=>c.name),
        canWaitOn:[],
        nextPickPlan:"Continue filling the remaining open starter slots before taking additional bench depth.",
        validationRetry:true,
        validationFallback:true
      };
    }
  }

  return {
    ...result,
    validationRetry,
    validationFallback:false
  };
}

async function chat(state,message){
  const response=await client.responses.create({
    model:MODEL,
    reasoning:{effort:CHAT_REASONING_EFFORT},
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
    const {mode,state,message}=body||{};

    if(!state||typeof state!=="object"){
      return json({error:"Missing draft state."},400,request);
    }

    if(mode==="recommend"){
      return json(await recommend(state),200,request);
    }

    if(mode==="chat"){
      if(!message||typeof message!=="string"){
        return json({error:"Missing chat message."},400,request);
      }

      return json(await chat(state,message),200,request);
    }

    return json({error:"Unknown AI mode."},400,request);
  }catch(error){
    console.error(error);
    return json({
      error:error?.message||"AI backend error."
    },500,request);
  }
}
