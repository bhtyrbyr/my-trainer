const EXPANDED_KEY = 'mt.session.demoExpanded'

/** Remembered per device: whether the live session shows the movement GIF large. Not user data. */
export function readDemoExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeDemoExpanded(value: boolean): void {
  try {
    localStorage.setItem(EXPANDED_KEY, value ? '1' : '0')
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}
