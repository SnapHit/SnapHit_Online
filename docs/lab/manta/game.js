/* The game's display name: the page titles, the feedback page and the
   portal package (tools/manta/) all take it from here and nowhere else.
   Raywake from 4C (design doc 12.1; the working title was Manta trains).
   Code, folders, paths, file names and storage keys keep the manta name,
   so nothing stored on a phone is lost and no link breaks. The pages also
   carry it in their static <title>, so it shows before any script runs. */
export const GAME_NAME = 'Raywake';
