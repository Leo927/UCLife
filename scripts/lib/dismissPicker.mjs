// Fresh boots auto-open the forced ambition picker (.status-overlay
// data-ambition-picker="forced"), which intercepts every click until an
// ambition is chosen. Picking sets forcePicker=false but leaves
// ambitionsOpen=true (manage mode), so close that too.
//
// AmbitionPanel reuses class names like .transit-terminal-go for its
// row buttons, so any test that doesn't dismiss the picker will see
// those buttons collide with FlightModal/transit selectors.
export async function dismissAmbitionPicker(page) {
  await page.evaluate(() => {
    window.__uclife__?.pickAmbitions?.(['mw_pilot'])
    window.uclifeUI?.getState().setAmbitions(false)
  })
  await page.waitForTimeout(100)
}
