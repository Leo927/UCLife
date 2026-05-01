export type LpcBodyType = 'male' | 'female' | 'muscular' | 'pregnant' | 'teen' | 'child'

export type LpcBodyPalette =
  | 'light' | 'amber' | 'olive' | 'taupe' | 'bronze' | 'brown' | 'black'

export type LpcHairPalette =
  | 'orange' | 'ash' | 'platinum' | 'white' | 'gray' | 'blonde' | 'sandy'
  | 'strawberry' | 'gold' | 'ginger' | 'carrot' | 'redhead' | 'red'
  | 'light_brown' | 'chestnut' | 'dark_brown' | 'dark_gray' | 'black'
  | 'raven' | 'rose' | 'pink' | 'purple' | 'violet' | 'navy' | 'blue' | 'green'

export type LpcAnimation = 'walk' | 'idle'

// LPC sheet row order: up, left, down, right.
export type LpcDirection = 'up' | 'left' | 'down' | 'right'

export interface LpcLayer {
  // Path under the LPC repo's spritesheets/ root, no extension.
  basePath: string
  // null = no recolor; keep the source PNG's default palette.
  material: 'body' | 'hair' | null
  color: LpcBodyPalette | LpcHairPalette | null
  // FC convention: body=10, hair=120 (so hair draws on top of skin).
  zPos: number
}

export interface LpcManifest {
  bodyType: LpcBodyType
  // The composer sorts by zPos before drawing.
  layers: LpcLayer[]
}
