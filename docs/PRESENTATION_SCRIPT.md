# Polyglot presentation script

This script is written for a roughly **2½–3 minute presentation**, excluding
questions. Speak naturally rather than trying to memorize every word. Text in
italics is an action or delivery note and should not be spoken.

## Slide 1 — Project name: Polyglot

> Hi everyone. We’re presenting **Polyglot**, a real-time multilingual speaking
> tutor. With Polyglot, learners can speak naturally, switch languages when
> they need to, and turn useful moments from the conversation into study
> material they can keep.

*Pause briefly, then move to the team slide.*

## Slide 2 — Meet the team

> Our team members are Stanley Cao, Dorsa Molaverdikhani, Lana Zgonjanin, and
> Kyle Dong. We are all students in the University of Toronto MScAC 2026
> cohort, and we built Polyglot for the Boson Higgs Audio Hackathon.

*If each person is presenting, gesture toward or introduce each teammate as
you say their name.*

## Slide 3 — Introducing Polyglot

> Polyglot combines three things that are normally separate: a conversation
> partner, a language tutor, and a study notebook. The learner speaks in the
> browser, receives focused feedback without stopping the conversation, and
> automatically gets study cards for corrections, useful phrases, and
> pronunciation tips.

> Today, it supports Mandarin, Korean, Japanese, French, Serbian, and
> Vietnamese, with English support for beginner and intermediate learners.

## Slide 4 — What the model does

> The model does four main things. First, it listens to the learner’s original
> audio and produces a transcript. Second, it adapts when the learner changes
> language, pauses, or interrupts. Third, it identifies teachable moments and
> calls our learning tools. Finally, it turns those moments into structured
> study material that the learner can review and replay.

> So the model does not only generate an answer—it helps build the learner’s
> personal study history.

## Slide 5 — The problem it solves

> Real language learners do not speak in perfect, single-language sentences.
> They hesitate, forget words, and fall back to their native language. Most
> learning products also separate speaking, corrections, vocabulary, and
> review into different activities.

> Polyglot keeps those activities inside one continuous conversation, while
> preserving the useful feedback after the conversation ends.

## Slide 6 — Who it is for

> Polyglot is currently designed for English-speaking beginner and
> intermediate learners. Beginners receive simpler language, patient pauses,
> and English explanations. Intermediate learners can have more natural
> conversations while still receiving focused feedback.

> It is especially useful for independent learners who want regular speaking
> practice without needing to schedule a tutor every time.

## Slide 7 — Applications

> The first application is everyday independent language practice. The same
> system can also support classroom speaking rehearsal, preparation for travel
> and relocation, and professional situations such as interviews,
> presentations, or workplace conversations.

> In the future, these conversations could also feed progress tracking,
> spaced repetition, and teacher dashboards.

## Slide 8 — Live demonstration

*Switch to the running application. Use voice-only mode for the primary demo.*

> Here is the core learning loop. I’ll deliberately make a small mistake in a
> mixed English and Mandarin sentence.

*Say clearly into the application:*

> I want to practise Chinese. 我有三本狗。

*Wait for the tutor to finish. Point to the transcript and correction card.*

> Polyglot follows the language switch, corrects the measure word from 本 to
> 只, and saves the corrected sentence, explanation, and pinyin as a study
> card. The learner can replay the correct phrase later in the tutor’s voice.

*If there is time, say: “What does 加油 mean?” Then point out the saved phrase.
If the live response is slow, continue explaining rather than leaving silence.*

## Slide 9 — How it works

> Higgs Realtime is the core conversational engine. The browser streams
> microphone audio directly to it using a short-lived credential. Higgs hears
> the audio, maintains the conversation, speaks the response, and calls our
> learning tools.

> Higgs STT 3.1 provides learner captions, Higgs TTS 3 handles phrase replay
> and slow repetition, and Higgs Avatar can provide a lip-synced visual tutor
> through LiveKit. Our permanent API key always remains on the server.

## Slide 10 — Closing

> Polyglot demonstrates that a real-time audio model can do more than hold a
> conversation. It can recognize teachable moments and turn them into learning
> that lasts beyond the call.

> With Polyglot, every sentence is practice, and every correction becomes
> progress. Thank you—we’re happy to take your questions.

