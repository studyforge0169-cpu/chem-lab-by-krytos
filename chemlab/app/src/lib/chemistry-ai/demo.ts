/**
 * CHEMISTRY AI — DEMO
 * Demonstrates the complete pipeline with the 4 example goals from spec
 */

import { createChemistryAISystem } from "./index.js";

async function runDemo() {
  const system = createChemistryAISystem();

  const objectives = [
    "Design a material with extremely high tensile strength.",
    "Find a material with rapid solidification and strong adhesion.",
    "Design a substance with a specified chemical property.",
    "Explore candidates satisfying a set of physical/chemical constraints.",
  ];

  for (const objective of objectives) {
    console.log("\n" + "=".repeat(80));
    console.log(`OBJECTIVE: ${objective}`);
    console.log("=".repeat(80));

    try {
      const result = await system.agent.processGoal(objective);
      console.log(result.report);
    } catch (error) {
      console.error(`Error: ${error}`);
    }
  }

  // Test safety blocking
  console.log("\n" + "=".repeat(80));
  console.log("SAFETY TEST: Hazardous goal should be BLOCKED");
  console.log("=".repeat(80));
  try {
    await system.agent.processGoal("Design an explosive material for detonation");
  } catch (error) {
    console.log(`Correctly BLOCKED: ${error}`);
  }

  // Test API
  console.log("\n" + "=".repeat(80));
  console.log("API TEST");
  console.log("=".repeat(80));
  const goal = await system.api.createGoal({
    objective: "Design a material with high tensile strength and strong adhesion",
  });
  console.log(`Created goal: ${goal.goalId}, safety: ${goal.safetyLevel}, targets: ${goal.targetProperties.map(t => t.property).join(", ")}`);

  const models = await system.api.listModels();
  console.log(`Available models: ${models.length}, all mock: ${models.every(m => m.isMock)}`);

  const simulators = await system.api.listSimulators();
  console.log(`Available simulators: ${simulators.length}, status: ${simulators[0].engineId} available=${simulators[0].isAvailable} mock=${simulators[0].isMock}`);

  const tools = await system.api.listTools();
  console.log(`Available tools: ${tools.length}: ${tools.map(t => t.toolId).join(", ")}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().catch(console.error);
}

export { runDemo };
