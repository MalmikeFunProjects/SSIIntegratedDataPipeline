import VeramoAgent from "./veramo_agent.js";
import { VeramoAgentConfig, veramoConfig, dbConnection } from "../config";

// Factory function for easier instantiation
export function createVeramoAgent(config: VeramoAgentConfig, dbConnection: any): VeramoAgent {
  return new VeramoAgent(config, dbConnection);
}

const veramoAgent = createVeramoAgent(veramoConfig, dbConnection);
const agent = veramoAgent.createAgent();

export { VeramoAgent, veramoAgent };
export default agent;
