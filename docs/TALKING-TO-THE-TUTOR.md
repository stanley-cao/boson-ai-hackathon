# Talking to the tutor

What to say to get each behaviour, for demos and testing. The tutor is a
speech model, so none of this is a strict command language. These phrasings are
the ones the model reacts to most reliably, taken from each tool's description
(`src/tools/definitions.ts`) and checked in live probes.

Speak in short, plain sentences. One request per turn works better than two.

## Switch language

| Say | What happens |
| --- | --- |
| "Can we switch to Japanese?" | Prompt, badge and picker change to Japanese |
| "Let's do Korean instead." | Same, for Korean |
| "Let's go back to French." | Same, for French |
| "Speak Serbian." / "Teach me Mandarin." | Same |
| "How about Japanese?" / "Japanese please." | Same |
| "Talk to me in Korean." | Same |

Use a verb aimed at the language: *switch to*, *change to*, *go back to*,
*let's do*, *let's learn*, *practise*, *speak*, *teach me*. The app spots these
itself, in both modes, even when the model doesn't call `set_practice_language`
(`livekit/language_switch.py` for the avatar, `src/realtime/languageSwitch.ts`
for voice only). You may hear one short line in the old language first.

In avatar mode you can also ask in French, Mandarin, Korean, Japanese, Serbian
or Vietnamese ("Parlons japonais", "日本語で話しましょう", "Pričajmo japanski").
In voice-only mode, ask in English.

Languages: every language Boson rates top tier for Higgs TTS 3 (84 besides English), from Afrikaans to Zulu, for example Mandarin (or Chinese), Korean, French, Japanese, Spanish, German, Arabic, Hindi, Russian, Serbian and Vietnamese. The picker lists them all, A to Z.

These don't switch:

- "How do you say hello in Japanese?" or "Can you say that in Japanese?" asks
  for a translation.
- "I'm studying Japanese at school" or "My friend speaks Korean" is a remark.
- "I don't want to switch to Japanese" is a refusal.

## Change level

| Say | What happens |
| --- | --- |
| "I'm intermediate." / "I'm a beginner." | The prompt changes to that level |

Say the level explicitly. The tutor never infers it.

## Slow down

| Say | What happens |
| --- | --- |
| "Can you say that again slowly?" | One slow repeat, then normal pace |
| "Say it syllable by syllable." | Same, one syllable at a time |
| "Please speak more slowly." / "Slow down." | Slow from now on |
| "You can speak normally again." | Back to normal pace |

In voice-only mode a one-off repeat is replayed slowly through text-to-speech.
In avatar mode the avatar says it at a slower pace, which works best effort.

## Get corrected

Just say a sentence with a mistake, e.g. "Je appelle Sam." The correction is
saved to the study panel, and the tutor says the right version once and
explains it in English. You can also ask: "Can you check my sentence?"

## Learn a word or phrase

| Say | What happens |
| --- | --- |
| "How do I say *my name is Sam*?" | The tutor says it and saves it to the phrase list |
| "What does *le chat* mean?" | The tutor explains it and saves it |
| "Can you remember that word?" | It saves the last word taught |

## Pronunciation

| Say | What happens |
| --- | --- |
| "How do I pronounce *bonjour*?" | A pronunciation note appears on screen and the tutor says it clearly |
| "How was my pronunciation?" | The tutor gives feedback, with a note if a sound was off |

For Mandarin it listens above all for tones.

## Mixing languages

Switch mid-sentence freely, e.g. "Can you check my Korean? 저는 학생이에요." The
tutor never asks which language you want. Your words are transcribed in the
language you actually spoke.

## When it goes wrong

- **The same line again and again:** the loop guard takes repeats out of the
  model's memory (avatar mode). If it keeps happening, say something new, or
  start a new session.
- **Talking over the avatar** can leave the tutor silent for a few seconds
  while LiveKit catches up. Pause briefly before your next turn.
- **Nothing happens on Connect in avatar mode:** the agent isn't running. Start
  the app with `npm run dev:avatar`, not `npm run dev`.