---

# Appendix scripts for questions

The appendix slides are not part of the timed presentation. Use them only when
they help answer a question.

## Slide A1 — Product questions

### “How is this different from a normal voice chatbot?”

> A normal voice chatbot mainly produces a response. Polyglot has a learning
> layer around the conversation: level-aware teaching, structured corrections,
> pronunciation guidance, persistent study cards, replay, and a session recap.
> The learning artifact is as important as the reply itself.

### “Does it support every language?”

> No. It currently supports six target languages: Mandarin, Korean, Japanese,
> French, Serbian, and Vietnamese. The architecture is profile-based, so we can
> add languages, but each one should still be tested for transcription,
> pronunciation, writing system, and teaching quality before we claim support.

### “How accurate is the pronunciation feedback?”

> It provides useful qualitative feedback from the real-time audio model. It is
> not yet a certified phoneme-level assessment or numerical pronunciation
> score. A specialist pronunciation-scoring system would be a valuable next
> step.

### “Where is the learner’s progress stored?”

> Study notes are currently stored in versioned local browser storage. That
> keeps the prototype simple and private, but it means notes do not yet sync
> between devices. User accounts and cloud synchronization are future work.

### “Who would pay for this?”

> The initial opportunity is a consumer subscription for on-demand speaking
> practice. A later version could support schools and language programs through
> teacher dashboards, assignments, and progress reporting.

## Slide A2 — Technical questions

### “Why did you use Boson?”

> Higgs Realtime combines original-audio understanding, conversation state,
> streaming speech, and tool calling inside one live session. Without it, we
> would need to synchronize separate speech-to-text, language-model, and
> text-to-speech services, adding latency and more failure points.

### “How do you protect the API key?”

> The permanent Boson API key never reaches the browser. Our server exchanges
> it for a short-lived ephemeral credential, and the browser uses only that
> credential for the real-time connection.

### “How do interruptions work?”

> The audio player counts the samples actually delivered to the speaker. When
> the learner interrupts, we stop queued playback and tell Higgs exactly how
> much of the response was heard. That keeps the model’s conversation history
> consistent with the learner’s experience.

### “How do you prevent duplicated actions or responses?”

> Every tool call has an ID, and we execute each ID only once even if it appears
> in multiple real-time events. When several tools occur together, we return
> all results and request exactly one follow-up response.

### “Why does the system wait 1.5 seconds after the learner stops?”

> Language learners often pause while searching for words. A shorter silence
> window split sentences too aggressively. The 1.5-second window makes the
> conversation more patient, with a small latency tradeoff.

### “Why are there voice and avatar modes?”

> Voice-only mode is the dependable core experience. Avatar mode adds a
> lip-synced visual presence through LiveKit. If avatar capacity or the agent is
> unavailable, the product can fall back to voice-only mode without losing the
> learning functionality.

## Slide A3 — Demo recovery

If you need additional demo prompts, use these in order:

1. **Correction:** “I want to practise Chinese. 我有三本狗。”
2. **Saved phrase:** “What does 加油 mean?”
3. **Slow repetition:** “Can you say that again slowly?”
4. **Language switch:** “Let’s practise French now.”

If the avatar fails, say:

> Avatar mode is an optional presentation layer that depends on LiveKit and
> available avatar capacity. The product deliberately falls back to its core
> direct voice mode, which I’ll use now.

If transcription makes a mistake, say:

> Real-time speech recognition is probabilistic, especially for short or mixed
> utterances. The model still receives the original audio, and our application
> resets language handling on every turn to reduce language carryover.

If the network prevents the live demo, play the backup recording and say:

> This recording shows the same live flow: mixed-language speech, a spoken
> correction, and the structured study card created from that conversation.

---

# Suggested team handoff

If all four team members are speaking, one balanced division is:

- **Speaker 1:** Slides 1–3 — name, team, and introduction
- **Speaker 2:** Slides 4–5 — model and problem
- **Speaker 3:** Slides 6–8 — audience, applications, and demo
- **Speaker 4:** Slides 9–10 — architecture and closing

Use short handoffs such as:

> “Now I’ll hand it to Dorsa to explain what the model does.”

Replace the name in each handoff based on the order your team chooses.
