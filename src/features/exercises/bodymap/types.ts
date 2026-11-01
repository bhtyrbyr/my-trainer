/** Body parts of the react-native-body-highlighter figures that are muscles (can be highlighted). */
export const BODY_SLUGS = [
  'chest',
  'obliques',
  'abs',
  'biceps',
  'triceps',
  'forearm',
  'deltoids',
  'trapezius',
  'upper-back',
  'lower-back',
  'gluteal',
  'quadriceps',
  'hamstring',
  'adductors',
  'abductors',
  'calves',
  'tibialis',
  'neck',
] as const

export type BodySlug = (typeof BODY_SLUGS)[number]

/** Parts drawn in the darker skin tone unless an exercise targets them (neck: sternocleidomastoid). */
export const SKIN_SLUGS: ReadonlySet<string> = new Set(['hair', 'head', 'hands', 'feet', 'ankles', 'knees', 'neck'])

export type BodySex = 'male' | 'female'
export type BodySide = 'front' | 'back'

/** One figure: a viewBox cropped to the body, the outline, and every body part as one or more paths. */
export type BodyFigure = {
  viewBox: string
  outline: string
  parts: { slug: string; d: string[] }[]
}

export type BodyFigures = Record<BodySide, BodyFigure>
