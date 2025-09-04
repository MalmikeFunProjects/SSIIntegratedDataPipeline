
import { Application } from "express";
import { IDIDManager, TAgent } from "@veramo/core";
import agent from "../veramo";
import {
  ServerConfig,
  serverConfig,
} from "../config";
import VeramoServer from "./veramo_server";
import VeramoServerManager from "./veramo_server_manager";
import { IAuthorizationDIDPlugin } from "../veramo/veramo_create_default_auth_did";


// Factory function for easier instantiation
export function createVeramoServer(
  serverConfig: ServerConfig,
  veramoAgent: TAgent<IDIDManager & IAuthorizationDIDPlugin>
): VeramoServer {
  return new VeramoServer(serverConfig, veramoAgent);
}

// Create server
const veramoServer = createVeramoServer(serverConfig, agent);

export const createServer = async (): Promise<Application> => {
  await veramoServer.initialize();
  return veramoServer.getApp();
};

export const startServer = async (): Promise<void> => {
  await veramoServer.start();
};

// New class-based exports
export {
  VeramoServerManager,
  veramoServer,
};

export default veramoServer;
