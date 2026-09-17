// A role adapter, not a second pointer/filter implementation. Both coordinates
// come from InteractionEngine's identical independent per-ID pointer pipelines.
export function createSpatialPointers({ state, data, interaction }) {
  const empty = () => ({ handId: null, raw: null, position: null, hoverTarget: null,
    visible: false, trackingState: "LOST", pinch: null, armed: false, phase: "AIM", trail: [] });
  const cursors = data.pointers = { primary: empty(), secondary: empty() };
  function update(control) {
    const registry = state.runtime.handPointers || {};
    const ids = Object.keys(registry).filter(id => registry[id].visible);
    const anchorId = control.anchorHandId || ids.find(id => id === state.handInput.primaryHandId) || ids[0];
    const otherId = control.manipulatorHandId || ids.find(id => id !== anchorId);
    for (const [role, id] of [["primary", anchorId], ["secondary", otherId]]) {
      const p = registry[id], hand = state.hands.find(h => h.id === id), cursor = cursors[role];
      if (!p) { Object.assign(cursor, empty()); continue; }
      Object.assign(cursor, { handId: id, raw: p.raw, position: p.filtered,
        hoverTarget: p.hoverTarget, visible: p.visible, trackingState: p.trackingState,
        pinch: hand?.interactionPinch ? { raw: hand.interactionPinch.on, confirmed: hand.interactionPinch.surfaceReady } : null, armed: p.armed, phase: p.intent, trail: p.trail });
      if (role === "secondary" && (state.settings.spatialDualPointer === false || state.settings.dualHandUI === false)) cursor.armed = false;
    }
    return cursors;
  }
  function releaseSecondary(id) { if (id) interaction.release(id, "MANIPULATOR_EXIT", false); }
  return { data: cursors, update, releaseSecondary, lockSecondary() {},
    cancel() { for (const c of Object.values(cursors)) c.visible = false; } };
}
