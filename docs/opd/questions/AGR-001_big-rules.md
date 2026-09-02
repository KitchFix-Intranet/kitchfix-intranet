# AGR-001 The Big Rules - approved comprehension checks

- **Document:** AGR-001 The Big Rules (current version)
- **Modules covered:** `big-rules-onboarding` (all checks); `big-rules-annual` (open ruling - see below)
- **Approved:** 2026-09-01 (Q1-Q8 from the initial draft; Q9-Q14 from the six-clubhouse-rules addendum)
- **Seeded:** **no.** Blocked on ruling A (`academy-12` question-to-section matching + obligation `sort_order`).

## Count reconciliation

The pause handoff records **13 approved, not seeded** for AGR-001. The two source review documents (`BIG_RULES_QUESTIONS_DRAFT.md` and `BIG_RULES_QUESTIONS_ADDENDUM.md`) together carry **14** questions - Q1-Q8 in the draft and Q9-Q14 in the addendum. All 14 are documented below **verbatim** because owner-corrected phrasing must not be re-written; the authoring team should reconcile which one, if any, was retracted between the addendum author's "AGR-001 now carries 14 checks" and the handoff's "13 approved" before seeding.

Recorded verbatim per prompt: **do not re-word.** The owner corrected specific phrasing ("there is a better answer here" rather than "it is the wrong one", "the same hearing for everyone" rather than "a hearing") and those edits are deliberate.

`section_anchor` matches the document heading exactly so the runtime step-anchor match resolves.

**Prerequisite content edit before AGR-001 is onboarded:** the Acknowledgement section still references a witness countersignature captured in Rippling. See `CONTENT_FINDINGS.md` for the retirement ruling + suggested replacement.

**Open decision** (addendum footer):
1. `est_minutes` on both obligations should move from **12 to about 17** to reflect ~5 minutes of checking on top of ~12 of reading.
2. Whether the annual re-sign carries all 14 or a highest-consequence subset (Rule 21 + confidentiality + dietary advice). Genuine question, not a recommendation.

---

## Q1 - `confid-no-inner-circle`

- **section_anchor:** `Confidentiality`
- **prompt:** You get home after a shift and your spouse asks how the day went. A player was in the training room with an injury nobody has reported yet. Can you mention it?
- **options:**
  - **A.** Yes - it stays in the house, and family is not the public.
  - **B.** No. There is no inner circle exception.
- **correct:** B
- **wrong:** This is the one people get wrong most, and the document names it directly: the rule *applies to your spouse, your friends, your family, and your group chats. There is no inner circle exception.* Confidentiality is not about who you trust - it is about where the information came from. If you learned it because you were in the Club, it does not leave with you.
- **right:** Correct, and the document is explicit about it: spouse, friends, family, group chats. No inner circle exception.

---

## Q2 - `confid-does-not-expire`

- **section_anchor:** `Confidentiality`
- **prompt:** You leave KitchFix. Two years later a friend asks about something you saw in the clubhouse. Does confidentiality still apply?
- **options:**
  - **A.** Yes. It does not expire.
  - **B.** No - the obligation runs while you are employed, which is what you signed.
- **correct:** A
- **wrong:** Not here. The document says plainly that confidentiality *applies after you leave KitchFix. Confidentiality does not expire.* The obligation attaches to the information, not to your employment.
- **right:** Yes. It applies after you leave, and it does not expire.

---

## Q3 - `clubhouse-autograph-scope`

- **section_anchor:** `The Clubhouse Rules`
- **prompt:** You run into a player at a restaurant on your day off, out of uniform. Your nephew is a huge fan. Can you ask for an autograph?
- **options:**
  - **A.** No. The rule applies inside and outside the facility, in or out of uniform, on game days and off days.
  - **B.** Yes - the rule covers conduct on Club premises, and this is your own time.
- **correct:** A
- **wrong:** The rule is deliberately written to close that gap: *this applies inside and outside the Club facility, in or out of uniform, on game days and off days.* And it covers asking on behalf of anyone else - the document names friends and family specifically.
- **right:** Right. Inside or outside, in or out of uniform, game day or not - and that includes asking on someone else's behalf.

---

## Q4 - `clubhouse-dietary`

