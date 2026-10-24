export type Script = "han" | "latin" | "neutral";

export interface ScriptRun {
  script: Script;
  text: string;
}

const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;
const MARK = /\p{Mark}/u;

function scriptOf(character: string, previous?: ScriptRun): Script {
  if (HAN.test(character)) return "han";
  if (LATIN.test(character)) return "latin";

  // A decomposed accent belongs with its base character. Keeping it in the
  // same run also prevents styling from visually separating the two code points.
  if (MARK.test(character) && previous && previous.script !== "neutral") {
    return previous.script;
  }

  return "neutral";
}

/** Split text into Unicode writing-system runs without changing its contents. */
export function segmentByScript(text: string): ScriptRun[] {
  const runs: ScriptRun[] = [];

  for (const character of text) {
    const previous = runs[runs.length - 1];
    const script = scriptOf(character, previous);

    if (previous?.script === script) {
      previous.text += character;
    } else {
      runs.push({ script, text: character });
    }
  }

  return runs;
}
