import express, { Request, Response } from "express";
import { RawData, WebSocket } from "ws";
import { createServer, Server as HTTPServer } from "http";
import cors from "cors";
import expressWs from "express-ws";
// import { DemoLlmClient } from "./llm_azure_openai";
import { TwilioClient } from "./twilio_api";
import { RetellClient } from "retell-sdk";
import {
  AudioWebsocketProtocol,
  AudioEncoding,
} from "retell-sdk/models/components";
// import { LLMDummyMock } from "./llm_dummy_mock";
// import { FunctionCallingLlmClient } from "./llm_azure_openai_func_call";
import { RetellRequest } from "./types";
import { DemoLlmClient } from "./llm_openai";
// import { DemoLlmClient } from "./llm_openrouter";

export class Server {
  private httpServer: HTTPServer;
  public app: expressWs.Application;
  private retellClient: RetellClient;
  private twilioClient: TwilioClient;

  constructor() {
    // Initialize the express application with WebSocket support
    this.app = expressWs(express()).app;
    // Create an HTTP server for the express application
    this.httpServer = createServer(this.app);

    // Middleware to parse JSON bodies
    this.app.use(express.json());
    // Enable Cross-Origin Resource Sharing (CORS) for all routes
    this.app.use(cors());
    // Middleware to parse URL-encoded bodies
    this.app.use(express.urlencoded({ extended: true }));

    // Setup WebSocket endpoint for handling Retell LLM interactions
    this.handleRetellLlmWebSocket();
    // Setup API endpoint for registering calls without exposing API keys to the frontend
    this.handleRegisterCallAPI();

    // Initialize the Retell client with the API key from environment variables
    this.retellClient = new RetellClient({
      apiKey: process.env.RETELL_API_KEY,
    });

    // Initialize the Twilio client and register a phone agent with Twilio and Retell IDs from environment variables
    this.twilioClient = new TwilioClient();
    this.twilioClient.RegisterPhoneAgent(process.env.TWILIO_PHONE_NUMBER, process.env.RETELL_AGENT_ID)
    // Setup the Twilio client to listen for voice webhook events
    this.twilioClient.ListenTwilioVoiceWebhook(this.app);
  }

  listen(port: number): void {
    this.app.listen(port);
    console.log("Listening on " + port);
  }

  /**
   * This method sets up an API endpoint to handle call registration requests from the web frontend.
   * It's designed to abstract away the need for the frontend to directly use the API key, enhancing security.
   * When a POST request is made to this endpoint with an agentId, it registers a call with the RetellClient service.
   */
  handleRegisterCallAPI() {
    // Define a POST route for registering calls.
    this.app.post(
      "/register-call-on-your-server",
      async (req: Request, res: Response) => {
        // Extract the agentId from the request body. This ID is necessary to register the call with RetellClient.
        const { agentId } = req.body;

        try {
          // Attempt to register the call with the provided agentId and predefined settings for the call.
          // These settings include the audio websocket protocol, audio encoding format, and sample rate.
          const callResponse = await this.retellClient.registerCall({
            agentId: agentId,
            audioWebsocketProtocol: AudioWebsocketProtocol.Web,
            audioEncoding: AudioEncoding.S16le,
            sampleRate: 24000,
          });
          // If the call is successfully registered, send the call details back to the client as a JSON response.
          res.json(callResponse.callDetail);
        } catch (error) {
          // Log any errors encountered during the call registration process.
          console.error("Error registering call:", error);
          // Respond with a 500 status code and a JSON object indicating the call registration failed.
          res.status(500).json({ error: "Failed to register call" });
        }
      },
    );
  }

  /**
   * Sets up a WebSocket endpoint to handle real-time communication with clients for language model (LLM) interactions.
   * This method initializes a WebSocket server on a specific route and listens for incoming connections.
   * Each connection is associated with a unique call ID, allowing for individual handling of LLM requests.
   */
  handleRetellLlmWebSocket() {
    // Establish a WebSocket connection on the specified route, including a dynamic segment for the call ID.
    this.app.ws("/llm-websocket/:call_id", async (ws: WebSocket, req: Request) => {
      // Extract the call ID from the request parameters.
      const callId = req.params.call_id;
      console.log("Handle llm ws for: ", callId);

      // Instantiate the LLM client to interact with the language model.
      const llmClient = new DemoLlmClient();
      // Send an initial message to the client to indicate readiness to process LLM requests.
      llmClient.BeginMessage(ws);

      // Handle any errors that occur within the WebSocket connection.
      ws.on("error", (err) => {
        console.error("Error received in LLM websocket client: ", err);
      });

      // Log when the WebSocket connection is closed, either by the client or due to an error.
      ws.on("close", () => {
        console.error("Closing llm ws for: ", callId);
      });

      // Listen for messages sent over the WebSocket connection.
      ws.on("message", async (data: RawData, isBinary: boolean) => {
        // console.log(data.toString());
        // Check if the message received is binary; if so, close the connection as only text is expected.
        if (isBinary) {
          console.error("Got binary message instead of text in websocket.");
          ws.close(1002, "Cannot find corresponding Retell LLM.");
          return;
        }
        try {
          // Attempt to parse the incoming message as a JSON object representing a RetellRequest.
          const request: RetellRequest = JSON.parse(data.toString());
          // Pass the request to the LLM client for processing and response drafting.
          llmClient.DraftResponse(request, ws);
        } catch (err) {
          // Handle any errors that occur during message parsing or processing.
          console.error("Error in parsing LLM websocket message: ", err);
          ws.close(1002, "Cannot parse incoming message.");
        }
      });
    });
  }
}