- **section_anchor:** `The Clubhouse Rules`
- **prompt:** A player you have cooked for since spring training asks whether he should be taking creatine. What do you do?
- **options:**
  - **A.** Give him your honest read - he asked you directly and you know him well.
  - **B.** Answer any question about the food itself, and refer the supplement question to the team dietitian.
- **correct:** B
- **wrong:** The rule closes this specifically, including the two reasons that make it tempting: *even if a player asks you directly, and even if you have known them for years.* We are not registered dietitians, and the Club's team dietitian is the only person authorized to give players dietary guidance. The line the document draws is clean: answer the food question, refer anything that becomes nutrition or supplements.
- **right:** That is the line exactly. Answer the food question. Nutrition, supplements, weight management - refer to the team dietitian, every time.

---

## Q5 - `clubhouse-off-the-record`

- **section_anchor:** `The Clubhouse Rules`
- **prompt:** A reporter you know casually asks you something about the team and says it is off the record. What is the right move?
- **options:**
  - **A.** Nothing is off the record. Refer them to the Club's communications team or KitchFix leadership, and do not engage.
  - **B.** Off the record is a normal working arrangement - keep it general and avoid anything specific.
- **correct:** A
- **wrong:** The document removes the option: *this includes off the record conversations. There is no off the record.* The instruction is to refer them to the Club's communications team or to KitchFix leadership and not engage at all - not to engage carefully.
- **right:** Correct. There is no off the record, and the move is to refer rather than to answer carefully.

---

## Q6 - `rule21-duty-distinction`

- **section_anchor:** `Integrity of the Game (Major League Rule 21)`
- **prompt:** Rule 21 sets two different penalties for betting on baseball. What separates them?
- **options:**
  - **A.** The size of the bet, and whether it was placed with a legal book.
  - **B.** Whether you had a duty to perform in the game you bet on.
- **correct:** B
- **wrong:** That is not the line Rule 21 draws. It turns entirely on **duty**: betting on a game where you have **no duty to perform** is one year of ineligibility. Betting on a game where you **do** have a duty to perform is **permanent** ineligibility. Illegal bookmakers are a separate provision with a penalty at the Commissioner's discretion.
- **right:** Duty is the line. No duty in the game - one year. A duty in the game - permanent ineligibility.

Note: this check quotes MLB Rule 21 directly. Rule 21 is externally-owned text; if MLB revises it, this question needs re-review. Flag as an external-dependency check.

---

## Q7 - `rule21-failure-to-report`

- **section_anchor:** `Integrity of the Game (Major League Rule 21)`
- **prompt:** Someone approaches you and asks you to help influence the outcome of a game. You refuse and walk away. Have you met your obligation under Rule 21?
- **options:**
  - **A.** Yes - you refused, and you did nothing wrong.
  - **B.** No. Failing to report the solicitation immediately carries the same penalty as taking part.
- **correct:** B
- **wrong:** This is the provision people do not know, and it is the reason the section says read every word. Rule 21 declares permanently ineligible anyone who, *being solicited by any person, shall fail to inform the Commissioner immediately of such solicitation, and of all facts and circumstances connected therewith.* Refusing is not enough. Reporting is the obligation.
- **right:** Correct, and it is the provision most people miss. Refusing is not enough - failing to report the solicitation immediately carries permanent ineligibility on its own.

Note: like Q6, this check quotes MLB Rule 21 directly. External dependency.

---

## Q8 - `escalation-never-client`

- **section_anchor:** `Communication and Escalation`
- **prompt:** Your site is short-staffed and it is affecting service. The Club's operations manager asks you directly how things are going. What do you say?
- **options:**
  - **A.** Answer honestly about the staffing problem - he asked, and he is affected by it.
  - **B.** Keep it to the service, and take the staffing issue to KitchFix leadership.
- **correct:** B
- **wrong:** The document is unambiguous: *you do not raise KitchFix issues with the Client. Ever.* Staffing, scheduling, equipment, food cost, conflict, performance - all of it goes through the KitchFix chain first. It is not about hiding a problem; it is about the client hearing about a KitchFix problem from KitchFix leadership rather than from the line.
- **right:** Right. All work issues go to KitchFix leadership first, and the client never hears a KitchFix issue from the floor.

---

## Q9 - `clubhouse-photos`

