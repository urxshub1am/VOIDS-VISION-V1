export const SYSTEM_STORAGE_KEY = "voids-vision.settings.system.v1";

export const SYSTEM_DEFAULTS = Object.freeze({
  performancePreset: "balanced",
  holoQuality: "auto",
  cameraMirror: true,
  cameraResolution: "balanced",
  soundEnabled: true,
  visualEffects: "full",
  autoPerformanceMode: true,
  showSkeleton: true,
  showTrail: true,
  firstRunDismissed: false
});

const ENUMS = Object.freeze({
  performancePreset: ["performance", "balanced", "visual", "custom"],
  holoQuality: ["auto", "performance", "balanced", "visual"],
  cameraResolution: ["performance", "balanced", "quality"],
  visualEffects: ["full", "reduced"]
});

export function validateSystemPreferences(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [key, fallback] of Object.entries(SYSTEM_DEFAULTS)) {
    if (typeof fallback === "boolean") result[key] = typeof input[key] === "boolean" ? input[key] : fallback;
    else result[key] = ENUMS[key]?.includes(input[key]) ? input[key] : fallback;
  }
  return result;
}

export function performancePresetPatch(name) {
  switch (name) {
    case "performance":
      return {
        performancePreset: "performance", cameraResolution: "performance",
        visualEffects: "reduced", autoPerformanceMode: true,
        showTrail: false, holoQuality: "performance"
      };
    case "visual":
      return {
        performancePreset: "visual", cameraResolution: "quality",
        visualEffects: "full", autoPerformanceMode: false,
        showTrail: true, holoQuality: "visual"
      };
    case "balanced":
    default:
      return {
        performancePreset: "balanced", cameraResolution: "balanced",
        visualEffects: "full", autoPerformanceMode: true,
        showTrail: true, holoQuality: "auto"
      };
  }
}

export function inferPerformancePreset(settings) {
  for (const name of ["performance", "balanced", "visual"]) {
    const patch = performancePresetPatch(name);
    const entries = Object.entries(patch).filter(([key]) => key !== "performancePreset");
    if (entries.every(([key, value]) => settings[key] === value)) return name;
  }
  return "custom";
}
