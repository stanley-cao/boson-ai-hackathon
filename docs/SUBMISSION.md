# Submission write-ups

Text for the hackathon submission form. Each write-up is within the 200-word limit. It describes what is on `main` as of `037b63a`; update it if a feature lands or changes before the judged commit is pinned.

## Project

**Name:** Polyglot

**Track:** Conversation as the Interface

**One-sentence description:**
Polyglot is a real-time voice tutor you talk to in a mix of English and the language you're learning, which corrects you, coaches your pronunciation and saves what you learn without breaking the conversation.

## What it is (178 words)

Learners need speaking practice, but language apps mostly offer drills, and voice assistants struggle when a beginner falls back to English mid-sentence. Stopping to fix every mistake also kills the conversation.

Polyglot is for English speakers learning any of the 84 languages Boson rates top tier for Higgs TTS 3 (Mandarin, Korean, Japanese, French, Spanish, Arabic, Hindi and more), from beginner to intermediate, who want a patient conversation partner rather than flashcards.

You pick a language and level and start talking in the browser. The tutor hears your voice directly and answers out loud in whichever language you just used, so you can switch mid-sentence without choosing a mode. It gives at most one correction per turn, flags wrong tones and sounds, explains phrases you ask about, and slows down when you ask it to say something again slowly. Each correction, phrase and pronunciation tip becomes a card in a study panel, with a button to replay it in the tutor's voice. When you finish, a recap lists what to review, and your notes are still there after a reload. In avatar mode, the same tutor appears on screen as a lip-synced face.

## Higgs models and what's novel (192 words)

**Higgs Realtime** (`higgs-realtime`) runs the whole conversation. It hears the learner's audio directly, so it can judge a Mandarin tone rather than a transcript. It answers in speech and calls our learning tools mid-turn: `note_correction`, `pronunciation_feedback`, `save_phrase`, `set_speaking_pace` and `set_practice_language`.
**Higgs STT 3.1** (`higgs-stt-3.1`) captions the learner's turns, detecting the language on every turn so mixed-language speech is transcribed correctly.
**Higgs TTS 3** (`higgs-tts-3`) replays saved phrases in the tutor's voice and gives slow, syllable-by-syllable repeats. Our headless test probe also uses it to speak test turns.
**Higgs Avatar** (`higgs-avatar`) realtime sessions put the tutor on screen, lip-synced inside a LiveKit room.

What's hard: tools run in the browser, and one transcript reducer feeds both the conversation and the study panel. In avatar mode a Python LiveKit agent owns the session, so it forwards each tool call to the browser over RPC, and the prompt and tools are exported as shared JSON so both modes run the same tutor. Barge-in truncation is sample-accurate at 24 kHz. Avatar sessions are released when the learner leaves, with capacity and rate-limit retries. Tool descriptions were tuned with live probes so the model keeps calling tools.