- **section_anchor:** `The Clubhouse Rules`
- **prompt:** You want a photo of your station to show the team what the new setup looks like. Is that allowed?
- **options:**
  - **A.** Yes, as long as no players, coaches, or Club staff are in the frame.
  - **B.** Only if it is an operational photo the job requires, and only with Site Leader approval.
- **correct:** B
- **wrong:** Closer than it sounds, but the rule is narrower. Operational photos required for the food service operation are **the only exception**, and they still need Site Leader approval. The ban covers Club facilities themselves, not just people - kitchen, dining areas, equipment rooms, any space inside the facility.
- **right:** That is the exception, and it is the only one. Operational photos the job requires, with Site Leader approval. Selfies in uniform inside a Club facility are never allowed.

---

## Q10 - `clubhouse-gambling`

- **section_anchor:** `The Clubhouse Rules`
- **prompt:** A friend outside work asks you to place a baseball bet for them, since you are at the park anyway. Is that a problem?
- **options:**
  - **A.** Yes. Placing a bet through anyone else, or for anyone else, is covered by the rule.
  - **B.** No, as long as the money and the account are not yours.
- **correct:** A
- **wrong:** The rule closes that route deliberately: *do not bet on baseball games, do not place bets through anyone else, do not facilitate bets for anyone else.* Whose money it is does not matter. And the full penalty sits in Rule 21, not in a KitchFix policy.
- **right:** Correct. Your bet, someone else's bet, or a bet you help place - all three are the same rule.

---

## Q11 - `clubhouse-peds`

- **section_anchor:** `The Clubhouse Rules`
- **prompt:** Two of you are joking around about whether a player on another team is on something. Any issue?
- **options:**
  - **A.** No - it is a joke, about a player who is not ours.
  - **B.** Yes. The rule covers joking, and it covers players on other teams.
- **correct:** B
- **wrong:** The rule names both exits directly. It prohibits **discussing, speculating about, asking about, or joking about** player use of performance-enhancing substances, and it applies to *current players, former players, players on other teams, and prospects.* There is no version of this conversation that is inside the line.
- **right:** Yes. Joking is named, and so are players on other teams, former players, and prospects.

---

## Q12 - `clubhouse-inside-info`

- **section_anchor:** `The Clubhouse Rules`
- **prompt:** You hear about a trade that has not been announced. Can you mention it in a private group chat with friends?
- **options:**
  - **A.** No. Private channels are named in the rule.
  - **B.** Yes, as long as it is not public and nobody outside the chat sees it.
- **correct:** A
- **wrong:** The rule lists the channels specifically so this gap cannot be argued: *you do not share this information privately, in group chats, on social media, in DMs, or anywhere else.* And trade discussions are one of the named categories, alongside lineup decisions, injury status, contract talks, prospect evaluations, and travel logistics.
- **right:** Right - private group chats and DMs are named in the rule. And if the sharing is connected to betting, that is a separate and more serious offense under Rule 21.

---

## Q13 - `clubhouse-relationships`

- **section_anchor:** `The Clubhouse Rules`
- **prompt:** A player you get on well with follows you on social media. Do you follow back?
- **options:**
  - **A.** No. Social media follows are named in the rule.
  - **B.** Yes - it is a public account, and being friendly is part of the job.
- **correct:** A
- **wrong:** Friendly is part of the job. Friendship is not. The rule names the specific behaviours: *do not exchange personal contact information, follow each other on social media, accept invitations to personal events, or engage in social interactions outside the food service relationship.* The line the document draws is clean - **friendly professional rapport is expected and welcomed, personal friendships are not.**
- **right:** Correct. Friendly professional rapport is expected. Following each other is named as one of the things that crosses into a personal relationship.

---

## Q14 - `clubhouse-outside-services`

- **section_anchor:** `The Clubhouse Rules`
- **prompt:** A coach asks if you would cater a private party at his house. He is offering to pay you directly. What do you say?
- **options:**
  - **A.** No. Offering your services to Club people independently of KitchFix is prohibited.
  - **B.** Yes, on your own time - it is private work, unconnected to the Club.
- **correct:** A
- **wrong:** The rule covers exactly this: *do not offer your services - culinary, personal chef, catering, training, or anything else - to players, coaches, or Club staff independently of KitchFix.* Your own time does not separate it, because the relationship that produced the offer came from the job.
- **right:** Correct. Culinary, personal chef, catering, training, anything - not independently of KitchFix, on your time or otherwise.
