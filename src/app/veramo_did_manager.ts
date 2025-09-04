import { createDefaultDid } from "@veramo/remote-server";
import { IDIDManager, TAgent } from "@veramo/core";
import { IAuthorizationDIDPlugin } from "../veramo/veramo_create_default_auth_did";

export default class VeramoDIDManager {
  private agent: TAgent<IDIDManager>;
  private baseUrl: string;

  constructor(agent: TAgent<IDIDManager & IAuthorizationDIDPlugin>, baseUrl: string) {
    this.agent = agent;
    this.baseUrl = baseUrl;
  }

  async initializeDefaultDID(): Promise<void> {
    try {
      await createDefaultDid({
        agent: this.agent,
        baseUrl: this.baseUrl,
        messagingServiceEndpoint: "/messaging",
      });
      console.log("Default DID initialized successfully");
      const {success, did, error} = await this.agent.authorizeDidCreation({ baseUrl: this.baseUrl });
      if (!success) {
        throw new Error(`Failed to create authorization DID: ${error}`);
      }else {
        console.log(`🔐 Authorization DID created successfully: ${did?.did}`);
      }
    } catch (error) {
      console.error("Failed to initialize default DID:", error);
      throw error;
    }
  }
}
