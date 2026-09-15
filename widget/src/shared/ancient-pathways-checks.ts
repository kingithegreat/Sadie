/**
 * Plain-language wording for Ancient Pathways' quality checks.
 *
 * The checker (`scripts/doctor.py` in that project) answers in its own terms:
 * "master has music: quiet-window RMS 0.00287 (dialogue-only measures 0.00000)".
 * Studio used to print that straight into the card, and the owner read it twice
 * without being able to act on it. He is not meant to know what a quiet-window
 * RMS is; he is meant to know the video has no music and what to do about it.
 *
 * So: a title he can act on, what it means, and the next step. The checker's own
 * line is still shown underneath, because agents and logs need the numbers.
 *
 * Adding a check to the checker without adding it here is safe - an unknown name
 * falls back to the raw line rather than hiding it.
 */

export interface CheckExplanation {
  /** What is wrong, in the owner's words. */
  title: string;
  /** Why it matters for the finished episode. */
  meaning: string;
  /** The next thing to do about it. */
  fix: string;
}

const EXPLANATIONS: Record<string, CheckExplanation> = {
  'rigs resolve': {
    title: 'A character is missing pieces',
    meaning: 'Part of a character (a collar, a hat, a limb) is not on disk, so they would be drawn incomplete.',
    fix: 'Restore the missing part files, or cut that character from their sheet again.',
  },
  'guest identity honest': {
    title: 'The guest may be the wrong person',
    meaning: "The guest's artwork does not match the character the script says appears in this episode.",
    fix: 'Check the guest model sheet is the right character before rendering.',
  },
  'no captions in sprites': {
    title: 'Words are baked into a character picture',
    meaning: 'Text from the artwork sheet was cut into a character, so it would show on screen behind them.',
    fix: 'Cut that pose from the sheet again. Do not paint the words out by hand.',
  },
  'no chroma residual in sprites': {
    title: 'Cut-out background left on a character',
    meaning: 'Some of the magenta backdrop is still stuck around a character and will show as a coloured fringe.',
    fix: 'Cut that character out again with the background key.',
  },
  'no shadowed definitions': {
    title: 'The same code is defined twice',
    meaning: 'Two versions of one function exist and the wrong one runs. This once shipped episodes with no music at all.',
    fix: 'Remove the duplicate definition in the pipeline.',
  },
  'heads in frame': {
    title: 'A close-up with no head in it',
    meaning: "A shot framed as a close-up does not actually contain the character's head.",
    fix: "Adjust that shot's framing or the character's size.",
  },
  'composition varies': {
    title: 'Every shot is framed the same',
    meaning: 'Shots sit at the same size and position throughout, which makes the episode look flat.',
    fix: 'Vary the framing across scenes: wide, two-shot and close-up.',
  },
  'score bed on disk': {
    title: 'The music file is missing',
    meaning: 'The episode names a music track that is not on disk, so it would render silent under the dialogue.',
    fix: 'Run the music step for this episode again.',
  },
  'master has music': {
    title: 'The finished video has no music',
    meaning: 'There is no music bed under the dialogue in the exported episode.',
    fix: 'Check the music file exists, then run the mix step again.',
  },
  'master length': {
    title: 'The video is shorter than the script',
    meaning: 'The finished video does not cover the whole script, so lines are missing from the end or middle.',
    fix: 'Assemble the episode again, and check every scene actually rendered.',
  },
  'mouths move': {
    title: 'Mouths are not moving while characters talk',
    meaning: 'Lip-sync is not animating, so characters speak with still faces.',
    fix: 'Check the mouth anchors in Character Anchors, then run the lip-sync step again.',
  },
  'sprite dimensions plausible': {
    title: 'A character picture is the wrong size',
    meaning: 'A cut-out is far larger or smaller than the others, so that character would appear oversized or tiny.',
    fix: "Cut that character's sheet again and compare the pose sizes.",
  },
  'plates full resolution': {
    title: 'A background is blurry',
    meaning: 'A background was saved at half size, so it looks soft once it fills the screen.',
    fix: 'Generate that background again at full size (2560 x 1440).',
  },
  'master has foley': {
    title: 'The finished video has no sound effects',
    meaning: 'The sound-effects track is missing or too quiet to hear in the exported episode.',
    fix: 'Check the effects file exists, then run the mix step again.',
  },
  'episode assets present': {
    title: 'Something this episode needs is missing',
    meaning: 'A file the episode depends on is not on disk, so the render would fail or skip part of the story.',
    fix: 'Run the steps that produce the missing files again.',
  },
  'cutscenes reach': {
    title: 'A cut-away never plays',
    meaning: 'A cut-away scene is set up but nothing in the episode shows it, so the work is invisible.',
    fix: 'Add it to the shot list, or remove it.',
  },
  'no panel headings in sprites': {
    title: 'A heading strip is inside a character picture',
    meaning: "A title bar from the artwork sheet was cut into a character and would appear across them on screen.",
    fix: 'Cut that pose from the sheet again. Erasing the rows would delete part of the character too.',
  },
  'flappy has no scratch': {
    title: "Crackle in Flappy's voice",
    meaning: "Flappy's recorded lines contain clicks or crackle that would be audible in the episode.",
    fix: 'Synthesise his lines again.',
  },
  'mouth in lower face': {
    title: 'A mouth is placed too high on the face',
    meaning: 'A mouth anchor sits above the lower half of the face, so the mouth would animate in the wrong place.',
    fix: 'Open Character Anchors and drag that pose’s mouth box onto the lips.',
  },
};

/** Plain wording for a check, or null when the checker names one we do not know. */
export function explainCheck(name: string): CheckExplanation | null {
  return EXPLANATIONS[(name || '').trim().toLowerCase()] || null;
}

/** Every check name this module can explain. */
export function explainedCheckNames(): string[] {
  return Object.keys(EXPLANATIONS);
}

/** "3 problems found" beats "3 check(s) failed" for someone who has to act on it. */
export function failureSummary(count: number): string {
  return count === 1 ? '1 problem found' : `${count} problems found`;
}
