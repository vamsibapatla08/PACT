# Pact promo video script

**Length:** 2:45 (the rules allow 2 to 3 minutes)
**Format:** screen recordings of the real app, plus the Grok Bot demo video from the landing page
**Voice:** read the voiceover yourself, or generate it with ElevenLabs. An ElevenLabs voiceover is one more point for that bounty.
**Live site:** getpact.space

## Before you record

- Push and deploy first, so everything below is live:
  - `supabase db push --workdir backend`
  - `supabase functions deploy pilot-voice --workdir backend`
  - Then push the frontend
- Make a fresh demo pact so the numbers are clean. For example "Austin weekend": 3 people, $300 each, Nov 19 to 22, with the place and dates set.
- Hide personal details. Use avatars without real photos, and keep wallet addresses off screen except the short `0x5d56…7748` form.
- Record at 1440×900 or larger, with no sound. Add the voiceover after.
- Have a second phone or browser signed in as another member, so you can show a vote and a payment from both sides.

## Script

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:10** | A busy group chat: "who's booking?", "I'll pay you back", "did anyone get the Airbnb?" | Every group trip starts the same way. A great idea, a group chat, and nobody who wants to front the money. |
| **0:10–0:22** | One person's banking app: four payment requests marked unpaid. | One person books it all, then spends weeks chasing everyone for their share. Half the time the trip just dies in the chat. |
| **0:22–0:35** | Landing page hero: "The Future of Planning Is Autonomous." | This is Pact. It turns a group's idea into a booked trip, with an AI that plans and money that's held safely until everyone's in. |
| **0:35–0:55** | Create the pact (place, dates, $300 each). Open Pact Pilot, tap **Vote on 3 stays**, and the research steps run. Three real hotel cards appear with prices and links. | Start a pact, and Pact Pilot, our agent built on Grok, does the research. It finds three real places that fit your dates and budget, and puts them to a vote. |
| **0:55–1:10** | Tap the **mic** and ask "Who still needs to pay?" Show the words appearing, then the spoken answer (show the sound wave). Then tap **Brief me out loud**. | You don't even have to type. Ask out loud: ElevenLabs Scribe hears you, and an ElevenLabs voice answers. One tap gets you a spoken briefing on the whole trip. |
| **1:10–1:25** | Tap a hotel to vote. The **"Everyone has to agree"** popup appears; tap **Got it**. On the second device, the same pick is made and the vote decides itself. The hotel goes onto the plan. | Votes only go through when everyone agrees, and changed minds are fine. Once the group agrees, the pick goes straight on the plan. |
| **1:25–1:35** | **Send for approval** glows. Both devices tap **Approve**. | Everyone approves the price before anyone pays. |
| **1:35–2:00** | **Pay $231** with the PIN on the Circle wallet. Cut to the landing page's **"How the money moves"** with the coin moving along the steps, then the **Under the hood** log typing out: Circle, Arc, QuickNode, Supabase. Back in the app, the **Pact Verified** badge appears. | Each person pays their own share in USDC from their own Circle wallet. It's held in our PactSplit escrow contract on Arc, not in anyone's account. QuickNode Streams watches the contract, and every payment is verified on-chain. Once the last share lands, the money is released to the coordinator in one go. |
| **2:00–2:25** | The landing page's Grok Bot video, sped up: create the bot, paste the prompt, "find things under $50 and check every day", the daily routine, "yes add in 4", the vote appearing in Pact, approve, **Added to the plan**. | And you can do all of it from Grok Bot. Connect Pact once with Google, and an agent plans for you. It checks every morning for new things to do, puts the best ones to a group vote, and they land right in your pact. Same rules, same safety. It saves hours. |
| **2:25–2:38** | The landing page's **"From planning the trip to paying for it. Autonomously."** section, with its Live now / Next steps and the guardrails box. | Next: a live on-ramp, so you can pay by card, and an agent that books straight from escrow. It can only spend what the group approved, under rules the contract enforces. |
| **2:38–2:45** | Pact logo, **getpact.space**, and the sponsor logos: Arc, Circle, QuickNode, Grok, ElevenLabs. | Pact. Everyone in. Every dollar accounted for. Try it at getpact.space. |

## What each sponsor sees

- **Arc:** the PactSplit escrow holds every share and releases it (1:35).
- **Circle:** each person's own USDC wallet, protected by their PIN (1:35).
- **QuickNode Streams:** contract events are streamed to Pact and every payment shows as Pact Verified (1:35, plus the Under the hood log).
- **Grok / Grok Bot:** Pact Pilot runs on Grok, and the Grok Bot agent plans on its own (0:35, 2:00).
- **ElevenLabs:** voice in and out, and the spoken briefing (0:55).

## Shot checklist

- [ ] Group chat chaos (can be staged in iMessage with friends' consent)
- [ ] Landing hero
- [ ] Create a pact
- [ ] Pact Pilot "Vote on 3 stays" with the research steps
- [ ] Mic question, spoken answer, then "Brief me out loud"
- [ ] Vote, the "Everyone has to agree" popup, the vote decided
- [ ] Send for approval, approve on both devices
- [ ] Pay with the PIN, Pact Verified badge
- [ ] Landing: How the money moves, Under the hood
- [ ] Grok Bot video (it's at `frontend/public/grokbot/pact-pilot-demo.mp4`)
- [ ] Landing: the vision section
- [ ] End card with the logos and getpact.space
