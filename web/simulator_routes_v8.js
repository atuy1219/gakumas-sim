export const SimulatorMode = Object.freeze({
  AUDITION: "audition",
  CONTEST: "contest",
  DOLLROAD: "dollroad",
});

export const SimulatorScreens = Object.freeze({
  MEMORY_SELECT: "memory_select",
  SIMULATION: "simulation",
});

export function createSimulatorSession(mode) {
  return {
    mode,
    screen: SimulatorScreens.MEMORY_SELECT,
    memory: null,
    result: null,
  };
}
