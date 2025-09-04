import VeramoServer from "./veramo_server";

// Server Manager class for handling multiple server instances
export default class VeramoServerManager {
    private servers: Map<string, VeramoServer> = new Map();

    addServer(name: string, server: VeramoServer): void {
      this.servers.set(name, server);
    }

    getServer(name: string): VeramoServer | undefined {
      return this.servers.get(name);
    }

    async startAll(): Promise<void> {
      const startPromises = Array.from(this.servers.values()).map((server) =>
        server.start()
      );
      await Promise.all(startPromises);
    }

    async stopAll(): Promise<void> {
      const stopPromises = Array.from(this.servers.values()).map((server) =>
        server.stop()
      );
      await Promise.all(stopPromises);
    }
  }
